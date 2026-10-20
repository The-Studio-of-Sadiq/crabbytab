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
| Institutions | `publicInstitutionsList` | name, code, region; team/adjudicator counts only if participants are public too |
| Adjudication core / Breaking adjudicators | `publicAdjudicatorCore` / `publicBreakingAdjudicators` | adjudicators flagged `adjCore` / `breaking` |

### Public-site settings (waves 4–5, Tabbycat `public_features` / `tab_release` / `ui_options`)

Every setting below is enforced by the projection when the view is published, so a hidden value
never reaches the public, a cache or a local copy. Defaults follow Tabbycat except where noted.
Per-item switches are on the **Public release** panel; modes, limits and text are under
**Settings → Public Visibility**. `getPublicSiteSettings` (`src/lib/publicFeatures.ts`) resolves
them with their defaults.

| Setting (Tabbycat) | Preference | Effect |
| --- | --- | --- |
| Public draw (`public_draw`) | `publicDrawMode`: off / current / all (absent: all, or off if the legacy `publicDraw` is false) | "Current round only" publishes only the latest released draw; earlier rounds stay public only through released results. Each projected round carries `drawPublic`. The projector and the v1 draws API (without the draws scope) follow it. |
| Record pages (`public_record`, default on) | `publicRecordPages` | `/[slug]/public/team/[id]` and `/adjudicator/[id]`: a participant's public debates and results, built from the projection only. Anonymous adjudicators have no record page. |
| Adjudicator tab (`adjudicators_tab_released`, `adjudicators_tab_shows`) | `releaseAdjudicatorTab`, `adjudicatorTabShows`: test / final / all | Base score, feedback-blended score (weight of the latest published round), or both plus per-round feedback averages. Computed at publish time; feedback content is never published. |
| Scoresheets (`ballots_released`) | `releaseBallots` | Each adjudicator's sheet, for rounds whose speaker scores **and** panels are public. Sheets are copied generically: known fields plus any numeric / side-valued field (criteria, ranks, declared winner); free text never passes. |
| Private scoresheets (`private_ballots_released`) | `releasePrivateBallots` | A team's private URL shows its own debates' full scoresheets once the round's results are released (even before team speaks); sheets need the panel to be public. |
| Tab limits (`team/speaker/replies_tab_limit`) | `teamTabLimit`, `speakerTabLimit`, `repliesTabLimit` (0 = all) | Tabs are computed at publish time (`tabs` section). With a limit, rounds visible only through a released tab (e.g. silent rounds) publish no individual results, so ranks below the cutoff cannot be rebuilt. Ties at the cutoff are kept. |
| Break category team tabs (`break_category_tabs_released`) | `releaseBreakCategoryTabs` | A team tab per break category, eligible teams re-ranked within it (shared ranks kept). |
| Break page metrics (`public_break_metrics_to_show`) | `publicBreakMetrics` (-1 all, 0 none, n) | The first n team precedence metrics of each breaking team. |
| Break categories on participants (`public_break_categories`) | `publicBreakCategories` | Team break eligibility is published only with this (or with category tabs). Before wave 4 eligibility was always published. |
| Pre-allocated sides (`public_side_allocations`) | `publicSideAllocations` | "Sides" tab: each team's pre-allocated side per preliminary round. |
| Elimination bracket | `publicBracket` | Built from public elimination draws and results; BP teams advance with 2+ points. |
| Diversity (`public_diversity`) | `publicDiversity` | Gender / region / category counts of speakers and adjudicators, chair / panellist / trainee allocations by gender, average speaker score by gender (public speaker scores only), average feedback received and given by gender. Counts and averages only. |
| Veto statistics | `publicVetoStatistics` (needs `enableMotionVetoes`) | Vetoes per motion and side, from ballots of rounds with public results. |
| Feedback progress (`feedback_progress`) | `publicFeedbackProgress` | Per public team / adjudicator, feedback owed and submitted in rounds whose panels are public. |
| Institutions (`show_team_institutions`, `show_adjudicator_institutions`) | `showTeamInstitutions`, `showAdjudicatorInstitutions` | When off, institution ids and names are removed from teams, adjudicators and tabs. |
| Team code names (`team_code_names`) | `teamCodeNames`: off / all-tooltips / admin-tooltips-code / admin-tooltips-real / everywhere | Every mode except off and all-tooltips publishes **only** the code name (teams without one have an empty name and show "(no public name)"). all-tooltips publishes the real name and the code name as a tooltip. A code name equal to the team name (what older versions stored) counts as none. |
| Participant code names (`participant_code_names`) | `participantCodeNames`: off / everywhere | Speakers and adjudicators are published under `codeName`. |
| Anonymous people (`Person.anonymous`) | `Speaker.anonymous`, `Adjudicator.anonymous` (participant directory) | Name published as empty with `anonymous: true`; pages show "Redacted". In tab rows an anonymous speaker also loses their team and gets an opaque id. |
| Emoji / speakers in draw / splitting adjudicators | `showEmoji`, `showSpeakersInDraw` (default on), `showSplittingAdjudicators` | Emoji are removed when off; splits are published as `splitAdjudicatorIds` on ballots whose panel is public. |
| Search engines (`search_engine_indexing`) | `searchEngineIndexing`: all / homepage-only / none | `noindex, nofollow` metadata on public pages (the public tab is the homepage), from the cached projection. |
| Welcome message, staff (`welcome_message`, `tournament_staff`) | `welcomeMessage`, `tournamentStaff` | Plain text (no HTML), at most 5000 characters, at the top of the public tab. |
| Motions order (`public_motions_order`) | `publicMotionsOrder`: forward / reverse | By the motions' earliest round; CrabbyTab's default stays forward (Tabbycat: reverse). |

