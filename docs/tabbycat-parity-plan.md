# CrabbyTab → Tabbycat parity plan

Baseline: `origin/beta` @ `3ff7653` (14 commits ahead of `main`). All file refs are on beta.
Health check run on beta (2026-10-18): `vitest` 301/301 pass · `next lint` pass (5 hook-deps warnings) ·
`next build` pass · `tsc --noEmit` **fails: 33 errors, all in test files** (precedence/calculator/tournamentBackup/email tests).

## Status as of 2026-10-19

**Read this before re-reporting a finding.** Every item below was checked against the code at
`origin/beta` f2abf35 plus the sync/publish hardening PR. The line refs in the sections further
down are from the older baseline and are stale; the Notes column gives the current file. "This PR"
means the sync/publish hardening PR that added this section.

| Item | Status | PR | Notes |
|---|---|---|---|
| 0.1 private sync 503 on soft-deleted debate | FIXED | #9 | `lib/privateSync.ts` `selectAssignedDebates` |
| 0.2 non-global-admin upload / `tournamentSlugs` rule | FIXED | #9 | `firestore.rules` `match /tournamentSlugs/{slug}` (not emulator-tested) |
| 0.3 server writes don't bump `syncVersion` | FIXED | #23, #27 | `privateSync.ts` `supersededBallotUpdate`; `data-entry-sync/route.ts` bumps on every write |
| 0.4 download keeps local over cloud (no convergence) | FIXED | #24, #25, #27 | `cloudSync.ts` `mergeCloudIntoWorkingCopy` with synced baseline and conflicts dialog |
| 0.5 chair private ballot discards tab-confirmed ballot | FIXED | #9 | `privateSync.ts` `isTabRoomConfirmed` / `planPrivateBallotWrites` |
| 0.6 unrevealed panels / unreleased draws leak to teams | FIXED | #9 | `privatePortalBallots.ts` gates on `adjudicatorsRevealed` / `motionsReleased` (confirmed draws still count as visible, see 0.11) |
| 0.7 assistants write confirmed ballots etc.; `assistant-data` over-shares | FIXED | #9 | `lib/dataEntrySync.ts` field whitelists and forced `confirmed:false` |
| 0.8 `ownerId` rewrite, open tournament create, slug squatting | FIXED | #9 | `firestore.rules`: create is global-admin only, `ownerId` immutable |
| 0.9 passcode `===`; enumeration not rate-limited | FIXED | #9 | `lib/passcode.ts` `timingSafeEqual`; `checkPrivateFailureLimit` runs before key lookup |
| 0.10 signed-out viewer of local tournament is admin | FIXED | #9 | `tournamentAccess.ts` `isViewerTournamentAdmin` |
| 0.11 v1 `read:public` returns confirmed draws | NOT A BUG | wave 1 | In CrabbyTab `drawStatus: "confirmed"` *is* the public release ("Release Draw to Public" sets it, `draw/page.tsx`); nothing in the UI sets `"released"`. Returning confirmed draws is correct. |
| 0.12 test-file TS errors; `tsc` in CI | FIXED | #9 | `.github/workflows/ci.yml` runs `npx tsc --noEmit` |
| 0.13 CSP / security headers | FIXED | #9 | `securityHeaders.mjs` wired in `next.config.mjs` |
| 0.5-1 publish-time snapshots | FIXED | #8, this PR | `lib/publicView/{snapshot,store}.ts`; releases now upload and publish in one step |
| 0.5-2 Vercel Data Cache | FIXED | #8 | `store.ts` `unstable_cache` + `revalidateTag` |
| 0.5-3 CDN `s-maxage` | FIXED | #8 | `store.ts` `publicCacheHeaders` |
| 0.5-4 version polling | FIXED | #8 | `application/publicView.ts` polls `/version` every 45 s |
| 0.5-5 check-in counts aggregate | PARTIAL | #8 | served from the snapshot's `checkins` section, refreshed only on publish; no per-check-in aggregate doc |
| 0.5-6 private-URL query narrowing | MOSTLY FIXED | #32 | `api/private/sync/route.ts` loads only the participant's debates via the `array-contains` participant index (`privateParticipantData.ts`); still reads all rounds, and falls back to a full read when the index is missing |
| 0.5-7 v1 draws from snapshot | FIXED | #45 | `read:public` tokens (every v1 endpoint, including the legacy `/draws`) are served from the published public view (`lib/api/v1/data.ts` `createPublicData`) |
| 0.5-8 `preferredRegion` | OPEN | — | not set anywhere in `src` |
| 0.5 note: fingerprint-only publish skip missed other devices' writes | FIXED | this PR | skip also needs a matching cloud source token (`snapshot.ts` `publicSourceToken`, `canSkipPublish`) |
| Sync: releases looked public but were local until Upload | FIXED | this PR | `ReleaseActionDialog` saves, uploads and publishes in one step |
| Sync: Republish ignored unuploaded local changes | FIXED | this PR | asks first (`syncStatus.ts` `planRepublish`, `Navbar.tsx`) |
| Sync: upload published despite conflicts / part-way failure | FIXED | this PR | refused (`publishBlockerAfterUpload`, `UploadIssue`) |
| Sync: no unsynced indicator or `beforeunload` warning | FIXED | this PR | `computePendingChanges`, top-bar sync status, `useBeforeUnloadWarning` |
| C CSV exports: participants, availability, break eligibility, conflicts | FIXED | #55 | `lib/csv/participantExports.ts`, Data exports page; conflicts round-trip through the conflicts import; see [data-import-export.md](./data-import-export.md) |
| C demo tournament, simulated results and feedback (rehearsals) | FIXED | #55 | `lib/rehearsal/demoTournament.ts`, `application/rehearsal.ts`, Rehearsal tools page; seeded, through the ballot/feedback commands, typed confirmation outside demo tournaments, audited |
| 24 REST API: read endpoints, per-area scopes, `/me`, OpenAPI 3.1 | FIXED | #45 | `lib/api/v1/*`, `app/api/v1/[[...path]]`; every Tabbycat v1 read resource except users/groups/global institutions/schedule events/web push; public scope = published view; see [api.md](./api.md) |
| 24 REST API: write endpoints (CRUD, generate draw/break, allocation, ballots, check-ins, feedback, publish) | FIXED | #51 | `lib/api/v1/{session,tabRoom,ballotInput}.ts`, `routes/write/*`; every write runs the tab-room command and guards in one transaction, bumps `syncVersion`, archives the replaced version and audits with the token; overridable rules via `override.reason`; see [api.md](./api.md#writes) |
| 1.1 elimination rounds counted in standings | FIXED | #10 | `standings/calculator.ts` filters elimination and cancelled rounds |
| 1.2 real margins | FIXED | #10 | `ballots/result.ts` margin = difference of team totals |
| 1.3 reply ids `reply-AFF/NEG` | FIXED | #10 | portal attributes the reply to a real speaker; old ids excluded from tabs |
| 1.4 ghost / iron-person | FIXED | #10 | `ballots/result.ts` ghost flagging and `teamScoreIncludesGhosts` |
| 1.5 pullups persisted; metric direction | FIXED | #15 | `generator.ts` writes `pulledUp`; `metrics.ts` `pullups: 1` (more ranks higher, as Tabbycat's `npullups`; corrected in wave 4/5) |
| 1.6 bye win fabricates speaks | FIXED | #15 | `standings/calculator.ts` bye records team result only |
| 1.7 rank-vs-score (low-point win) validation | FIXED | #10 | `ballots/result.ts` checks `allowLowPointWins` |
| 1.8 round completion for prelims | FIXED | #11 | `roundAdministration.ts` `getRoundCompletionBlockers` / `setRoundCompletion` |
| 1.9 availability mismatch (editors vs generator) | PARTIAL | #23 | generator, allocator and `validateDraw` use per-round availability; draw and allocation editor pools still filter global `checkedIn` |
| 1.10 breaks (AIDA reserves, per-category, ties, non-power-of-two) | FIXED | #11, wave 2 #8 | reserves, per-category status and partial elims; cutoff ties at the break and reserve cutoff reported (`BreakCategoryResult.cutoffTies`) and block generation until resolved with overrides (docs/standings-and-breaks.md) |
| 1.11 venue re-allocation not persisted | OPEN | — | `application/allocation.ts` cloud save still passes `updatedRoundDebates` (latent while `AUTOMATIC_CLOUD_WRITES=false`; local save is correct) |
| 1.12 dead/no-op prefs | PARTIAL | #10, #12, #15 | draw penalties, `marginIncludesDissenters`, `usePreformedPanels` wired; `*StandingsExtra` shown on the admin and public tabs (wave 2 #8); `preliminaryPanelsPerScheduleSlot` still unused |
| 2 BP draw (Hungarian, position cost, pullups) | FIXED | #15, wave 2 #10 | `draw/powerPaired.ts`; same pull-up counts and Tabbycat position cost as recorded Tabbycat v2.12.1 draws (`tools/tabbycat-diff`) |
| 2 two-team draw (intermediate, bubble, min_cost, seeded, preallocated) | FIXED | #15 | `twoTeamDraw.ts`, `oddBrackets.ts`, `minCostPairing.ts`, `weightedMatching.ts`, `rng.ts` |
| 2 allocator: importance-weighted cost, soft history, user weights | FIXED | #12 | `draw/allocator.ts`; `prioritizeClashAvoidance` removed |
| 2 allocator: adj↔adj conflicts, trainees conflict-checked | FIXED | #12 | `allocator.ts` `adjudicatorsConflict` |
| 2 allocator: panel size by importance | FIXED | #12 | `allocator.ts` `by_priority` sizing |
| 2 allocator: feedback weight and test score | FIXED | #12 | `feedback/scores.ts` `preFeedbackScore`; blend uses `feedbackWeight` |
| 2 allocator: preformed panels | FIXED | #12 | `Round.preformedPanels`, `allocation/panels` page |
| 2 allocator: iteration cap | FIXED | #12 | `allocator.ts` 50-pass cap plus evaluation budget |
| 2 allocator: Web Worker | FIXED | #32 | `features/tournament/compute/compute.worker.ts` + `computeClient.ts`; draw and allocation pages use it |
| 2 elim: partial eliminations / byes | FIXED | #11 | `draw/elimination.ts` `planEliminationRound` |
| 2 elim: bracket position preserved | FIXED | #11 | `elimination.ts` `resolveBracketPositions` |
| 2 elim: BP elim sides by seed | UNVERIFIED | — | sides are fixed in seed order (OG = top seed); no seed-choice option |
| 2 elim: manual break overrides and remarks | FIXED | #11 | `BreakCategory.teamOverrides`, `breakqual/calculator.ts` |
| 2 elim: adjudicator break | FIXED | #16 | `Adjudicator.breaking` and public breaking-adjudicators list |
| 2 standings extras (who-beat-whom, votes, iron-person count, min speeches, reply stddev/count, team points as speaker metric) | FIXED | wave 2 #8, wave 4/5 | `wbw` (repeatable), `num_adjs`, `num_iron`, missed-speeches/replies eligibility and the high-low trimmed mean (wave 2); reply stddev/count and the speaker team metrics (wave 4/5) |
| 3 voting ballots | FIXED | #10, wave 2 #9 | majority, dissent, `marginIncludesDissenters`; consensus or voting per stage (`eliminationBallotMode`, read through `ballotModeFor`) |
| 3 blind double entry, version history, entered/checked by | FIXED | #10 | `ballotEntry.ts`, `BallotDiffDialog`, `BallotHistory` |
| 3 vetoes, veto stats, motions by round, forfeits | FIXED | #10 | `BallotSubmission.vetoes` / `forfeitSide`; vetoes in analytics |
| 3 feedback progress, weights, ignore/confirm, detail page, debate-linked, base/test scores | FIXED | #12 | `lib/feedback/*`, `feedback/adjudicator` page |
| 3 feedback question types (integer box, float box, checkbox, integer scale) | FIXED | wave 3 #17 | `lib/feedback/questions.ts`; validated client-side and in `api/private/sync` and `data-entry-sync`; printed; DebateXML `i`/`f`/`bc`/`is` |
| 3 configurable feedback paths, separate elimination paths | FIXED | wave 3 #17 | `lib/feedback/paths.ts` drives progress, portals (client and server), tab-room entry and printed forms |
| 3 base/test score history, per-question answer analysis | FIXED | wave 3 #17 | `lib/feedback/scoreHistory.ts` (`Adjudicator.scoreHistory`, in backups); `lib/feedback/answers.ts`; `feedback/adjudicator` page |
| 3 conflicts UI; conflicts wiped on institution change | FIXED | #12 | `AdjudicatorConflictsEditor`, `changeAdjudicatorInstitution` |
| 3 diversity | PARTIAL | #12 | fields, editor badges, per-panel summary done; no diversity stats page |
| 3 round lifecycle and release | PARTIAL | #11, #16 | completion and per-tab/list release flags done; no motions-tab release; format change not guarded after draws exist |
| 3 public site | PARTIAL | #11, #16 | tabs, lists, break per category, projector reveal, by-team view done; no public (non-private) feedback or ballot submission |
| 3 draw editor flags / adj search / touch-keyboard | PARTIAL | #23, wave 3 #15 | inline rematch (with rounds), institution, side history and imbalance, pull-up, bracket and room-rank flags (`drawFlags.ts`); draw details view; Move then Place/Swap team placement with live announcements (`drawEditing.ts`); adjudicator search and keyboard placement on the allocation page still open |
| 2 manual-ballot sides, swing teams | FIXED | wave 3 #16 | `manualSides.ts` (sides recorded on tab-room, portal and printed ballots; history and standings read them); `swingTeams.ts`, `Team.isSwing` excluded from standings and breaks |
| 3 data (DebateXML import, CSV exports, backup restore) | FIXED | #14 | `debateXmlImport.ts`, `csv/exporters.ts`, `tournamentBackup.ts` |
| 3 notifications, QR slips, self check-in | FIXED | #16 | `api/tournaments/[id]/notifications`, `lib/qr/qrcode.ts` |
| 3 team break eligibility and speaker categories | FIXED | #11 | `TeamCategoryFields.tsx`; CSV `break_categories` |
| 3 import preview, duplicates, institution auto-create, conflicts CSV (wave 3 #12) | FIXED | wave 3 #12 | `csv/importPlan.ts` (preview, row errors/warnings, skip/update/create, valid-rows-only, new institutions with editable codes), `csv/conflictsImport.ts` (all four conflict types; team–institution conflicts honoured by the allocator); venue/motion CSVs still import without preview |
| 3 speaker categories as entities (wave 3 #13) | FIXED | wave 3 #13 | `lib/speakerCategories.ts`: name/slug/public/limit/seq in `preferences.speakerCategories`, labels resolved on read (no migration writes), category-ranked admin filter and public tabs, break eligibility rule applied on confirmation |
| 4.1 sync model B (Firestore source of truth) | PARTIAL | #24, #25, #27, #30, wave 2 #6 | step 1 live: ballots, debates (draw/allocation) and teams/adjudicators (check-ins) are written per record (field-level `mergeFields` batches) and read through current-round `onSnapshot` listeners on admin devices, with the SDK's `persistentLocalCache` queuing offline writes (`liveSync.ts`, `liveSession.ts`, `liveRepository.ts`, [live-collaboration.md](./live-collaboration.md)); settings, rounds, motions, rooms, breaks, feedback and audit stay upload/download; assistants not live yet (rules allow their unconfirmed-ballot and check-in writes); no rules emulator tests |
| 4.2 split `TournamentContext`, memoize value | OPEN | — | ~2.6k lines; provider value is an inline object |
| 4.3 bound local `auditEvents` | OPEN | — | no limit |
| 4.4 heavy compute in Web Workers | FIXED | #32 | draw generation and allocation run in `compute.worker.ts` |
| 4.5 rules / API-route / e2e / golden tests | PARTIAL | #23, wave 2 #10 | Vitest BP+WSDC lifecycles, fake-Firestore sync tests, differential test against recorded Tabbycat output (`tools/tabbycat-diff`); no rules-emulator, route or Playwright tests |
| 4.6 cleanup (`metadata.json`, lockfiles, README sync) | PARTIAL | #24, #25, #27 | README sync text updated; `metadata.json` and both lockfiles remain |
| 5 i18n | PARTIAL | #28 | in-house `lib/i18n`; public pages and portals only |
| 5 accessibility | PARTIAL | #22 | `Dialog` focus trap and labelled primitives; legacy pages not migrated; no keyboard drag-and-drop |
| 5 mobile round creation below `md` | FIXED | #22 | `Navbar.tsx` round switcher with "New round…" at every width |
| 5 configurable analytics ranges | OPEN | — | `analytics/page.tsx` hardcodes bins 68–84 |

**Still open:** 0.5-7, 0.5-8, 1.11, 4.2, 4.3, analytics ranges. **Partial:** 0.5-5, 1.9, 1.12, Phase 2 standings
extras (two speaker metrics), diversity stats page, motions-tab release and format-change guard, public non-private
submission, allocation-page keyboard placement, 4.1, 4.5, 4.6, i18n,
accessibility. **Unverified:** BP elimination sides by seed.

## Feature comparison and roadmap (2026-10-19, `beta` 591c1ac)

A feature-by-feature check of `beta` against Tabbycat 2.x (verified in code, not docs) found
CrabbyTab at or beyond parity for two-team and BP draw rules, knockouts with partial
eliminations, the draw check, enforced round rules with audited overrides, preformed panels,
feedback-weighted allocation, check-ins, private portals, the hash-chained audit log, DebateXML
import/export and backup/restore. The remaining gaps, in priority order:

**Wave 1 — P0 correctness (this PR).** Round motions never reached portals/assistants
(`Round.motionsReleased` was never set; now derived from motion releases); the double-entry
"different person checks" rule was UI-only (now `checkIndependentConfirmation`, overridable with
an audited reason); the speaker-tab category filter compared break-category ids with speaker
category labels; every format preset used the 68–84 scale (now per format: BP 50–100, Australs
and UADC 70–80 / 35–40, WSDC 60–80 / 30–40). 0.11 turned out not to be a bug (see the table).

**Wave 2 — P1, running a large live event (parallel).**
- **#6 Live multi-user collaboration** (L): sync model B — Firestore as source of truth with
  current-round listeners, starting with ballots, check-ins and allocation. *Step 1 done: see
  `live-collaboration.md` for the hybrid, conflict semantics and limitations.*
- **#7 Paper-ballot intake board** (M): per-round status (missing / received / entered / awaiting
  check / confirmed / disputed), one printed ballot per adjudicator with a barcode, scan on arrival.
  Done: see [ballot-intake.md](ballot-intake.md).
- **#8 Standings and break depth** (M): ties at the break cutoff, minimum-speeches eligibility,
  trimmed mean dropping highest and lowest, who-beat-whom, votes carried, show the configured
  "extra" columns. **#9** (S): ballot mode per stage (prelims vs elims) and the missing presets
  (NZ Easters, Joynt, Canadian, Japan BP). *Done in wave 2 (see docs/standings-and-breaks.md):
  cutoff ties are reported and must be resolved with overrides rather than growing the break as
  Tabbycat does; Tabbycat has no Japan BP preset (BP is used); APDA, Public Speaking and Karl
  Popper presets are not offered because CrabbyTab lacks the features they need.*
- **#10 Differential testing against real Tabbycat** (M): identical fixtures through Tabbycat
  (Docker) and CrabbyTab; compare draws (by rules), standings, breaks and allocations. *Done:
  `tools/tabbycat-diff` (README there) with three seeded fixtures, golden output from Tabbycat
  v2.12.1, and a classified report run in `npm test`. Findings below.*

### Differential test findings (wave 2 #10, Tabbycat v2.12.1)

Full list with evidence: [tools/tabbycat-diff/report/REPORT.md](../tools/tabbycat-diff/report/REPORT.md).
In the three fixtures, breaks, BP draws (bracket composition, pull-ups, Tabbycat position cost),
Australs draws, BP standings ranks and hard allocation constraints agree with Tabbycat.

Fixed in that PR:
- Speaker standings lost a reply speaker's substantive scores up to and including their first reply
  (the first reply reset the speaker's score list), so in reply formats the speakers who reply were
  ranked too low (`standings/calculator.ts`).

CrabbyTab defects left open (follow-ups):
- **Voting precision.** Averaged voting ballots are rounded to 0.01 (`ballots/result.ts`), so margins,
  standard deviations and averages drift from Tabbycat and real ties split (three speakers on
  224/3 ranked 38th and 39th). The fix changes stored ballot data, so it needs a migration decision.
- **Side cap refuses feasible draws.** With "max times per side", two-team draws apply the cap after
  pairing (`sideAllocator.ts`) and refuse the round (7 of 8 seeds in the fixture) when fold pairs two
  teams that both need the same side, although valid pairings exist. The cap should constrain the pairing.
- **Votes carried after import.** The DebateXML importer stores a debate with one per-adjudicator
  ballot as a consensus ballot, which carries no votes, so `num_adjs` is 0 for sole-adjudicator debates.

Rule differences worth deciding on:
- Round-1 byes go to the first teams in the list (CrabbyTab) or the last imported (Tabbycat); neither
  is random. CrabbyTab should break the tie with the draw's seeded RNG.
- ~~BP draw strength counts opponents' wins in CrabbyTab and opponents' points in Tabbycat~~ *Fixed in
  wave 4/5: `draw_strength` sums opponents' points, BP records no wins, and the BP preset ends with
  `draw_strength`; the harness's BP standings now agree 2496/2496.*
- Teams tied inside the break get consecutive seeds in standings (name) order in CrabbyTab; Tabbycat
  gives them equal break ranks.
- The DebateXML importer totals ballots with CrabbyTab's defaults (ghost speeches excluded) before the
  style's preset can apply; Tabbycat's importer applies the preset first.

Upstream Tabbycat behaviour seen (not CrabbyTab issues): its standard break rule marks teams tied for
the last place as reserves despite its code saying they all break (`breakqual/base.py`
`add_reserve_teams`); "max times per side" is only enforced by min-cost conflict avoidance, and
`graph.py` checks `t1_negs` twice instead of `t2_negs`; random-draw byes always go to the last teams
in database order.

**Wave 3 — P2/P3.** #11 staff invitations (*done: invite by email with single-use, expiring
links; accounts are created only through an invitation; see [staff-invitations.md](staff-invitations.md)*); #12 import preview, duplicate detection,
institution auto-create, conflicts CSV (*done, see data-import-export.md*); #13 speaker categories
as entities driving eligibility (*done, see standings-and-breaks.md*);
#14 self-registration (*done: public team/adjudicator form, institution representative links, quotas,
custom questions, review queue whose approvals write live; see [registration.md](registration.md)*); #15 draw-editor history / side-balance / pull-up flags, draw
details, keyboard placement; #16 manual-ballot sides, swing teams; #17 feedback number/checkbox
questions, configurable paths, base-score history (*done: see
[adjudicator-allocation.md](adjudicator-allocation.md#feedback-paths)*). *#15 and #16 done: see [draw-generation.md](draw-generation.md)
("Sides chosen on the ballot", "Swing teams", "Draw editor"). Tabbycat has no automatic swing
exclusion; CrabbyTab leaves swing teams out of standings and breaks itself.*

**Wave 4 — P3/P4 (not implemented yet; see the corrections in "B. Wave 4 corrections" below).** #18 AIDA 2019 break rule (WADL dropped: not in Tabbycat); #19 1000-team two-team allocation speed
(7–18 s/round) and sharding; #20 soft ranked venue constraints, per-round venue availability,
team-declared institution conflicts; #21 editable notification templates, motion/standings
release emails; #22 design rollout to every page, dark mode everywhere, keyboard drag-and-drop;
#23 admin-UI translations and more languages; #24 broader API (teams, results, standings);
#25 diversity statistics, public veto stats; #26 optional public (non-private-URL) ballot and
feedback forms.

## Source-level audit against Tabbycat v2.12.1 (2026-10-20, `beta` 4c5a70c)

Tabbycat's feature set was extracted mechanically from its **source** (v2.12.1): 170 tournament
preferences, 315 URL routes (66 REST endpoints), 76 models, every standings metric, break rule,
allocator, draw generator and notification event, 34 management commands and 29 locales. Each
item was checked against CrabbyTab's code; "missing" required search evidence. Coverage:
tab-room preferences 45 HAVE / 17 PARTIAL / 16 MISSING / 3 different-design (of 81);
operations/public preferences 17 / 21 / 38 / 11 (of 88); non-API routes ≈175 HAVE / ≈45 MISSING;
REST API 2 of 66; models 26 / 28 / 8 (of 62); draw generators 8/8; break rules 4/5; team metrics
13/18; speaker metrics 6/17; locales 2/28.

### A. Defects — fixed in the source-audit PR
- **Voting averages rounded to 0.01** (`src/lib/ballots/result.ts`): averaged speaker scores,
  margins and team totals are now exact (only float noise is stripped); team totals are the mean
  of the majority sheets' totals. The Tabbycat harness now matches the voting fixture's standings
  2800/2800 (was 2602/2800); the 224/3 speaker tie is shared as in Tabbycat.
- **DebateXML: sole-adjudicator ballots in voting stages carried no votes**: the importer now
  decides each stage's ballot mode from the archive (per-adjudicator sheets → voting; a
  panel-signed ballot → consensus; no evidence → Tabbycat's default, voting) and imports a sole
  adjudicator's sheet as a one-sheet voting ballot. `twoteam-odd-ties` standings now 2644/2644.
- **`preliminaryPanelsPerScheduleSlot` did nothing** but its help text claimed behaviour: removed
  from the config UI; the stored field is kept (deprecated) so saved settings load. The real
  feature is wave 5 "concurrent rounds and schedule".
- **Verified NOT a defect: public toggles default on.** `publicDraw/Results/Standings/Motions`
  default to on (Tabbycat: off), but every public item is double-gated by an explicit per-round or
  per-item release (draw release, `resultsReleased`, team-speaks release, per-motion release), so
  nothing is public until the tab room releases it. Left as a deliberate default.

### B. Wave 4 corrections (wave 4 is not implemented yet)
- **#18**: drop WADL — it is not in Tabbycat v2.12.1 (only in historical migrations). Keep
  `aida-2019-australs-open` (cap 3, +1 per 8 teams beyond a 16-team break; `breakqual/aida.py`).
  *Done: `aida_2019_australs_open` (standings-and-breaks.md).*
- **#20**: include venue-constraint priorities (soft, ranked) and venue check-in expiry.
- **#21**: include Reply-To, the "ballot confirmed" event (CrabbyTab only notifies on submission),
  and per-tournament saved templates for the 8 automatic emails.
- **#24 is underscoped**: Tabbycat's API is full read/write (66 endpoints: tournaments, rounds,
  motions, pairings + generate-draw, ballots, availabilities, check-ins, break eligibility +
  generate-break, speaker categories, teams/adjudicators/speakers/venues CRUD and standings,
  preformed panels, feedback, `/me`). Plan read **and** write endpoints with scoped tokens.
- **#25**: diversity statistics for both admin and public views.

### C. Wave 5 — gaps on no earlier roadmap (implement after wave 4)
**High (results or whole formats):**
1. Round weights (points multiplied per round; Tabbycat `Round.weight`, `standings/teams.py:76`).
2. Median score aggregation across adjudicators (`score_aggregation_function`).
3. Ballots without speaker scores — prelim-only / never (`speakers_in_ballots`).
4. Speaker ranks on ballots and the `srank` metric (APDA; `speaker_ranks`).
5. Declared-winner modes incl. `tied-points`, and declaring a winner on voting sheets (`winners_in_ballots`).
6. Speaker-tab metrics: team points, team wins, 1sts/2nds/3rds, num_adjs, srank, replies count/stddev.
   *Done except `srank` (ranked ballots).*
7. Odd-bracket methods `pullup_lowest_ds_rank(_npulls)`; `graph_one` conflict avoidance; two-team pull-up penalty.
   *Done: `min_cost_with_pullups` (draw-generation.md).*
8. Score criteria (weighted per-criterion speaker scores).
9. BP draw strength by opponents' points (`draw_strength`; CrabbyTab uses opponents' wins). *Done.*
10. Per-adjudicator ballots via private URLs merged into voting ballots; assistants confirming others' entries.

