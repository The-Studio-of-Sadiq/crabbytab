import { generateRoundDraw, type GenerateDrawParams } from "@/lib/draw/generator";
import {
  computeAutoAllocation,
  type AutoAllocationInput,
  type AutoAllocationResult,
} from "@/features/tournament/application/allocation";
import type { Debate } from "@/types";

/**
 * The heavy, deterministic computations the tab room can run off the UI thread. Requests and
 * results are plain data, so they cross a Web Worker boundary by structured clone unchanged.
 */
export type ComputeRequest =
  | { kind: "draw"; input: GenerateDrawParams }
  | { kind: "allocation"; input: AutoAllocationInput };

export interface ComputeResults {
  draw: Debate[];
  allocation: AutoAllocationResult | null;
}

export type ComputeKind = ComputeRequest["kind"];

export type ComputeResponse =
  | { ok: true; result: ComputeResults[ComputeKind] }
  | { ok: false; error: string };

export function executeComputeRequest(request: ComputeRequest): ComputeResults[ComputeKind] {
  switch (request.kind) {
    case "draw":
      return generateRoundDraw(request.input);
    case "allocation":
      return computeAutoAllocation(request.input);
  }
}

/** The worker's message handler; errors (e.g. an unsatisfiable draw constraint) keep their message. */
export function handleComputeRequest(request: ComputeRequest): ComputeResponse {
  try {
    return { ok: true, result: executeComputeRequest(request) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The computation failed." };
  }
}
