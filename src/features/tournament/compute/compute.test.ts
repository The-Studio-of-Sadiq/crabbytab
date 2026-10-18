import { describe, expect, it } from "vitest";
import { generateRoundDraw, type GenerateDrawParams } from "@/lib/draw/generator";
import { computeAutoAllocation, type AutoAllocationInput } from "@/features/tournament/application/allocation";
import { makeAdjudicators, makeRound, makeTeams, makeTournament, makeVenues } from "@/test/tournamentFixtures";
import { ComputeCancelledError, runComputeJob, type WorkerFactory } from "./computeClient";
import { handleComputeRequest, type ComputeRequest } from "./computeJobs";

const tournament = makeTournament("bp");
const teams = makeTeams(40, { tournamentId: tournament.id, institutionCount: 6 });
const drawParams: GenerateDrawParams = {
  tournament,
  round: makeRound(tournament.id, 1),
  teams,
  venues: makeVenues(10, tournament.id),
  pastDebates: [],
  standings: [],
  seed: 12345,
};
const drawRequest: ComputeRequest = { kind: "draw", input: drawParams };

/**
 * A stand-in for a module Web Worker: the request and response cross a structured-clone boundary
 * and the reply arrives asynchronously, as with a real worker. `respond: false` never replies.
 */
function fakeWorkers(respond = true) {
  const created: Array<{ terminated: boolean }> = [];
  const factory: WorkerFactory = () => {
    const state = { terminated: false };
    created.push(state);
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage(message: unknown) {
        if (!respond) return;
        const request = structuredClone(message) as ComputeRequest;
        setTimeout(() => {
          if (!state.terminated) worker.onmessage?.({ data: structuredClone(handleComputeRequest(request)) } as MessageEvent);
        }, 0);
      },
      terminate() {
        state.terminated = true;
      },
    };
    return worker as unknown as Worker;
  };
  return { factory, created };
}

describe("background draw and allocation", () => {
  it("gives the same draw in a worker as on the page, for the same seed", async () => {
    const { factory, created } = fakeWorkers();
    const inWorker = await runComputeJob({ kind: "draw", input: drawParams }, { createWorker: factory });
    const inline = await runComputeJob({ kind: "draw", input: drawParams }, { createWorker: null });
    expect(inWorker).toEqual(generateRoundDraw(drawParams));
    expect(inline).toEqual(inWorker);
    expect(inWorker).toHaveLength(10);
    expect(created).toEqual([{ terminated: true }]);
  });

  it("gives the same allocation in a worker as on the page", async () => {
    const draw = generateRoundDraw(drawParams);
    const input: AutoAllocationInput = {
      roundId: drawParams.round.id,
      panelSize: 3,
      tournament,
      rounds: [drawParams.round],
      teams,
      debates: draw,
      adjudicators: makeAdjudicators(30, { tournamentId: tournament.id, institutionCount: 6 }),
      standings: [],
      breakCategories: [],
      feedback: [],
      venues: drawParams.venues,
    };
    const { factory } = fakeWorkers();
    const inWorker = await runComputeJob({ kind: "allocation", input }, { createWorker: factory });
    expect(inWorker).toEqual(computeAutoAllocation(input));
    expect(inWorker?.roundDebates.every((debate) => debate.adjudicators.chairId)).toBe(true);
  });

  it("reports an unsatisfiable draw with the generator's own message", async () => {
    const request: ComputeRequest = { kind: "draw", input: { ...drawParams, venues: makeVenues(3, tournament.id) } };
    const { factory } = fakeWorkers();
    await expect(runComputeJob(request, { createWorker: factory })).rejects.toThrow("Not enough available venues");
    await expect(runComputeJob(request, { createWorker: null })).rejects.toThrow("Not enough available venues");
  });

  it("stops the worker when cancelled", async () => {
    const { factory, created } = fakeWorkers(false);
    const controller = new AbortController();
    const job = runComputeJob(drawRequest as Extract<ComputeRequest, { kind: "draw" }>, { createWorker: factory, signal: controller.signal });
    controller.abort();
    await expect(job).rejects.toBeInstanceOf(ComputeCancelledError);
    expect(created).toEqual([{ terminated: true }]);
  });

  it("does not start a job that was already cancelled, and cancels inline jobs before they run", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runComputeJob(drawRequest as Extract<ComputeRequest, { kind: "draw" }>, { signal: controller.signal }))
      .rejects.toBeInstanceOf(ComputeCancelledError);
    const later = new AbortController();
    const inline = runComputeJob(drawRequest as Extract<ComputeRequest, { kind: "draw" }>, { createWorker: null, signal: later.signal });
    later.abort();
    await expect(inline).rejects.toBeInstanceOf(ComputeCancelledError);
  });

  it("computes on the page when a worker cannot start", async () => {
    const failing: WorkerFactory = () => {
      throw new Error("blocked by policy");
    };
    const original = console.warn;
    console.warn = () => undefined;
    try {
      expect(await runComputeJob({ kind: "draw", input: drawParams }, { createWorker: failing })).toEqual(generateRoundDraw(drawParams));
    } finally {
      console.warn = original;
    }
  });
});
