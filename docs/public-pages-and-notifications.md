# Public pages, projector, notifications and self check-in

Step 4 of [the parity plan](tabbycat-parity-plan.md) ("Public site" and "Notifications" in Phase 3).

## Public pages (`/[slug]/public`)

Everything the public page shows comes from the public projection
(`src/lib/publicView/projection.ts`), published at upload time and served from the Vercel Data Cache
through `/api/public/tournaments/[slug]`. No public page reads Firestore collections directly.

The projection is paged by round so that neither a cache entry nor a response grows with the
tournament (see [storage and scale](storage-and-scale.md#public-projection-paged-by-round)):
`/api/public/tournaments/[slug]` returns everything except debates and ballots, plus the latest
round's debates and ballots and a content hash per public round; `?round={id}&h={hash}` returns one
round. Public pages show the latest round immediately and load the other rounds after it (standings
and results update as they arrive); the projector loads a round when it is shown; private portals
load every round before showing their own data. Pages still poll the tiny `/version` marker and
reload only rounds whose hash changed.

| Tab | Shown when | Data |
| --- | --- | --- |
| Draw, Results, Standings | existing per-round releases | unchanged |
| Team / Speaker / Replies tab | `releaseTeamTab` / `releaseSpeakerTab` / `releaseRepliesTab` | completed preliminary rounds' confirmed ballots |
| Motions | `publicMotions` and the motion is released | text, info slide; per-motion side results from released ballots only |
| Break | the category is in `releasedBreakCategoryIds` | the generated break |
| Participants | `publicParticipants` | every team with speaker names, every adjudicator with institution |
| Institutions | `publicInstitutionsList` | name, code, region; team/adjudicator counts only if participants are public too. The projection publishes no institution list at all until this is released (before, every institution's name, code and region was always in the published view). |
| Adjudication core / Breaking adjudicators | `publicAdjudicatorCore` / `publicBreakingAdjudicators` | adjudicators flagged `adjCore` / `breaking` |

Below the welcome message the public page links the public pages outside its tabs, each only while
it is switched on (`publicSiteLinks` in `src/lib/publicView/siteLinks.ts`): the schedule and its
calendar feed (`publicSchedule`), the check-in status (`publicCheckInStatus`), the audit log (once
released; asked from `/api/public/tournaments/[slug]/audit?status=public`, edge-cached) and the
registration form (while it is open or opens later; asked from the edge-cached registration route).

### Public-site settings (waves 4–5, Tabbycat `public_features` / `tab_release` / `ui_options`)

Every setting below is enforced by the projection when the view is published, so a hidden value
never reaches the public, a cache or a local copy. Defaults follow Tabbycat except where noted.
Per-item switches are on the **Public release** panel; modes, limits and text are under
**Settings → Public Visibility**. `getPublicSiteSettings` (`src/lib/publicFeatures.ts`) resolves
them with their defaults.

| Setting (Tabbycat) | Preference | Effect |
| --- | --- | --- |
| Public draw (`public_draw`) | `publicDrawMode`: off / current / all (absent: all, or off if the legacy `publicDraw` is false) | "Current round only" publishes the current round's draw: the explicit current round set on the Draw page (Tabbycat "set current round", `preferences.currentRoundId`) together with the other released rounds of its schedule slot, else the latest released draw. Setting a current round never publishes a draw that is not released, and its id is only published when that round is public. Earlier rounds stay public only through released results. Each projected round carries `drawPublic`. The projector and the v1 draws API (without the draws scope) follow it. |
| Record pages (`public_record`, default on) | `publicRecordPages` | `/[slug]/public/team/[id]` and `/adjudicator/[id]`: a participant's public debates and results, built from the projection only. Anonymous adjudicators have no record page. |
| Adjudicator tab (`adjudicators_tab_released`, `adjudicators_tab_shows`) | `releaseAdjudicatorTab`, `adjudicatorTabShows`: test / final / all | Base score, feedback-blended score (weight of the latest published round), or both plus per-round feedback averages. Computed at publish time; feedback content is never published. |
| Scoresheets (`ballots_released`) | `releaseBallots` | Each adjudicator's sheet, for rounds whose speaker scores **and** panels are public. Sheets are copied generically: known fields plus any numeric / side-valued field (criteria, ranks, declared winner); free text never passes. |
| Private scoresheets (`private_ballots_released`) | `releasePrivateBallots` | A team's private URL shows its own debates' full scoresheets once the round's results are released (even before team speaks); sheets need the panel to be public. |
| Tab limits (`team/speaker/replies_tab_limit`) | `teamTabLimit`, `speakerTabLimit`, `repliesTabLimit` (0 = all) | Tabs are computed at publish time (`tabs` section). With a limit, rounds visible only through a released tab (e.g. silent rounds) publish no individual results, so ranks below the cutoff cannot be rebuilt. Ties at the cutoff are kept. |
| Speaker category tabs (`speaker_category_tabs_released`) | `releaseSpeakerCategoryTabs` (absent = follows `releaseSpeakerTab`, the behaviour before this setting) | A speaker tab per public speaker category, on the Speaker tab's category chips. Released alone (speaker tab hidden) it shows only the category tabs; like the break category tabs it publishes no per-round results. |
| All round results (`all_results_released`) | `releaseAllResults` (default off; Public release panel) | Results of every completed round become public, including silent and elimination rounds (released silent rounds are published as not silent). Speaker scores of rounds whose team speaks were never released follow only with a released speaker tab without a top-N limit (Tabbycat's team record rule). Rounds not marked completed stay private. Intended for after the tournament. |
| Break category team tabs (`break_category_tabs_released`) | `releaseBreakCategoryTabs` | A team tab per break category: the category's teams (every team not marked ineligible for a general category) ranked within it, who-beat-whom re-evaluated, cut at the category's public tab limit (see [standings-and-breaks.md](standings-and-breaks.md#public-tab-limit-per-category)). |
| Break page metrics (`public_break_metrics_to_show`) | `publicBreakMetrics` (-1 all, 0 none, n) | The first n team precedence metrics of each breaking team. |
| Break categories on participants (`public_break_categories`) | `publicBreakCategories` | Team break eligibility is published only with this (or with category tabs). Before wave 4 eligibility was always published. |
| Pre-allocated sides (`public_side_allocations`) | `publicSideAllocations` | "Sides" tab: each team's pre-allocated side per preliminary round. |
| Elimination bracket | `publicBracket` | Built from public elimination draws and results; BP teams advance with 2+ points. |
| Diversity (`public_diversity`) | `publicDiversity` | Gender / region / category counts of speakers and adjudicators, chair / panellist / trainee allocations by gender, average speaker score by gender (public speaker scores only), average feedback received and given by gender. Counts and averages only. |
| Veto statistics | `publicVetoStatistics` (needs `enableMotionVetoes`) | Vetoes per motion and side, from ballots of rounds with public results. |
| Feedback progress (`feedback_progress`) | `publicFeedbackProgress` | Per public team / adjudicator, feedback owed and submitted in rounds whose panels are public. With `showUnexpectedFeedback` (Tabbycat `show_unexpected_feedback`, default on) each row also counts submissions no feedback path expected (`unexpected`, shown as "+N?"); off, they are left out. |
| Motion statistics (`motion_tab_released`) | `motionTabReleased` (absent = follows `publicMotions`, the behaviour before this setting) | Win / selection statistics per released motion. Released on its own (motions page off) it shows a "Motion statistics" tab with the motions and their statistics but no info slides or presentation mode. Without it (and without motions in results) the projection drops `motionId` / `motionText` from debates and ballots, so which debate had which motion is not public. |
| Motions in results (`show_motions_in_results`) | `showMotionsInResults` (default off) | A "Motion" column on public results and team / adjudicator record pages: the confirmed ballot's motion, else the debate's, else the round's only released motion. Only released motions; a debate's motion is published with the round's public results. Released motions are published for this even when the motions page is off. |
| Institutions (`show_team_institutions`, `show_adjudicator_institutions`) | `showTeamInstitutions`, `showAdjudicatorInstitutions` | When off, institution ids and names are removed from teams, adjudicators and tabs. |
| Unaccredited adjudicators (`show_unaccredited`) | `showUnaccredited` (default off) | An "Always trainee" column on the public participants list and adjudicator tab (and a marker on the core / breaking lists). The projection publishes `trainee: true` only with this setting. |
| Team code names (`team_code_names`) | `teamCodeNames`: off / all-tooltips / admin-tooltips-code / admin-tooltips-real / everywhere | Every mode except off and all-tooltips publishes **only** the code name (teams without one have an empty name and show "(no public name)"). all-tooltips publishes the real name and the code name as a tooltip. A code name equal to the team name (what older versions stored) counts as none. Tab-room draw, allocation, results and standings pages follow Tabbycat's admin modes: all-tooltips and admin-tooltips-code show the real name with the code name in a tooltip; admin-tooltips-real shows the code name with the real name in a tooltip (standings search matches both). Under "everywhere" the tab room shows only the code name, as Tabbycat does for admins. Private-URL portals are participant pages (Tabbycat `use_team_code_names(admin=False)`): under every mode except off and all-tooltips, other teams appear under their code names there too (a team's own portal keeps its own real name). |
| Participant code names (`participant_code_names`) | `participantCodeNames`: off / everywhere | Speakers and adjudicators are published under `codeName`. On private-URL portals other adjudicators appear under their code names, and on team portals other teams' speakers do too; adjudicator portals keep real speaker names, which ballot entry needs. |
| Anonymous people (`Person.anonymous`) | `Speaker.anonymous`, `Adjudicator.anonymous` (participant directory) | Name published as empty with `anonymous: true`; pages show "Redacted". In tab rows an anonymous speaker also loses their team and gets an opaque id. |
| Emoji / speakers in draw / splitting adjudicators | `showEmoji`, `showSpeakersInDraw` (default on), `showSplittingAdjudicators` | Emoji are removed when off; splits are published as `splitAdjudicatorIds` on ballots whose panel is public. |
| Search engines (`search_engine_indexing`) | `searchEngineIndexing`: all / homepage-only / none | `noindex, nofollow` metadata on public pages (the public tab is the homepage), from the cached projection, including the public schedule (`/[slug]/schedule/public`). The cross-tournament motion statistics (`/tournaments/motions/public`) are `noindex` whenever any tournament pooled there has indexing other than "all". |
| Welcome message, staff (`welcome_message`, `tournament_staff`) | `welcomeMessage`, `tournamentStaff` | Plain text (no HTML), at most 5000 characters, at the top of the public tab. |
| Motions order (`public_motions_order`) | `publicMotionsOrder`: forward / reverse | By the motions' earliest round; CrabbyTab's default stays forward (Tabbycat: reverse). |

**Code-name and emoji generators.** Settings → Public Visibility can fill in missing team emoji and
code names (emoji names or speakers' last names, Tabbycat's `code_name_generator`); existing values
are never overwritten (`src/lib/codeNames.ts`, seeded random source).

**Publish cost.** The projection reads the feedback collection only when the adjudicator tab (final
or all), diversity or feedback progress is on (`needsPublicFeedback`); otherwise a publish reads the
same collections as before. The new `tabs` and `derived` base sections are cached like the others;
views published before them read as having none until the next publish (view format 3).

### When public pages change

Public pages show the last **published** cloud copy, never an organiser device's local state.

- **Releases publish in one step.** Releasing or unreleasing a draw, round results, team speaks, a
  motion, a tab, a break or a participant list saves the change, uploads this device's pending
  changes and publishes public pages (`ReleaseActionDialog`, `planReleaseSync`). The dialog says how
  many other changes go with it, stays open while it works, and if the upload or publish fails it
  says the change is saved on this device but **not public yet**. A release is refused while offline
  or while records are known to conflict with the cloud (resolve them first). Without cloud sync on
  the device (Firebase not configured, or not signed in as an administrator) the change is saved on
  this device only, and the dialog says so. We chose this over "refuse while anything is pending"
  because organisers release under time pressure; refusing would force a separate upload anyway,
  and the one-step flow still discloses what else is uploaded.
- **Upload publishes only a consistent cloud copy.** If any record conflicted with a newer cloud
  version (archived for recovery) or the upload stopped part-way, public pages are not updated. The
  top bar shows *N upload conflicts* or *Upload incomplete* with the recovery path (Download and
  compare, resolve, upload again; or upload again to finish). Republish is refused in that state.
- **Republish public pages** publishes the cloud copy as it is; when this device has changes that
  are not uploaded it asks first (*Upload and publish*, or *Publish cloud copy anyway*).
- **Unchanged publishes are skipped only when nothing changed anywhere.** The server skips the
  rebuild when the publishing device's fingerprint *and* a cloud source token both match the last
  publish. The token hashes the tournament document (minus `updatedAt`) and, per source collection,
  Firestore aggregation results (document count and the sum of `syncVersion`; for ballots also the
  sum of `version`), about one read per collection. So uploads by other devices, assistant syncs,
  check-ins and private-URL ballots are published by the next upload or republish. Limitation: a
  write that changes a record without adding a document or increasing `syncVersion` (or a ballot's
  `version`) is not detected; every current write path does one of those. Bump
  `PUBLIC_VIEW_FORMAT` (`src/lib/publicView/snapshot.ts`) when the projection's output changes.
- **Sync status.** The top bar shows how many changes on this device are not uploaded (from the
  synced baseline; `computePendingChanges`), with a per-collection breakdown, and the browser asks
  before leaving the page while there are such changes or a cloud operation is running. Records
  synced before baselines existed count as changed until the next download.

All list releases default to hidden and are switched in the **Public release** panel on the standings
page. Adjudicators are flagged as core or breaking in the participant directory's edit dialog.

Projection rules added in this step:

- Teams outside the draw and released breaks are only included when the participants list is
  released. Break redaction (`redactUnreleasedBreak`) still applies to every team.
- Adjudicators are included when they sit on a revealed panel or appear on a released list. The
  `adjCore` / `breaking` flags are only sent when their own list is released, so an unreleased
  breaking-adjudicator decision cannot be read from the JSON.
- Public ballots now carry `forfeitSide`, so motion statistics can exclude forfeits.
- Never exposed: emails, private URL keys, passcodes, conflicts, base/test scores, feedback.

Motion statistics count one confirmed ballot per debate, skip forfeits, and use the ballot's motion
(falling back to the debate's). BP counts first places and average points per position; two-team
formats count wins per side. The χ² balance test is the existing `analyzeMotionBalance`.

## Public forms (Tabbycat `participant_ballots` / `participant_feedback` = "public")

Besides private URLs, participants can enter ballots and feedback from public pages, picking
themselves from a list, as in Tabbycat's public modes. Settings (Staff page, **Public forms** card):

| Setting | Preference | Behaviour |
| --- | --- | --- |
| Public ballot form | `publicBallotForm` | `/[slug]/public/ballots` lists the voting adjudicators (chairs and panellists; trainees cannot submit) of the current round and lets each enter their ballot. |
| Public feedback form | `publicFeedbackForm` | `/[slug]/public/feedback` lists every team and adjudicator; each picks themselves, then one of the people they may rate. Needs feedback switched on (`feedbackEnabled`). |
| Require the tournament password | `publicFormsUsePassword` | Every submission must carry the tournament password (`public_use_password` / `public_password`). |

All absent = off, so existing tournaments are unchanged. The public tab shows links to the forms
while they are on.

Like every tournament setting, the switches are saved on this device; public pages and private URLs
read the published cloud copy. After a save, the **Public forms**, **Staff access and private-URL
ballots** (Staff page) and tournament settings cards show "Saved on this device only" with an **Upload
and publish** button, which runs the same upload-and-publish step as a release
(`PublishSettingsNotice`, `planReleaseSync`). It is not shown on devices without cloud sync.

- **Password.** Set on the same card and saved at once through
  `PUT /api/tournaments/{id}/public-forms` (administrators only). Only a salted scrypt hash is kept,
  in `tournaments/{id}/serverOnly/publicForms`, which `firestore.rules` deny to every client; it is
  never in the preferences, the public snapshot or any response. While the password is required
  but none is set, the forms refuse every submission. Wrong passwords are counted per network and
  tournament (30 per hour, then HTTP 429).
- **Which round.** Ballots are taken for the current round only: the tab room's explicit current
  round, else the newest round whose draw is released (the full release; a teams-only release is
  not enough). As in Tabbycat, the form refuses while the round's motions are unreleased (when the
  round has motions), when the adjudicator has no debate or more than one debate in the round, and
  when the debate has no chair. The ballot form shows the tournament's ballot introduction
  (`ballotIntroExplanation`) and, when the round has several motions, asks which was debated (and
  each team's veto, with vetoes on), as on private URLs. Feedback can be given for any debate of a round whose draw is
  released, on the targets the feedback paths allow (teams see the panel only once adjudicators
  are revealed), exactly as on private URLs.
- **Submission.** Pages call `POST /api/public/tournaments/{slug}/forms` (`action: "load" |
  "submit"`, `kind: "ballot" | "feedback"`), a firebase-admin route like the private-URL sync
  route. It checks that the form is on, the password, and rate limits (240 requests per hour per
  network and tournament, 6000 per tournament), then validates with the same code as private URLs
  (`buildPrivateBallot`; the feedback checks in `src/lib/publicForms.ts` mirror the private sync
  route). The server sets the ballot id and submitter; the form cannot choose them.
- **Confirmation.** Anyone who can open the page can submit, so a public ballot is **always stored
  unconfirmed** and waits for the tab room, whatever `privateBallotConfirmation` says (Tabbycat's
  public ballots are unconfirmed too). In individual-ballot rounds it is stored as that
  adjudicator's own sheet and never merged automatically. Ballot receipts are emailed as for
  private URLs, which also tells an adjudicator when someone submitted in their name. Feedback is
  stored confirmed on submission, as in Tabbycat and on private URLs; the tab room can unconfirm or
  ignore it on the feedback page.
- **Pickers cost no reads.** The lists are built at publish time into the public snapshot
  (`derived.publicForms`) and served by `GET /api/public/tournaments/{slug}/forms` from the cached
  snapshot. A room is shown next to an adjudicator only once the round's panels are public. Names
  follow the public code-name settings; the stored records keep the real names.
- **Private URLs.** Tabbycat's three modes are exclusive (off / private URLs / public). Here the
  public forms are independent switches: private-URL ballots stay on unless switched off with
  `privateUrlBallots`, and private-URL feedback follows `feedbackEnabled`.

## Projector display (`/[slug]/display`)

When the shown round shares its schedule slot with other rounds of the same stage (concurrent
rounds), the projector shows every one of them, each under its own heading (Tabbycat
`draw-display-current-rounds-*`); **All current rounds** narrows it to the shown round alone.
Public viewers only see rounds whose draw is on the public draw page (a teams-only release never
is); staff projecting their own copy see every confirmed (locked or later) draw of the slot, never
a draft (`projectorRounds` in `src/lib/display.ts`).

Three views: **Draw by room** (responsive: one column on phones, two on tablets, four BP positions on
wide screens), **Draw by team** (alphabetical, with side, room and opponents) and **Motion reveal**.

The motion reveal shows a cover slide, then each motion's information slide (if any) followed by the
motion, in `seq` order. Keys: → / Space / Enter / Page Down advance, ← / Backspace / Page Up go back,
Home / End jump, Esc returns to the draw.

Public viewers only see released motions and released draws (the projection holds nothing else).
Signed-in administrators (role confirmed by `/api/tournaments/[id]/access`) project from their own
working copy on this device (IndexedDB): a confirmed draw before it is released, and unreleased
motions. Data-entry staff with `draw.display` / `motions.display` project from their assistant data
(`/api/tournaments/[id]/assistant-data`), which the server already limits to what those permissions
allow (see [staff access](staff-access.md#projector)). **Reload staff copy** fetches it again.

## Automatic notifications

Opt in per event on the email page:

| Preference | Sent to | When |
| --- | --- | --- |
| `notifyDrawReleased` | each team's speakers | the round's draw is confirmed or released (panels show "TBA" until revealed) |
| `notifyDrawReleased` | each allocated adjudicator | the draw is visible **and** panels are revealed |
| `notifyTeamPoints` | each team's speakers | results are released, the round is not silent and public results are on |
| `notifyBallotReceipt` | the submitting adjudicator; for results the tab room (or an assistant) enters, the debate's adjudicators | they submit a ballot from their private URL or the public form; the tab room confirms a result it entered (Tabbycat `enable_ballot_receipts`, which also emails tab-room confirmations). Not for BP elimination rounds. With `notifyBallotConfirmed` on, tab-room confirmations send that email instead. Turning receipts on (or a round with no log yet) starts after the round's existing confirmations |
| `notifyMotionsReleased` | speakers and (revealed) adjudicators in the round | the round's motions are released and its draw is visible |
| `notifyBallotConfirmed` | every adjudicator of the debate | the tab room confirms its result (running rounds only) |

Wording, Reply-To, registration emails, delivery status and SMS: see
[email-notifications.md](email-notifications.md).

How it works:

- The server reads the **cloud copy**, so a release is only emailed after it has been uploaded. Each
  cloud upload calls `/api/tournaments/[id]/notifications` (administrators only) until nothing is
  due; the email page also has **Send due notifications now**.
- Running team points use the standings calculator over released, non-silent preliminary rounds
  only. Teams without a confirmed result for the round get no email (missing is not zero).
  Elimination rounds are not covered by team-points emails.
- Each (event, round) has a document in `tournaments/{id}/notificationLog`. Recipients are sorted by
  address and sent in chunks of at most 100 (one chunk per request, to stay within the route's
  time limit); each chunk is claimed in a transaction before sending, so concurrent triggers do not
  double-send. Ballot receipts are claimed once per ballot id, so an offline resubmission does not
  repeat them.
- Switching an event on first marks rounds already released in the cloud copy as skipped, so opting
  in mid-tournament does not email old rounds.
- Every send is a campaign in email history (marked "Automatic notification"). A claimed chunk is not
  re-sent automatically if delivery fails; use **Retry failed** in the history.
- A missing SMTP configuration fails before anything is claimed. A failing ballot receipt never fails
  the ballot submission.

Private portal links and passcodes can now also be emailed to teams (`{{private_url}}` and
`{{passcode}}` resolve to the team's link for each speaker, or to the speaker's own link when they
have one). A send is refused if one address would receive two different links.

## Speaker private URLs

Tabbycat gives every speaker their own URL. In CrabbyTab this is optional, alongside the team's
URL and passcode, which never change because of it (printed links and QR codes keep working).
**Speaker private URLs** on the private URLs page (Teams tab) creates a key and passcode for every
speaker without one (`speakers[].privateUrlKey` / `privatePasscode`, prefix `spk_`), lists them,
and can remove them all. A speaker's link, `/{slug}/private/speaker/{key}`, opens the same portal
as the team link, with the speaker's passcode.

The server (`/api/private/team`, `/api/private/sync`) finds the team by the team key or through
the team's `speakerUrlKeys` index (one `array-contains` query) and checks the key and passcode
against the speaker record itself (`src/lib/privateSpeakerAccess.ts`): a speaker's key opens only
its own team, never with the team's or another speaker's passcode, and a key left in the index
after its speaker was removed opens nothing. Everything the portal does, it does as that team.
Speaker keys and passcodes are removed from assistant copies and never returned by participant or
public routes. The public API's participant authentication (`/api/v1`) accepts team and
adjudicator keys only.

## QR slips

**Print QR Slips** on the private URLs page prints one slip per participant in the current list
(adjudicators or teams, after search), with the QR code, link and optionally the passcode. QR codes are
generated locally by `src/lib/qr/qrcode.ts` (byte mode, versions 1–40, levels L/M/Q/H); its output was
checked against an independent decoder for every mask and level, and the tests pin it.

## Self check-in

With **Self check-in from private URLs** on (configuration → visibility), the team and adjudicator
portals show a check-in panel for the current round: the earliest round that is neither cancelled
nor completed. Requests go through `/api/private/sync` (passcode check and per-link rate limit) and
are refused for any other round.

The server writes `roundAvailability[roundId]` and `roundAvailabilityAt[roundId]` and bumps
`syncVersion`. A check-in reaches an organiser device when it downloads from the cloud or opens the
tournament, provided that device has not edited the participant since it last synced it. If it
has, the device keeps its own version and lists the participant as a sync conflict (the
**sync conflicts** warning in the top bar, or account menu → **Resolve sync conflicts**), where the
organiser keeps either version; uploading that older local copy
without choosing records a sync conflict in the cloud instead of silently overwriting the check-in.
The public check-in counts update at the next publish.

The public check-in page (`/{slug}/checkins/public`, *Public check-in status*) shows per-round
counts. When the participants list is public too, it also lists each team and adjudicator with
whether they are checked in for a chosen round (Tabbycat's public check-in statuses). Names follow
the public naming rules: team code names when those are on (a team without one shows "No public
name"), participant code names, and anonymous adjudicators are left out of the list (they are still
counted). No ids are stored or returned.

## Check-ins (history, bulk, speakers, printed forms)

Tabbycat's check-in events and bulk check-ins, mapped onto CrabbyTab's per-round availability
(`src/lib/checkins/history.ts`):

- **History.** Every availability change made on the Availability page (toggle, barcode scan, bulk
  action) or by self check-in is recorded as an event on the record itself (`checkInHistory`:
  time, round, present/absent, source, and the staff member's name), newest last, at most 50 per
  record (self check-ins are appended by the server without the cap). Speakers and rooms have
  their own history. The page lists the round's 25 most recent events. History syncs with the
  record (live for teams and adjudicators), so every device sees it; data-entry assistants may
  write it (firestore.rules allow it among the check-in fields, at most 50 entries).
- **Bulk check-in.** *Copy availability from R(n-1)* gives everyone without an explicit setting
  for this round their availability in the previous running round (both ways: CrabbyTab
  participants are present unless marked absent, unlike Tabbycat's check-ins);
  *Mark breaking adjudicators present* checks in every adjudicator flagged as breaking. Both
  record "bulk" events.
- **Speaker-level check-in.** Each speaker can be checked in for a round (toggle on the Teams tab,
  or scan the speaker's barcode, now on the printed label sheet). When every speaker of a team is
  in, the team becomes available; checking a speaker out does not withdraw the team. Data-entry
  assistants' speaker check-ins change the team's speakers, so they need the participant-editing
  permission where staff permissions apply.
- **Printed forms** (print pages → *Print options*): a return location printed on scoresheets and
  feedback forms (Tabbycat `score_return_location` / `feedback_return_location`; empty or "TBA"
  hides it), a digit strip to circle beside every score (`ballots_confirm_digits`), and a blank
  motion line (`ballots_hide_motions`) for printing before motions are released.

## Known limitations

- Notifications and self check-ins depend on the cloud copy, so they lag local changes until the
  next upload (or, for check-ins, the next download or tournament open). This goes away with the Firestore source-of-truth work
  (Phase 4.1).
- Notification templates are fixed in code.
- Veto statistics are not public: vetoes are not in the projection.