**Medium (workflow):** maximum margin; independent reply-score step; ~~BP position cost `simple`;
deterministic (unshuffled) Hungarian; `pullup_debates` and `draw_strength_rank` metrics~~ (done); assistant
access levels and permission groups; concurrent current rounds, round start times, preparation
time, public schedule + iCal; three-state motion release (info slides first); public draw "current
round only"; public team/adjudicator record pages; public adjudicator tab; public and private
scoresheets; public tab top-N limits; noindex control; public elimination bracket; anonymity
(anonymous speakers, hidden institutions, code names shown/generated); email delivery webhooks;
CSV exports (participants, availability, break eligibility, conflicts); simulated results /
demo tournament for rehearsals; registration breadth (institution/coach self-registration,
auto-accept, over-allocation, slot transfers, name/code-name generators, region/phone/gender
fields); feedback score step, full team-feedback modes, intro text, unexpected and "important"
feedback views; venue room URL and category descriptions.

**Low (polish):** custom side names (Gov/Opp…); toggles for the reply-speaker rule and for
motions altogether; reverse public motion order; copy motions between rounds; cross-tournament
motion statistics; team emoji and speakers in the draw; team references and institution prefixes;
check-in event history; bulk check-in from the previous round; printed-ballot options; SMS and
web push.

