/**
 * Differential test against real Tabbycat (roadmap #10).
 *
 * For every fixture with a committed golden file, CrabbyTab imports the same DebateXML, computes
 * standings, draws, breaks and an allocation through the real libraries, and the result is compared
 * by rules with Tabbycat's output. The test fails when a discrepancy has no verdict in
 * `known-differences.json`, or when the set of discrepancies changes from the committed
 * `report/report.json` (something got fixed or something regressed: regenerate and review).
 *
 *   TABBYCAT_DIFF_WRITE=1 npx vitest run tools/tabbycat-diff   # rewrite report/REPORT.md and report.json
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { classify, compareRuns, type KnownDifference } from "./harness/compare";
import { loadFixtureConfig, runCrabbyTab } from "./harness/crabbytab";
import { readFixtureFacts } from "./harness/facts";
import { reportJson, reportMarkdown, type FixtureReport } from "./harness/report";
import type { EngineOutput } from "./harness/types";

const ROOT = join(__dirname);
const FIXTURES = join(ROOT, "fixtures");
const GOLDEN = join(ROOT, "golden");
const REPORT_DIR = join(ROOT, "report");
const WRITE = process.env.TABBYCAT_DIFF_WRITE === "1";

const known = JSON.parse(readFileSync(join(ROOT, "known-differences.json"), "utf8")).differences as KnownDifference[];
const fixtureNames = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(GOLDEN, `${entry.name}.tabbycat.json`)))
  .map((entry) => entry.name)
  .sort();

function runFixture(name: string): FixtureReport {
  const dir = join(FIXTURES, name);
  const config = loadFixtureConfig(dir);
  const tabbycat = JSON.parse(readFileSync(join(GOLDEN, `${name}.tabbycat.json`), "utf8")) as EngineOutput;
  const preferences = tabbycat.preferences ?? {};
  const crabbytab = runCrabbyTab(dir, preferences);
  const facts = readFixtureFacts(dir, config);
  const { discrepancies, checks } = compareRuns(tabbycat, crabbytab, facts, config.unavailableTeams);
  return {
    fixture: name,
    title: config.title,
    description: config.description,
    tabbycatVersion: tabbycat.engineVersion,
    checks,
    discrepancies: classify(discrepancies, known),
  };
}

describe("differential test against Tabbycat", () => {
  const reports = fixtureNames.map(runFixture);

  it("has golden files for every fixture", () => {
    const all = readdirSync(FIXTURES, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(fixtureNames).toEqual(all.sort());
  });

  it.each(fixtureNames)("%s: every discrepancy is classified", (name) => {
    const report = reports.find((item) => item.fixture === name)!;
    const unclassified = report.discrepancies.filter((item) => item.classification === "unclassified");
    expect(unclassified.map((item) => `${item.id}: ${item.summary}`)).toEqual([]);
  });

  it("matches the committed report (regenerate with TABBYCAT_DIFF_WRITE=1 after reviewing)", () => {
    if (WRITE) {
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(join(REPORT_DIR, "report.json"), `${JSON.stringify(reportJson(reports), null, 2)}\n`);
      writeFileSync(join(REPORT_DIR, "REPORT.md"), reportMarkdown(reports));
    }
    const committed = JSON.parse(readFileSync(join(REPORT_DIR, "report.json"), "utf8")) as ReturnType<typeof reportJson>;
    const verdicts = (fixtures: { discrepancies: { id: string; classification: string }[] }[]) =>
      fixtures.flatMap((fixture) => fixture.discrepancies.map((item) => `${item.id} => ${item.classification}`)).sort();
    expect(verdicts(reports)).toEqual(verdicts(committed.fixtures));
  });
});
