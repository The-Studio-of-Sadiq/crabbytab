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

  // TabroomTeamName (team code names "admin-tooltips-real")
  "tabroom.common.realNameTooltip": "Real name: {name}",

  // ReleaseActionDialog (public releases)
  "tabroom.common.release.uploadHelp":
    "Confirming saves this change, uploads this device's changes and publishes public pages in one step. Viewers' pages refresh within about a minute.",
  "tabroom.common.release.notUpdated": "Public pages were not updated.",
  "tabroom.common.release.uploadFailed": "The upload failed.",
  "tabroom.common.release.saveFailed": "The change could not be saved. Please try again.",
  "tabroom.common.release.uploading": "Uploading…",
  "tabroom.common.release.tryAgain": "Try upload again",
  "tabroom.common.release.saveLocal": "Save on this device",
  "tabroom.common.release.blockedTitle": "This can't be released right now",
  "tabroom.common.release.otherChanges_one": "{count} other change will be uploaded too",
  "tabroom.common.release.otherChanges_other": "{count} other changes will be uploaded too",
  "tabroom.common.release.otherChangesHelp":
    "Changes made on this device since the last upload are published together with this release.",
  "tabroom.common.release.savedNotPublic": "Saved on this device, but not public yet",

  // RuleOverrideHost
  "tabroom.common.override.title": "This action breaks a tournament rule",
  "tabroom.common.override.description":
    "Proceed only if the tab room has agreed to. Your reason is recorded in the audit log.",
  "tabroom.common.override.confirm": "Override and continue",
  "tabroom.common.override.rulesLabel": "Rules that would be overridden",
  "tabroom.common.override.reasonLabel": "Reason for overriding",
  "tabroom.common.override.reasonRequired": "Enter a reason to continue.",
} as const;