### D. Not gaps (different design or not applicable)
Feedback paths as boolean flags (more flexible; only "panellists on each other but not trainees"
is inexpressible); per-round result releases instead of a global switch; barcodes from entity ids;
one role-gated route tree instead of admin/assistant/public trees; per-round side pre-allocation;
no public forms addressed by numeric ids (private URL + passcode is deliberate); Django plumbing,
cache commands and legacy ballot views; SendGrid-specific configuration.

## Where CrabbyTab stands

**Architecture.** Next.js 15 + React 19, client-side compute. Working copy lives in IndexedDB
per tournament (see `storage-and-scale.md`). For cloud tournaments on administrator devices,
ballots, debates, teams and adjudicators sync live through Firestore listeners and per-record
writes (`live-collaboration.md`); every other collection is still a manually-triggered
upload/download mirror (`AUTOMATIC_CLOUD_WRITES = false`).
Private URLs, assistants and public pages go through server routes (firebase-admin). Beta began a
clean `features/tournament/{application,infrastructure}` split; `TournamentContext` is down to ~1.9k lines.

**Solid already:** setup wizard, CSV imports, two-team power pairing (slide/fold/adjacent, pullup
methods, one-up-one-down), side balancing, round robin, Hungarian adjudicator + venue allocation,
drag-drop draw & allocation editors, configurable standings precedence, AIDA 1996/2016 break rules +
institution caps, private URLs with passcodes, staff roles (admin / data entry), print ballots &
feedback, barcode check-ins, custom feedback questions, motion balance χ², audit hash-chain, API
tokens + v1 draws, DebateXML export, JSON backup, CI.

