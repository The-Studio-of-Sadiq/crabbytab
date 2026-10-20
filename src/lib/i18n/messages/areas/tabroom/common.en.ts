/** English messages for the tabroom area, part "common" (see ../en-tabroom.ts). Keys are `tabroom.common.<subject>`. */
export const commonEn = {
  "tabroom.common.noCancel": "No, cancel",
  "tabroom.common.saving": "Saving…",
  "tabroom.common.closeDialog": "Close dialog",
  "tabroom.common.cancelEsc": "Cancel (Esc)",
  "tabroom.common.moveCancelled": "Move cancelled.",
  "tabroom.common.nothingChanged": "Nothing changed.",

  // CurrentRoundsBar
  "tabroom.common.roundsInSlot": "Rounds in schedule slot {slot}",
  "tabroom.common.runningSameTime": "Running at the same time:",
  "tabroom.common.noDraw": "no draw",
  "tabroom.common.resultsProgress": "{done}/{count} results",
  "tabroom.common.debateCount_one": "{count} debate",
  "tabroom.common.debateCount_other": "{count} debates",
  "tabroom.common.sharesParticipants": "(shares participants with another round)",
  "tabroom.common.clash": "Clash",
  "tabroom.common.clashSummary_one": "{round} runs at the same time as {rounds}, but shares {items} with it.",
  "tabroom.common.clashSummary_other": "{round} runs at the same time as {rounds}, but shares {items} with them.",
  "tabroom.common.clashTeams_one": "{count} team ({names})",
  "tabroom.common.clashTeams_other": "{count} teams ({names})",
  "tabroom.common.clashAdjudicators_one": "{count} adjudicator ({names})",
  "tabroom.common.clashAdjudicators_other": "{count} adjudicators ({names})",
  "tabroom.common.clashVenues_one": "{count} venue ({names})",
  "tabroom.common.clashVenues_other": "{count} venues ({names})",
  "tabroom.common.clashItem": "{name} in {round}",
  "tabroom.common.andMore": "{list}, …",

  // ComputeStatus
  "tabroom.common.computeDraw": "Generating the draw… {seconds} s",
  "tabroom.common.computeAllocation": "Allocating adjudicators… {seconds} s",
} as const;
