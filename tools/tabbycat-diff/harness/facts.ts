/**
 * Engine-neutral facts about a fixture, read straight from its DebateXML: who belongs to which
 * institution, declared conflicts, adjudicator scores and the archived draws. The comparison
 * judges both engines' draws and allocations against these, never against either engine's import.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

import type { FixtureFacts } from "./compare";
import type { FixtureConfig } from "./types";

interface ElementLike {
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): ArrayLike<ElementLike>;
  childNodes: ArrayLike<{ nodeType: number; nodeName: string }>;
  textContent: string | null;
}

function children(element: ElementLike, name: string): ElementLike[] {
  return Array.from(element.childNodes).filter(
    (node) => node.nodeType === 1 && node.nodeName === name
  ) as unknown as ElementLike[];
}

const words = (value: string | null) => (value ?? "").split(/\s+/).filter(Boolean);

export function readFixtureFacts(fixtureDir: string, config: FixtureConfig): FixtureFacts {
  const xml = readFileSync(join(fixtureDir, "tournament.xml"), "utf8");
  const root = new DOMParser().parseFromString(xml, "application/xml").documentElement as unknown as ElementLike;
  const [participants] = children(root, "participants");

  const teamInstitution = new Map<string, string | undefined>();
  for (const team of children(participants, "team")) {
    // As Tabbycat's importer does: the team's institution is its speakers' common first institution.
    const firsts = new Set(children(team, "speaker").map((speaker) => words(speaker.getAttribute("institutions"))[0]));
    teamInstitution.set(team.getAttribute("id")!, firsts.size === 1 ? [...firsts][0] : undefined);
  }

  const adjudicatorInstitution = new Map<string, string | undefined>();
  const adjudicatorScore = new Map<string, number>();
  const adjudicatorTeamConflicts = new Map<string, Set<string>>();
  const adjudicatorConflicts = new Set<string>();
  for (const adj of children(participants, "adjudicator")) {
    const id = adj.getAttribute("id")!;
    adjudicatorInstitution.set(id, words(adj.getAttribute("institutions"))[0]);
    adjudicatorScore.set(id, Number(adj.getAttribute("score") ?? 0));
    adjudicatorTeamConflicts.set(id, new Set(words(adj.getAttribute("team-conflicts"))));
    for (const other of words(adj.getAttribute("adjudicator-conflicts"))) {
      adjudicatorConflicts.add(id < other ? `${id}|${other}` : `${other}|${id}`);
    }
  }

  const history = new Map<number, { id: string; teams: string[]; adjudicators: string[] }[]>();
  children(root, "round").forEach((round, index) => {
    history.set(index + 1, children(round, "debate").map((debate) => ({
      id: debate.getAttribute("id")!,
      teams: children(debate, "side").map((side) => side.getAttribute("team")!),
      adjudicators: words(debate.getAttribute("adjudicators")),
    })));
  });

  return {
    format: config.format,
    teamInstitution,
    adjudicatorInstitution,
    adjudicatorScore,
    adjudicatorTeamConflicts,
    adjudicatorConflicts,
    history,
  };
}
