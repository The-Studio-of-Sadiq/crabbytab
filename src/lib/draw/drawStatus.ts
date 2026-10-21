import type { DrawStatus, Round } from "@/types";

/**
 * Draw stages, in order (Tabbycat Round.Status):
 *
 *   none -> draft -> locked -> teams_released -> released
 *
 * - `draft`: being edited; nobody but the tab room sees it.
 * - `locked`: Tabbycat's "confirmed": the draw is final but not yet released to anyone.
 * - `teams_released`: Tabbycat's "release draw (teams only)": each team sees its own pairing
 *   (room, side, opponents) on its private-URL portal, without the panel. Public pages and
 *   adjudicator portals do not show it, and adjudicators cannot submit ballots yet.
 * - `released`: the full public release (public pages subject to the draw mode, adjudicator
 *   portals, remote ballots).
 *
 * Stored values: CrabbyTab's original "confirmed" status has always meant the public release
 * (and "released" was accepted as a synonym), so both stored values map to the `released` stage
 * and existing data keeps exactly its visibility. The new stages use new stored values ("locked",
 * "teams_released"), which older app versions treat as unpublished, never as public.
 */
export type DrawStage = "none" | "draft" | "locked" | "teams_released" | "released";

export const DRAW_STAGES: readonly DrawStage[] = ["none", "draft", "locked", "teams_released", "released"];

/** The stored status a public release writes (kept "confirmed" for API and older-client compatibility). */
export const PUBLIC_RELEASE_STATUS: DrawStatus = "confirmed";

/** The stored status for each stage; `released` writes the backward-compatible "confirmed". */
export function drawStatusForStage(stage: DrawStage): DrawStatus {
  return stage === "released" ? PUBLIC_RELEASE_STATUS : stage;
}

/** The stage of a stored draw status. Unknown values count as an unreleased draft. */
export function drawStageOf(round: Pick<Round, "drawStatus"> | undefined | null): DrawStage {
  switch (round?.drawStatus) {
    case undefined:
    case "none":
      return "none";
    case "confirmed":
    case "released":
      return "released";
    case "locked":
      return "locked";
    case "teams_released":
      return "teams_released";
    default:
      return "draft";
  }
}

function stageIndex(stage: DrawStage): number {
  return DRAW_STAGES.indexOf(stage);
}

/** Whether the stage is at least `minimum` (e.g. locked or later). */
export function isDrawAtLeast(round: Pick<Round, "drawStatus"> | undefined | null, minimum: DrawStage): boolean {
  return stageIndex(drawStageOf(round)) >= stageIndex(minimum);
}

/** Fully released: public pages (per draw mode), adjudicator portals, remote ballots. */
export function isDrawPubliclyReleased(round: Pick<Round, "drawStatus"> | undefined | null): boolean {
  return drawStageOf(round) === "released";
}

/** Teams may see their own pairing on their private portal (teams-only or full release). */
export function isDrawReleasedToTeams(round: Pick<Round, "drawStatus"> | undefined | null): boolean {
  return isDrawAtLeast(round, "teams_released");
}

/** Confirmed (locked) or later: the draw is final and should not change without a recorded reason. */
export function isDrawLocked(round: Pick<Round, "drawStatus"> | undefined | null): boolean {
  return isDrawAtLeast(round, "locked");
}

/** Draw-page actions between stages (Tabbycat draw-confirm, draw-teams-release, draw-release, draw-unrelease). */
export type DrawStageAction = "lock" | "unlock" | "release_teams" | "release" | "unrelease";

/**
 * Actions offered from a stage. A draft may be released directly (CrabbyTab's one-step release,
 * kept for existing workflows) as well as confirmed first. Unreleasing returns to the confirmed
 * (locked) stage, as in Tabbycat; "unlock" returns a confirmed draw to draft for editing.
 */
export function drawStageActions(stage: DrawStage): DrawStageAction[] {
  switch (stage) {
    case "draft":
      return ["lock", "release_teams", "release"];
    case "locked":
      return ["unlock", "release_teams", "release"];
    case "teams_released":
      return ["release", "unrelease"];
    case "released":
      return ["unrelease"];
    default:
      return [];
  }
}

/** The stored status an action leaves the round in. */
export function drawStatusAfter(action: DrawStageAction): DrawStatus {
  switch (action) {
    case "lock":
    case "unrelease":
      return drawStatusForStage("locked");
    case "unlock":
      return drawStatusForStage("draft");
    case "release_teams":
      return drawStatusForStage("teams_released");
    case "release":
      return drawStatusForStage("released");
  }
}

/** Whether an action changes what participants or the public can see (it must reach the cloud). */
export function drawStageActionChangesVisibility(action: DrawStageAction): boolean {
  return action === "release_teams" || action === "release" || action === "unrelease";
}
