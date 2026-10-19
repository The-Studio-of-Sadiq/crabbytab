import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ASSISTANT_LIVE_BALLOT_FIELDS, ASSISTANT_LIVE_CHECK_IN_FIELDS, DATA_ENTRY_FIELDS } from "./dataEntrySync";

/**
 * There is no Firestore emulator in CI, so these checks keep firestore.rules and the server-side
 * whitelists in step; docs/live-collaboration.md lists the manual rules checks.
 */
const rules = readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");

function rulesList(functionName: string): string[] {
  const match = rules.match(new RegExp(`function ${functionName}\\(\\)\\s*\\{\\s*return \\[([^\\]]*)\\];`));
  if (!match) throw new Error(`firestore.rules has no list function ${functionName}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

describe("live collection rules", () => {
  it("let assistants create ballots with exactly the mirrored fields", () => {
    expect(rulesList("assistantLiveBallotFields").sort()).toEqual([...ASSISTANT_LIVE_BALLOT_FIELDS].sort());
  });

  it("let assistants change exactly the mirrored check-in fields", () => {
    expect(rulesList("assistantLiveCheckInFields").sort()).toEqual([...ASSISTANT_LIVE_CHECK_IN_FIELDS].sort());
  });

  it("only grant fields the data-entry route also accepts", () => {
    const checkInFields = ASSISTANT_LIVE_CHECK_IN_FIELDS.filter((field) => field !== "syncVersion");
    for (const field of checkInFields) {
      expect(DATA_ENTRY_FIELDS.teams).toContain(field);
      expect(DATA_ENTRY_FIELDS.adjudicators).toContain(field);
    }
    expect(ASSISTANT_LIVE_BALLOT_FIELDS).not.toContain("confirmedTimestamp");
    expect(ASSISTANT_LIVE_BALLOT_FIELDS).not.toContain("confirmedBy");
  });

  it("require assistant ballots to be their own, unconfirmed, and in their debate's round", () => {
    const ballotRule = rules.slice(rules.indexOf("function isAssistantBallot"), rules.indexOf("function isAssistantCheckIn"));
    for (const condition of [
      "ballot.confirmed == false",
      "ballot.discarded == false",
      'ballot.submitterType == "tabroom"',
      "ballot.submitterId == request.auth.uid",
      "get(debatePath).data.roundId == ballot.roundId",
    ]) {
      expect(ballotRule).toContain(condition);
    }
    expect(rules).toMatch(/match \/ballots\/\{ballotId\} \{\s*allow create: if isAssignedAssistant\(\) && isAssistantBallot\(ballotId\);\s*\}/);
  });
});
