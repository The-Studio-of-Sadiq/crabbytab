/**
 * English messages for the setup area, part "data" (see ../en-setup.ts): data exports, backup
 * restore, sync conflicts, rehearsal tools and the API reference. Keys are `setup.data.<subject>`.
 */
export const dataEn = {
  // Data exports (/[slug]/exports)
  "setup.data.exports.title": "Data exports",
  "setup.data.exports.description":
    "CSV files for spreadsheets and other tools. They hold participant details (including email addresses), so share them carefully. Private URL keys and passcodes are never exported.",
  "setup.data.exports.adminOnly": "Only tournament administrators can export tournament data.",
  "setup.data.exports.groupParticipants": "Participants",
  "setup.data.exports.groupRounds": "Rounds and breaks",
  "setup.data.exports.teams": "Teams",
  "setup.data.exports.teamsHelp": "One row per team with its speakers, institution and break categories.",
  "setup.data.exports.speakers": "Speakers",
  "setup.data.exports.speakersHelp": "One row per speaker with team, institution, email and speaker categories.",
  "setup.data.exports.adjudicators": "Adjudicators",
  "setup.data.exports.adjudicatorsHelp": "Scores, trainee/independent status, adjudication core and breaking flags.",
  "setup.data.exports.institutions": "Institutions",
  "setup.data.exports.institutionsHelp": "Name, code, region and how many teams and adjudicators each has.",
  "setup.data.exports.availability": "Availability",
  "setup.data.exports.availabilityHelp":
    "Who is available in each round (check-ins with their expiry, round availability, venues).",
  "setup.data.exports.breakEligibility": "Break eligibility",
  "setup.data.exports.breakEligibilityHelp":
    "Each team's eligibility, overrides and speaker-category rule per break category.",
  "setup.data.exports.conflicts": "Conflicts",
  "setup.data.exports.conflictsHelp": "Adjudicator and team conflicts, in the format the conflicts import reads.",
  "setup.data.exports.exportCsv": "Export CSV",
  "setup.data.exports.exportLabel": "Export {label} as CSV",
  "setup.data.exports.exported": "{label} exported.",

  // Backup restore dialog
  "setup.data.backup.title": "Restore tournament backup",
  "setup.data.backup.intro":
    "Choose a backup of {tournament}. It is checked and compared with the data on this device before anything changes.",
  "setup.data.backup.thisTournament": "this tournament",
  "setup.data.backup.fileLabel": "Backup file (.json)",
  "setup.data.backup.checking": "Checking the backup…",
  "setup.data.backup.readFailed": "Could not read the backup.",
  "setup.data.backup.restoreFailed": "The restore failed. Nothing was changed.",
  "setup.data.backup.merged": "Backup merged. Records that were missing here were added; existing records were kept.",
  "setup.data.backup.replaced":
    "Tournament data replaced with the backup. Your previous data was downloaded as a pre-restore backup.",
  "setup.data.backup.cannotRestore_one": "This backup cannot be restored ({count} problem):",
  "setup.data.backup.cannotRestore_other": "This backup cannot be restored ({count} problems):",
  "setup.data.backup.error": "Error",
  "setup.data.backup.warning": "Warning",
  "setup.data.backup.issueIn": " in {collection}",
  "setup.data.backup.issueInRecord": " in {collection} ({record})",
  "setup.data.backup.warnings": "Warnings ({count}): these records can still be restored.",
  "setup.data.backup.exportedAt": "Backup exported {time}.",
  "setup.data.backup.unknownTime": "at an unknown time",
  "setup.data.backup.compared": " Compared with this device:",
  "setup.data.backup.matches": " It matches the data on this device.",
  "setup.data.backup.tableCaption": "Differences between the backup and this device",
  "setup.data.backup.colRecords": "Records",
  "setup.data.backup.colOnlyBackup": "Only in backup",
  "setup.data.backup.colOnlyHere": "Only here",
  "setup.data.backup.colDifferent": "Different",
  "setup.data.backup.colSame": "Same",
  "setup.data.backup.collection.rounds": "Rounds",
  "setup.data.backup.collection.teams": "Teams",
  "setup.data.backup.collection.adjudicators": "Adjudicators",
  "setup.data.backup.collection.venues": "Venues",
  "setup.data.backup.collection.motions": "Motions",
  "setup.data.backup.collection.breakCategories": "Break categories",
  "setup.data.backup.collection.debates": "Debates",
  "setup.data.backup.collection.ballots": "Ballots",
  "setup.data.backup.collection.feedback": "Feedback",
  "setup.data.backup.collection.institutions": "Institutions",
  "setup.data.backup.collection.auditEvents": "Audit log (always merged)",
  "setup.data.backup.collection.ballotIntake": "Ballot intake",
  "setup.data.backup.settingsDiffer":
    "Tournament settings differ. Replace uses the backup's settings; the URL, owner and administrators never change.",
  "setup.data.backup.mergeTitle": "Merge",
  "setup.data.backup.mergeHelp":
    "Adds the records that are only in the backup. Records on this device are kept as they are.",
  "setup.data.backup.mergeButton": "Merge backup",
  "setup.data.backup.replaceTitle": "Replace",
  "setup.data.backup.replaceHelp_one":
    "Makes this tournament exactly match the backup: {count} record only on this device will be deleted and {changed} will be overwritten. A pre-restore backup downloads first.",
  "setup.data.backup.replaceHelp_other":
    "Makes this tournament exactly match the backup: {count} records only on this device will be deleted and {changed} will be overwritten. A pre-restore backup downloads first.",
  "setup.data.backup.replaceConfirm": "I understand that this replaces the tournament's data on this device.",
  "setup.data.backup.replaceButton": "Replace this tournament's data",

  // Sync conflicts dialog
  "setup.data.sync.title": "Sync conflicts",
  "setup.data.sync.description":
    "These records changed on this device and in the cloud since this device last synced them. This device's version stays in use until you choose.",
  "setup.data.sync.resolveFailed": "Could not resolve the conflict.",
  "setup.data.sync.useAllCloudConfirm_one":
    "Use the cloud version of {count} record? This device's changes to it are discarded. Export a tournament backup first to keep a copy.",
  "setup.data.sync.useAllCloudConfirm_other":
    "Use the cloud version of all {count} records? This device's changes to them are discarded. Export a tournament backup first to keep a copy.",
  "setup.data.sync.keepAllMineConfirm_one":
    "Keep this device's version of {count} record? The next upload replaces the cloud version, which is archived for recovery.",
  "setup.data.sync.keepAllMineConfirm_other":
    "Keep this device's version of all {count} records? The next upload replaces the cloud versions, which are archived for recovery.",
  "setup.data.sync.keepAllMine": "Keep all of mine",
  "setup.data.sync.useAllCloud": "Use all cloud versions",
  "setup.data.sync.noneLeft": "No conflicts left. Upload to send the versions you kept to the cloud.",
  "setup.data.sync.keepMine": "Keep mine",
  "setup.data.sync.keepMineLabel": "Keep this device's version of {kind} {name}",
  "setup.data.sync.useCloud": "Use cloud",
  "setup.data.sync.useCloudLabel": "Use the cloud version of {kind} {name}",
  "setup.data.sync.missingLocally": "This device no longer has this record.",
  "setup.data.sync.fieldsCaption": "Fields that differ for {name}",
  "setup.data.sync.colField": "Field",
  "setup.data.sync.colThisDevice": "This device",
  "setup.data.sync.colCloud": "Cloud",

  // Rehearsal tools (/[slug]/rehearsal)
  "setup.data.rehearsal.title": "Rehearsal tools",
  "setup.data.rehearsal.description":
    "Fill a round with random but valid results or feedback to rehearse running the tournament.",
  "setup.data.rehearsal.adminOnly": "Only tournament administrators can use the rehearsal tools.",
  "setup.data.rehearsal.demoBadge": "Demo tournament",
  "setup.data.rehearsal.demoTitle": "Rehearsal data",
  "setup.data.rehearsal.demoBody":
    "Simulated ballots and feedback are confirmed like real ones and marked “Simulated (rehearsal)”.",
  "setup.data.rehearsal.liveTitle": "This is not a demo tournament",
  "setup.data.rehearsal.liveBody":
    "Simulated ballots are confirmed and count in the standings like real ones. Use these tools only for a rehearsal, never during the event. Each run is recorded in the audit log.",
  "setup.data.rehearsal.cardTitle": "Round and seed",
  "setup.data.rehearsal.roundLabel": "Round (with a draw)",
  "setup.data.rehearsal.noDrawnRound": "No round has a draw yet",
  "setup.data.rehearsal.seedLabel": "Seed",
  "setup.data.rehearsal.seedHelp": "The same seed on the same draw gives the same results.",
  "setup.data.rehearsal.confirmLabel": "Type <code>{name}</code> to confirm this is a rehearsal",
  "setup.data.rehearsal.simulateResults": "Simulate results",
  "setup.data.rehearsal.simulateFeedback": "Simulate feedback",
  "setup.data.rehearsal.failed": "The simulation failed. Nothing was saved.",
  "setup.data.rehearsal.resultsSimulated_one": "{count} ballot simulated",
  "setup.data.rehearsal.resultsSimulated_other": "{count} ballots simulated",
  "setup.data.rehearsal.feedbackSimulated_one": "{count} feedback submission simulated",
  "setup.data.rehearsal.feedbackSimulated_other": "{count} feedback submissions simulated",

  // API reference (/tournaments/api). Route summaries come from the English route definitions.
  "setup.data.api.title": "CrabbyTab API reference",
  "setup.data.api.intro":
    "A REST API for one tournament at a time, with bearer tokens issued by its administrators (tournament menu → <b>API access</b>). Machine-readable contract: <link>/api/openapi.json</link> (OpenAPI 3.1).",
  "setup.data.api.groupsNav": "Endpoint groups",
  "setup.data.api.authTitle": "Authentication and scopes",
  "setup.data.api.scopesIntro":
    "<code>{readPublic}</code> sees exactly what the public site shows. Administrator tokens get <code>{readArea}</code> or <code>{writeArea}</code> (write implies read) for each area:",
  "setup.data.api.writes":
    "Writes use the same commands and tournament rules as the tab room. A change blocked by an overridable rule returns <code>{conflict}</code>; retry with <code>{override}</code> to proceed (the reason is audited). List endpoints take <code>{limit}</code> and <code>{cursor}</code> and return <code>{page}</code>. Limits: {perMinute} requests per token per minute, {perHour} writes per token per hour.",
  "setup.data.api.moreExamples": "More examples: <link>docs/api.md</link>.",
  "setup.data.api.scope": "Scope: <code>{scope}</code>",
  "setup.data.api.paginated": " · paginated",
  "setup.data.api.noAuth": "No authentication",
  "setup.data.api.participantAuth": "Private URL key + passcode",
} as const;