**Code-name and emoji generators.** Settings → Public Visibility can fill in missing team emoji and
code names (emoji names or speakers' last names, Tabbycat's `code_name_generator`); existing values
are never overwritten (`src/lib/codeNames.ts`, seeded random source).

**Publish cost.** The projection reads the feedback collection only when the adjudicator tab (final
or all), diversity or feedback progress is on (`needsPublicFeedback`); otherwise a publish reads the
same collections as before. The new `tabs` and `derived` base sections are cached like the others;
views published before them read as having none until the next publish (view format 3).

### Public ballot and feedback forms (#26, Tabbycat `participant_ballots` / `participant_feedback` = "public")

`publicBallotForm` and `publicFeedbackForm` open `/[slug]/public/ballot` and `/[slug]/public/feedback`
**in addition to** private URLs, which keep working. The pages are built from the cached public
projection (rounds whose draw is public and whose panel has been announced); submitting posts to
`POST /api/public/tournaments/[slug]/submissions`.

- **Same rules as private URLs.** The route runs the shared participant-submission pipeline
  (`src/lib/participantSubmissions.ts`, also used by `/api/private/sync`): the participant must be on
  the debate, only voting adjudicators submit ballots, feedback must follow the round's feedback
  paths and questions, and scores are validated against the tournament's ranges.
- **Nothing counts until the tab room says so.** Anyone can pick a name on a public form, so public
  ballots are saved unconfirmed with `submitterType: "public"` (they never supersede an existing
  ballot) and public feedback is saved unconfirmed (confirm it on the feedback submissions page).
  With ballot receipts on, the named adjudicator is emailed a receipt, which also flags impersonation.
- **Password (`public_use_password`).** With `publicFormsUsePassword`, submissions need the
  tournament password. It is set under Settings → Public Visibility and stored only as a salted
  scrypt hash in `tournaments/{id}/serverOnly/publicForms` (admin route
  `GET/PUT /api/tournaments/[id]/public-forms`), never in the published preferences. While no
  password is set, the forms refuse submissions.
- **Abuse protection.** A hidden honeypot field and a minimum fill time (as the registration form),
  a 32 KB body limit, per-address-per-tournament (60/h), per-address (120/h) and per-tournament
  (3000/h) submission limits, and at most 20 wrong passwords per address per hour.
- **Limits.** Debates whose sides are chosen on the ballot ("manual ballot" sides) and anonymous
  adjudicators (no public name) must use private URLs. The ballot form records speaker scores,
  replies and ranks; vetoes and forfeits are left to private URLs and the tab room.

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

## Projector display (`/[slug]/display`)

Three views: **Draw by room** (responsive: one column on phones, two on tablets, four BP positions on
wide screens), **Draw by team** (alphabetical, with side, room and opponents) and **Motion reveal**.

The motion reveal shows a cover slide, then each motion's information slide (if any) followed by the
motion, in `seq` order. Keys: → / Space / Enter / Page Down advance, ← / Backspace / Page Up go back,
Home / End jump, Esc returns to the draw.

Public viewers only see released motions (the projection holds nothing else). Signed-in users whose
administrator role is confirmed by `/api/tournaments/[id]/access` can preview unreleased motions;
those come from the administrator's own working copy on this device (IndexedDB), never from a
server response.

## Automatic notifications

Opt in per event on the email page:

| Preference | Sent to | When |
| --- | --- | --- |
| `notifyDrawReleased` | each team's speakers | the round's draw is confirmed or released (panels show "TBA" until revealed) |
| `notifyDrawReleased` | each allocated adjudicator | the draw is visible **and** panels are revealed |
| `notifyTeamPoints` | each team's speakers | results are released, the round is not silent and public results are on |
| `notifyBallotReceipt` | the submitting adjudicator | they submit a ballot from their private URL |

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
`{{passcode}}` resolve to the team's link for each speaker). A send is refused if one address would
receive two different links.

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

## Known limitations

- Notifications and self check-ins depend on the cloud copy, so they lag local changes until the
  next upload (or, for check-ins, the next download or tournament open). This goes away with the Firestore source-of-truth work
  (Phase 4.1).
- Notification templates are fixed in code.
- Veto statistics are not public: vetoes are not in the projection.
