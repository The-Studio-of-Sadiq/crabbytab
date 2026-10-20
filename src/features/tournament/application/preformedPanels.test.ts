import { describe, expect, it } from "vitest";
import type { Adjudicator, Round } from "@/types";
import {
  assignToPanel,
  emptyPreformedPanel,
  panelsFromPreformedIds,
  savePreformedPanelsCommand,
  validatePreformedPanels,
} from "./preformedPanels";

const adj = (id: string, baseScore = 5, extra: Partial<Adjudicator> = {}): Adjudicator => ({
  id,
  tournamentId: "t",
  name: id,
  baseScore,
  trainee: false,
  independent: true,
  conflicts: [],
  ...extra,
});

describe("preformed panel editing", () => {
  it("moves an adjudicator between panels and demotes a replaced chair", () => {
    let panels = [emptyPreformedPanel("p1"), emptyPreformedPanel("p2")];
    panels = assignToPanel(panels, "p1", "a", "chair");
    panels = assignToPanel(panels, "p1", "b", "chair");
    expect(panels[0]).toMatchObject({ chairId: "b", panellistIds: ["a"] });
    panels = assignToPanel(panels, "p2", "a", "trainee");
    expect(panels[0].panellistIds).toEqual([]);
    expect(panels[1].traineeIds).toEqual(["a"]);
  });

  it("builds panels from CSV preformed panel ids", () => {
    const panels = panelsFromPreformedIds([
      adj("weak", 4, { preformedPanelId: "B" }),
      adj("strong", 8, { preformedPanelId: "B" }),
      adj("trainee", 3, { preformedPanelId: "B", trainee: true }),
      adj("solo", 6, { preformedPanelId: "A" }),
      adj("none", 9),
    ]);
    expect(panels).toEqual([
      { id: "csv-A", chairId: "solo", panellistIds: [], traineeIds: [], importance: 0 },
      { id: "csv-B", chairId: "strong", panellistIds: ["weak"], traineeIds: ["trainee"], importance: 0 },
    ]);
  });

  it("reports duplicates, missing chairs, trainees voting and unknown adjudicators", () => {
    const adjudicators = [adj("a"), adj("b"), adj("t", 3, { trainee: true })];
    expect(validatePreformedPanels([
      { id: "p1", chairId: "a", panellistIds: ["t"], traineeIds: [], importance: 0 },
      { id: "p2", panellistIds: ["a", "ghost"], traineeIds: [], importance: 11 },
    ], adjudicators)).toEqual([
      "Panel 1: t is a trainee and cannot vote.",
      "Panel 2: importance must be between 0 and 10.",
      "Panel 2 needs a chair.",
      "a is in Panel 1 and Panel 2.",
      "Panel 2 includes an adjudicator who no longer exists.",
    ]);
    expect(validatePreformedPanels(
      [{ id: "p1", chairId: "a", panellistIds: ["b"], traineeIds: ["t"], importance: 5 }],
      adjudicators
    )).toEqual([]);
  });

  it("saves valid panels on the round and refuses invalid ones", async () => {
    const round = { id: "r1", name: "Round 1" } as Round;
    const saved: Round[] = [];
    const audits: string[] = [];
    const dependencies = {
      rounds: [round],
      adjudicators: [adj("a")],
      updateRound: async (item: Round) => { saved.push(item); },
      recordAuditEvent: async (event: { action: string }) => { audits.push(event.action); },
    };
    const panel = { id: "p1", chairId: "a", panellistIds: [], traineeIds: [], importance: 0 };

    await savePreformedPanelsCommand("r1", [panel], dependencies);
    expect(saved[0].preformedPanels).toEqual([panel]);
    expect(audits).toEqual(["adjudicators.preformed_panels_saved"]);

    await expect(
      savePreformedPanelsCommand("r1", [{ ...panel, chairId: undefined, panellistIds: ["a"] }], dependencies)
    ).rejects.toThrow("Panel 1 needs a chair.");
    expect(saved).toHaveLength(1);

    // Empty panels (anticipated rooms not filled yet) can be saved.
    await savePreformedPanelsCommand("r1", [{ ...panel, chairId: undefined }], dependencies);
    expect(saved).toHaveLength(2);
  });
});