## Phase 0 — Data-loss & security hotfixes (do first, small PRs)

| # | Problem | Where |
|---|---|---|
| 0.1 | Private sync 503s for everyone once any debate is soft-deleted (`allDebates.get(id)!` → undefined) | `api/private/sync/route.ts:145-152` |
| 0.2 | Non-global-admin uploads likely fail: `tournamentSlugs/{slug}` has no rule (only global-admin catch-all) | `tournamentRepository.ts:101-157`, `firestore.rules:97` |
| 0.3 | Server writes (private sync discard, data-entry-sync merge) don't bump `syncVersion` → admin's stale upload silently overwrites judge/assistant ballots | `sync/route.ts:353`, `data-entry-sync/route.ts:185,220` |
| 0.4 | Download keeps local over cloud for same id → devices never converge | `cloudSync.ts:140-167` |
| 0.5 | Chair's private ballot discards tab-confirmed ballots | `sync/route.ts:344-358` |
| 0.6 | Unrevealed panels / unreleased draws leak to teams | `privatePortalBallots.ts:3-29`, `api/private/team/route.ts:80-101` |
| 0.7 | Data-entry assistants can write confirmed ballots, debate results, break status, base scores; `assistant-data` over-shares (feedback, scores, emails) | `data-entry-sync/route.ts`, `assistant-data/route.ts:81-108` |
| 0.8 | Any admin/staff-admin can rewrite `ownerId`; any signed-in user can create tournaments; slug squatting breaks public/v1/checkins | `firestore.rules:37-44` |
| 0.9 | Passcode `===` compares; key enumeration not rate-limited (403 before limiter) | `sync/route.ts:83-110`, `private/team/route.ts:70` |
| 0.10 | Signed-out viewer of a `local` tournament is admin (display page leaks unreleased data) | `TournamentContext.tsx:841-845` |
| 0.11 | v1 `read:public` returns `confirmed` (unreleased) draws | `v1/.../draws/route.ts:90-94` |
| 0.12 | Fix 33 test-file TS errors; add `tsc --noEmit` to CI | `.github/workflows/ci.yml` |
| 0.13 | Add CSP / security headers | `next.config.mjs` |

