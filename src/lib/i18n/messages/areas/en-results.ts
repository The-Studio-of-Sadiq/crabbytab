/**
 * English messages for the results area: results overview, ballot entry, ballot intake, feedback, standings, breaks, analytics, motions admin, projector display.
 * Each page area owns one file so parallel work never edits the same catalogue. Keys follow the
 * conventions in ../en.ts (`area.subject`, `{placeholder}`, `_one`/`_other` plurals).
 */
export const enResults = {
  // ── Shared across results pages (results.common.*) ── [SHARED]

  // ── Results overview and ballot intake (results.overview.*, results.intake.*) ── [OVERVIEW]

  // ── Ballot entry and ballot components (results.ballot.*, results.rules.*) ── [BALLOT]

  // ── Feedback review (results.feedback.*) ── [FEEDBACK]

  // ── Standings and releases (results.standings.*, results.release.*) ── [STANDINGS]

  // ── Breaks (results.break.*) ── [BREAK]

  // ── Analytics (results.analytics.*) ── [ANALYTICS]

  // ── Projector display (results.display.*) ── [DISPLAY]

  // ── Tournament overview (results.home.*) ── [HOME]
} as const;
