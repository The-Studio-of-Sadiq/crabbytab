import { describe, expect, it } from "vitest";
import type { BallotSubmission } from "@/types";
import { checkIndependentConfirmation } from "./stateGuards";

const ballot = (overrides: Partial<BallotSubmission>) =>
  ({ id: "b2", debateId: "d1", roundId: "r1", version: 2, submitterType: "tabroom", submitterId: "alice", confirmed: false, discarded: false, ...overrides }) as BallotSubmission;
const on = (actorId?: string) => ({ doubleEntry: true, actorId });

describe("double entry: a different person must check", () => {
  it("blocks confirming your own entry, but not someone else's", () => {
    expect(checkIndependentConfirmation(ballot({}), "confirm_existing", on("alice"), { ballots: [] }).map((v) => v.rule)).toEqual(["same_person_check"]);
    expect(checkIndependentConfirmation(ballot({}), "confirm_existing", on("bob"), { ballots: [] })).toEqual([]);
  });

  it("only accepts a confirmed tab-room submission that checks another person's version", () => {
    const pending = ballot({ id: "b1", version: 1, submitterId: "alice" });
    const unchecked = ballot({ id: "b3", version: 3, submitterId: "bob", confirmed: true });
    expect(checkIndependentConfirmation(unchecked, "submit_confirmed", on("bob"), { ballots: [pending] })).toHaveLength(1);
    const check = { ...unchecked, checksVersion: 1 };
    expect(checkIndependentConfirmation(check, "submit_confirmed", on("bob"), { ballots: [pending] })).toEqual([]);
    expect(checkIndependentConfirmation({ ...check, submitterId: "alice" }, "submit_confirmed", on("alice"), { ballots: [pending] })).toHaveLength(1);
  });

  it("is overridable and does not apply without double entry, without a signed-in user, or to judges' portal ballots", () => {
    const [violation] = checkIndependentConfirmation(ballot({}), "confirm_existing", on("alice"), { ballots: [] });
    expect(violation.overridable).toBe(true);
    expect(checkIndependentConfirmation(ballot({}), "confirm_existing", { doubleEntry: false, actorId: "alice" }, { ballots: [] })).toEqual([]);
    expect(checkIndependentConfirmation(ballot({}), "confirm_existing", on(undefined), { ballots: [] })).toEqual([]);
    expect(checkIndependentConfirmation(ballot({ submitterType: "judge" }), "confirm_existing", on("alice"), { ballots: [] })).toEqual([]);
  });
});