## Decisions

- **2026-10-18 — Sync model B adopted.** Firestore is the source of truth for cloud tournaments,
  with the SDK's persistent local cache (IndexedDB, offline-capable), `onSnapshot` listeners scoped
  to the current round, per-record writes, and transactional server routes for ballots and
  confirmations. All draw/allocation/standings compute stays client-side. Local-only tournaments
  move from `localStorage` to IndexedDB. Manual upload/download, tombstones, record-level
  `syncVersion` and `syncConflicts` are retired once migration lands (Phase 4.1). Phase 0 items
  0.2–0.4 only get stop-gap fixes if push/pull stays in use until then.
- **2026-10-18 — Deployment target is Vercel**; Firestore stays on the Spark tier, so every hot read
  path must be cached (Phase 0.5).

## Phase 0.5 — Public read path & caching (Vercel)

**Status (branch `claude/public-read-cache`, off `origin/beta`):** items 1–5 implemented —
`src/lib/publicView/{projection,snapshot,hash,store}.ts`, `POST /api/tournaments/[id]/public-view`,
cached `GET /api/public/tournaments/[slug]` (+ `/version`, `/checkins`), publish-after-upload and a
"Republish Public Pages" menu action, 45 s version polling on `/public` and `/display`.
Behaviour notes: publish is skipped when the client's public fingerprint is unchanged (≈3 reads)
*(superseded: the skip now also requires an unchanged cloud source token, about one aggregation read
per source collection, so other devices' writes are published; see the status table)*;
data-entry-sync does not publish (assistant check-ins appear after the next admin upload); the
existing rule that `confirmed` (not only `released`) draws are public is preserved and tracked as
0.11. Remaining: items 6–8 (private-URL query narrowing, v1 draws from snapshot, `preferredRegion`).

**Problem.** Firestore Spark allows 50k reads/day. Today every public hit full-scans 9 collections
(`api/public/tournaments/[slug]/route.ts:37-84`, ~300–400 reads for a 100-team BP after R1, no
cache headers); public check-ins poll every 30 s with full scans + `no-store` (~21k reads per open
screen per hour); `/api/v1/.../draws` and private-URL routes also scan whole collections.

**Design (deployment target: Vercel, Next 15.2 — use `unstable_cache` + `revalidateTag`;
avoid `"use cache"`, which needs experimental `dynamicIO`).**

1. **Publish-time snapshots.** Release actions (draw, motions, results, team speaks, standings,
   break, participants) call an admin-authenticated route that rebuilds *only the changed section*
   server-side from Firestore with the existing allowlist sanitizer and the pure
   standings/break libs, and writes `publicViews/{slug}/sections/{section}` plus
   `publicViews/{slug}` = `{ tournamentId, versions: { draw: n, … } }`. ~400 reads per publish,
   independent of audience. Slug-keyed docs remove the `where("slug")` lookup and double as the
   slug-uniqueness registry (Phase 0.8).
2. **Vercel Data Cache.** Public routes read those docs through
   `unstable_cache(fn, [slug, section], { tags: [`public:${slug}`, `public:${slug}:${section}`], revalidate: 3600 })`.
   The Data Cache is shared across regions/instances, so Firestore sees ~1 read per section per
   publish (plus hourly safety refresh). The publish route calls `revalidateTag` → visible instantly.
3. **CDN layer.** Responses send `Cache-Control: public, s-maxage=15, stale-while-revalidate=60`
   to absorb refresh storms at the edge (function invocations stay low). Worst-case staleness
   after a release ≈ 15 s.
4. **Version polling.** Public page, `/display` and public check-ins poll a tiny cached
   `/api/public/tournaments/[slug]/version` every 30–60 s and refetch a section only when its
   version changes. No anonymous `onSnapshot` listeners.
5. **Check-in counts** become a per-round aggregate doc updated in the same write as each
   check-in; served through the same cache.
6. **Private URLs** (not shareable-cacheable): denormalize `participantIds` on debates and query
   `array-contains` scoped to the current round instead of loading all teams/debates/ballots
   (`api/private/sync/route.ts:119-123`). ~1–3 reads per load.
7. `/api/v1` draws: serve from the same released-draw snapshot for `read:public`; only
   `read:draws` (admin scope) touches live collections.
8. Set function `preferredRegion` to match the Firestore region.

**Estimated budget, 100 teams / 9 rounds / ~300 participants:** public ≈ hundreds of reads
regardless of audience; private ≈ 9k; admin listeners (sync model B, current-round scoped,
persistent cache) ≈ 15–25k → comfortably under 50k. Admin devices become the dominant cost, so
listener scoping is part of the sync-model work.

## Phase 1 — Tab-engine correctness (results people will dispute)

1. **Elimination debates counted in standings/break** — `calculateStandings` ignores `rounds`; filter to preliminary, non-cancelled (`standings/calculator.ts:36`).
2. **Real margins** — computed from speaker totals, not hardcoded ±2 (`privateBallot.ts:165`, results page).
3. **Reply scores keyed `reply-AFF/NEG`** merge every team's replies — store real speaker ids (`privateBallot.ts:124,132`).
4. **Ghost/iron-person**: honour `teamScoreIncludesGhosts`; exclude duplicate speeches from speaker tab; let ballot entry pick who spoke in each position.
5. **Pullups**: persist `slot.pulledUp` in generator; flip `pullups` metric direction (`metrics.ts:49`); BP "pullup" is actually a pull-down — fix with Phase 2 BP rewrite.
6. **Bye "win"** must not fabricate speaker scores.
7. **Rank-vs-score validation** (no low-point wins unless enabled).
8. **Round completion for prelims** — nothing sets `completed`, so break-liveness is constant 0.5 and "rounds completed" is wrong.
9. **Availability mismatch** — draw/allocation editors filter global `checkedIn`, generator uses per-round availability.
10. **Breaks**: AIDA 2016 drops reserves (`breakqual/calculator.ts:96-97`); `generateBreak(cat)` overwrites all categories (`application/breaks.ts:161`); cutoff ties split arbitrarily; non-power-of-two field returns empty draw silently.
11. Venue re-allocation not persisted (`application/allocation.ts:141` saves the wrong array).
12. Remove dead/no-op prefs or wire them: `min_cost`, `pairingDeviationPenalty`, `pullupPenalty`, `previouslySawPullupPenalty`, `sideBalancePenalty`, `preliminaryPanelsPerScheduleSlot`, `marginIncludesDissenters`, `*StandingsExtra`, `drawRule:"bracket"`, `usePreformedPanels`.

## Phase 2 — Algorithm parity with Tabbycat

**BP draw** — replace shuffle-30 + per-room permutations with Tabbycat's model: one Hungarian
assignment of teams → (room, position) with cost = position-history cost (Rényi/SSD with exponent)
+ pullup cost, brackets by points, pullups from below distributed per `bpPullupDistribution`.
`hungarian.ts` already exists. Golden tests against Tabbycat outputs.
*Done in step 5 (see `docs/draw-generation.md`); tests are golden cases derived from
Tabbycat's algorithms and brute-force optimality checks, not recorded Tabbycat outputs.*

**Two-team draw** — true `intermediate`, `intermediate1/2`, `intermediate_bubble` (bubble-up/down
swaps), real `min_cost` conflict avoidance (graph matching over clashes + history), seeded random
(`Team.seed`), preallocated sides, history-aware random rounds, option for non-random R1.
*Done in step 5, together with Phase 1 items 5 and 6 and the draw preferences in item 12
(`min_cost`, `pairingDeviationPenalty`, `pullupPenalty`, `previouslySawPullupPenalty`,
`sideBalancePenalty` are wired; `drawRule: "bracket"` is a legacy value treated as random).*

**Adjudicator allocation** — Tabbycat-style cost: per-debate importance-weighted score mismatch +
soft history penalty + hard conflicts (institution, team, **adj↔adj**), respect user weights (drop
`prioritizeClashAvoidance` floor), trainees conflict-checked, panel size by importance/odd-panel
rule, feedback weight from `Round.feedbackWeight` (score = base·(1−w) + feedback·w, scaled), test
score used, **preformed panels** (create in a prior step, allocate as units), iteration cap + run
in a **Web Worker**.

**Elimination** — partial eliminations (pre-bracket / byes for non-power-of-two breaks), bracket
position preserved across rounds, BP elim sides by seed, manual break overrides & remarks
(ineligible/withdrawn/different break), adjudicator break.

**Standings** — who-beat-whom, ballots/votes carried, num iron-person speeches, speaker
min-speeches eligibility, reply stddev/count, team points as a speaker metric.

## Phase 3 — Workflow & UI parity

**Ballots**
- **Voting ballots**: one ballot per adjudicator in panels, majority aggregation, dissent tracking (`marginIncludesDissenters`), consensus option per round.
- **Blind double entry** with version history, discard/confirm UI, "entered by / checked by".
- Motion **vetoes** per ballot (and veto stats); motions filtered by round; forfeits.

**Feedback & adjudicators**
- Feedback progress (who owes feedback), per-source weighting, ignore/confirm toggles, per-adjudicator detail page with score history, feedback linked to debates (not `"direct-feedback"`), base/test score management.
- UI for adj↔team and adj↔adj conflicts; stop wiping conflicts when institution changes.
- Diversity: gender/region on people; allocation editor diversity colouring; diversity stats page.

**Round lifecycle & release** — explicit draft → confirmed → released → completed flow; per-item
release toggles (team tab, speaker tab, reply tab, motions tab, break, adj core) instead of "shown
when generated"; guarded format change after draws exist.

**Public site** — speaker & reply tabs, participants, institutions, adjudicator core, break per
category, public feedback & ballot submission (Tabbycat's non-private mode), drop the "Admin Tab
Room" link, projector draw display with motion reveal / info slide, alphabetical-by-team draw.

**Draw editor** — history/side-balance/repeat flags, adj search, touch/keyboard (click-to-place).

**Data** — done in step 6: DebateXML import into a new tournament (round-trips with the export),
CSV exports (speaker/reply standings, draw, admin-only feedback and adjudicator scores), validated
JSON backup restore with diff preview and replace. See `docs/data-import-export.md`.

**Notifications** — automatic emails (draw released, ballot receipt, team points, private URLs to
teams), QR codes on private-URL slips, self check-in via private URL.

**Team break eligibility & speaker categories** editable in UI (currently hardcoded `[]`).

## Phase 4 — Architecture (enables everything above to scale)

1. **Sync model (biggest decision).** Manual upload/download with last-writer reconciliation is the
   root of most Phase 0 bugs and can't support a multi-operator tab room. Recommend: Firestore as
   source of truth with `persistentLocalCache` (IndexedDB, offline-capable, no 5 MB limit) +
   `onSnapshot` live updates + per-record writes with `syncVersion`/transactions; keep all compute
   client-side. Keep JSON export/backup for fully offline events.
2. Split `TournamentContext` into per-domain stores/selectors; memoize provider value.
3. Bound `auditEvents` locally (page from Firestore).
4. Heavy compute (allocation, BP draw) in Web Workers.
5. Tests: Firestore rules tests in emulator, API route tests, Playwright e2e of a full 5-round
   tournament (BP + WSDC), golden-file comparison against Tabbycat for draws/standings.
6. Clean up: `metadata.json` (Gemini leftover), single lockfile policy, README sync semantics.

## Phase 5 — Polish

i18n (Tabbycat ships ~15 languages), accessibility (dialog roles, focus traps,
labelled controls, keyboard DnD), mobile (round creation hidden below `md`), configurable analytics ranges.

## Suggested order

Phase 0 → Phase 1 → Phase 4.1 sync model → Phase 2 (BP draw, allocator) ‖ Phase 3 ballots/release
→ rest of Phase 3 → Phase 5. Each numbered item is roughly one PR with tests.

## i18n approach (for later)

Not started, deliberately: translating touches every page. When it is picked up:

- Use `next-intl` with the App Router, messages in `messages/<locale>.json`, and the locale kept in a
  cookie rather than the URL so tournament slugs and existing links do not change.
- Extract strings one feature area per PR, starting with public pages (participants see them most).
- Keep tournament data (team names, motions, feedback answers) untranslated, and keep CSV headers
  and DebateXML in English so exports stay stable for other tools.
- Format numbers and dates with `Intl` through the library's formatters, never by hand.
