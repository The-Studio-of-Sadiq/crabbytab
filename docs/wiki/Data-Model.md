# Data model

A map of CrabbyTab's records for contributors: what each record is, its key fields, how records point at each other, and where they are stored. It is not a field-by-field dump; the source of truth is [`src/types/index.ts`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/src/types/index.ts). Storage and sync are covered in depth in [storage-and-scale.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/storage-and-scale.md) and [live-collaboration.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/live-collaboration.md).

## The big picture

```
Tournament (settings in preferences)
├── Round ─────────────── Debate ── team slots by side ── Team ── Speaker[]
│                           ├── panel ── Adjudicator (conflicts[])
│                           ├── Venue
│                           ├── Motion
│                           ├── BallotSubmission (versions) ── speaker ids
│                           ├── FeedbackSubmission
│                           └── BallotIntakeRecord (paper sheets received)
├── Institution ◄── Team.institutionId, Adjudicator.institutionId
├── BreakCategory ◄── Team.breakCategories
└── AuditEvent (append-only)
```

Standings, the team and speaker tabs and most statistics are **never stored**: they are computed from rounds, debates and confirmed ballots whenever they are needed. The public site stores a pre-computed copy (see [Public snapshots](#4-public-snapshots)).

## Tournament and settings

| Record | Key fields | Notes |
| --- | --- | --- |
| **Tournament** | `id`, `name`, `shortName`, `slug`, `format`, `ownerId`, `admins` (uid → true), `preferences`, `active`, `createdAt`, `updatedAt` | `format` is `bp`, `uadc`, `australs`, `wsdc`, `custom_2team` or `poly` (N teams per room) |
| **TournamentPreferences** | `teamsInDebate`, `substantiveSpeakers`, score ranges, draw rules, ballot rules, feedback paths, standings precedence, public-site and release flags | All settings; see [Settings reference](Settings-Reference) |

Several small lists live **inside `preferences`**, not in their own collections:

| List | Type | Used for |
| --- | --- | --- |
| `speakerCategories` | `SpeakerCategory` (`id`, `name`, `slug`, `seq`, `public`, `limit`) | ESL, novice, … speaker tabs and break rules |
| `teamFeedbackQuestions`, `adjudicatorFeedbackQuestions`, `feedbackQuestions` | `FeedbackQuestion` (`id`, `label`, `type`, `required`, `options`, `min`, `max`) | Custom feedback questions |
| `scoreCriteria` | `ScoreCriterion` (`id`, `name`, `weight`, `minScore`, `maxScore`, `step`, `speechType`) | Weighted speaker-score criteria |
| `scheduleEvents` | `ScheduleEvent` (`id`, `type`, `startTime`, `endTime`, `roundId`) | Tournament schedule |
| `venueCategories` | `VenueCategoryInfo` (`name`, `description`, `displayInName`) | Room-category display options |
| `currentRoundId`, `releasedBreakCategoryIds` | ids | Public "current round" and released breaks |

There is no separate **division** record: teams carry `divisionId` / `divisionName`, and a round may carry `divisionId`.

## Rounds

| Record | Key fields |
| --- | --- |
| **Round** | `seq`, `name`, `abbreviation`, `stage` (`preliminary` / `elimination`), `drawType` (`random`, `power_paired`, `round_robin`, `seeded`, `elimination`, `manual`), `drawStatus`, `motionsStatus` (+ derived `motionsReleased`), `adjudicatorsRevealed`, `resultsReleased`, `teamSpeaksReleased`, `silent`, `completed`, `cancelled`, `feedbackWeight`, `feedbackEnabled`, `weight`, `scheduleGroup`, `startsAt`, `breakCategoryIds`, `eliminationAdvanced`, `divisionId`, `drawSeed`, `preallocatedSides`, `preformedPanels[]`, `roundRobinAlgorithm` |
| **PreformedPanel** (inside a round) | `id`, `chairId`, `panellistIds`, `traineeIds`, `importance`, anticipated-draw notes (`roomRank`, `bracketMin/Max`, `liveness`) |

`drawStatus` is `none`, `draft`, `locked` (confirmed, not public), `teams_released`, `confirmed` or `released`. `confirmed` and `released` both mean public (older data); read it through `drawStageOf()` in `src/lib/draw/drawStatus.ts`.

## Participants

| Record | Key fields |
| --- | --- |
| **Institution** | `name`, `code`, `region`, `venueRequirements`, `venueConstraints`, `coaches[]` (`id`, `name`, `email`; organiser-only) |
| **Team** | `name`, `institutionId` (+ copied `institutionName`), `speakers[]`, `codeName`, `emoji`, `seed`, `breakCategories` (eligible category ids), `speakerCategories` (legacy labels), `institutionConflictIds`, `divisionId` / `divisionName`, check-in fields, `venueRequirements`, `venueConstraints`, `privateUrlKey`, `privatePasscode`, `speakerUrlKeys` |
| Team, Tabbycat naming | `reference`, `shortReference`, `useInstitutionPrefix`, derived `longName` / `shortName` |
| Team, special kinds | `isSwing` + `swingRoundIds` (left out of standings and breaks); `isComposite` + `compositeInstitutionIds` (a normal team with several institutions) |
| Team, break result | `breakStatus` (`breaking` / `eliminated`), `breakCategoryIds`, `eliminatedInRoundId` |
| **Speaker** (inside a team) | `id`, `name`, `lastName`, `pronoun`, `email`, `gender`, `region`, `categories` (speaker-category ids), `phone`, `roundAvailability`, `anonymous`, `codeName`, `privateUrlKey`, `privatePasscode`, `swingSourceSpeakerId` |
| **Adjudicator** | `name`, `lastName`, `pronoun`, `email`, `institutionId` (+ `institutionName`), `baseScore`, `testScore`, `scoreHistory[]`, `trainee`, `independent`, `conflicts[]`, `adjCore`, `breaking`, `isTester`, `preformedPanelId`, `gender`, `region`, `phone`, check-in fields, `venueRequirements`, `venueConstraints`, `anonymous`, `codeName`, `privateUrlKey`, `privatePasscode` |
| **AdjudicatorConflict** (inside an adjudicator) | exactly one of `teamId`, `adjudicatorId`, `institutionId`; `type` = `personal`, `institution` or `history` |
| **Venue** | `name`, `priority` (higher = better), `category` + `categories[]`, `capacity`, `accessible`, `online`, `nearTabRoom`, `url`, `available`, `roundAvailability`, `checkedIn`, `checkedInAt` |

Check-in fields shared by teams and adjudicators: `checkedIn`, `checkedInAt`, `roundAvailability` (round id → available), `roundAvailabilityAt`, `checkInHistory[]` (`at`, `roundId`, `available`, `source`, `by`).

Team–institution conflicts are on the team (`institutionConflictIds`); every other conflict is on the adjudicator. A mutual adjudicator–adjudicator conflict may be stored on one side only.

## Debates (the draw)

| Record | Key fields |
| --- | --- |
| **Debate** | `roundId`, `roundSeq`, `teams` (side → slot), `adjudicators` (panel), `venueId` (+ `venueName`), `motionId` (+ `motionText`), `bracket`, `roomRank`, `importance`, `resultStatus` (`none` / `draft` / `confirmed`), `sidesConfirmed`, `flags`, `byeTeamId` + `byeResult`, `breakCategoryId`, `postponed`, `postponedReason`, `scheduledTime`, required-room fields (`requiredVenueCategory`, `requiredVenueCapacity`, `requiresAccessibleVenue`, …) |
| **DebateTeamSlot** | `teamId`, `teamName`, `side`, `points`, `speakerScoreTotal`, `pulledUp`, `flags` (Tabbycat draw flags), `bracketPosition` (eliminations) |
| **DebateAdjudicatorSlot** | `chairId` / `chairName`, `panellistIds` / `panellistNames`, `traineeIds` / `traineeNames` |

**Sides** are the keys of `Debate.teams`, and the same keys are used in ballots:

| Format | Sides |
| --- | --- |
| BP | `OG`, `OO`, `CG`, `CO` |
| Two-team formats | `AFF`, `NEG` (displayed with the tournament's side names) |
| N-team (`poly`) | `P1` … `PN`, where N is `preferences.teamsInDebate` (any whole number other than 2 and 4). A short last room may use fewer positions |

With the `manual_ballot` side rule, `sidesConfirmed` stays false until a confirmed ballot records which team took which side.

## Results

| Record | Key fields |
| --- | --- |
| **BallotSubmission** | `debateId`, `roundId`, `version`, `confirmed`, `discarded`, `submitterType` (`tabroom` / `judge` / `public`), `submitterId`, `speakerScores` (side → `SpeakerScoreEntry[]`), `teamScores` (side → `TeamScoreEntry`), `sheets[]` (voting ballots), `motionId`, `vetoes`, `motionPreferences`, `forfeitSide`, `noSpeakerScores`, `singleAdjudicator`, `mergedFromIds`, `selfSplit`, `checksVersion`, confirm/discard audit fields |
| **SpeakerScoreEntry** | `speakerId`, `speakerName`, `position`, `score`, `ghost` (iron-person speech), `rank`, `criteria` (criterion id → score) |
| **TeamScoreEntry** | `teamId`, `side`, `points`, `totalSpeakerScore`, `win`, `margin`, `rank` (BP and N-team), `votes`, `forfeit` |
| **AdjudicatorSheet** (voting) | `adjudicatorId`, `speakerScores`, `declaredWinner` |
| **BallotIntakeRecord** | `debateId`, `roundId`, `sheetCode`, `adjudicatorId` (voting sheets), `receivedAt`, `receivedBy`. The id is derived from the sheet, so scanning one sheet on two devices gives one record |
| **FeedbackSubmission** | `debateId`, `roundId`, `sourceType` (`team` / `adjudicator`) + `sourceId`, `targetType` (`adjudicator` / `team`) + target id, `score`, `agreeWithDecision`, `comments`, `answers` (question id → answer), `confirmed`, `ignored` |
| **Motion** | `text`, `reference`, `infoSlide`, `rounds[]` (round ids), `seq`, `roundSeq` (round id → order), `released` |

A debate's result is its **one confirmed, non-discarded ballot**. Older versions stay as history. A ballot whose teams no longer match the debate's slots never counts. Voting ballots hold the aggregated result at the top level and each adjudicator's sheet in `sheets`.

## Breaks and audit

| Record | Key fields |
| --- | --- |
| **BreakCategory** | `name`, `slug`, `seq`, `breakSize`, `reserveSize`, `isGeneral`, `priority`, `maxPerInstitution`, `limit`, `qualificationRule`, `teamOverrides` (team id → `include` / `ineligible` / `withdrawn` / …), `speakerCategoryRule`, `generatedBreak` (`breakingTeamIds`, `reserveTeamIds`, `generatedAt`) |
| **AuditEvent** | `timestamp`, `actorType` (`user` / `system` / `public`), `actorId`, `action`, `category`, `summary`, `details`, `roundId`, `debateId`, and once released `sequence`, `previousHash`, `hash` |

Generating a break writes the result twice: on each team (`breakStatus`, `breakCategoryIds`) and as a snapshot on the category (`generatedBreak`).

## Identifiers and references

- Ids are opaque strings, unique within a tournament. New records get a prefix plus a random UUID from `createEntityId` (`team-…`, `spk-…`, `adj-…`, `inst-…`, `ven-…`, `motion-…`, `bc-…`); rounds, debates and ballots use their own patterns (`round-…`, `debate-{roundId}-…`, `ballot-{debateId}-…`). Never parse meaning from an id.
- Every tournament record has `id` and `tournamentId`. Speakers, conflicts and preformed panels are nested and have no `tournamentId`.
- Records point at each other **by id**. Names are copied next to ids (`teamName`, `chairName`, `venueName`, `institutionName`, `motionText`, …) for display; the id wins when they disagree.
- **Speaker ids must stay stable**: ballots refer to speakers by id. Imports and edits update speakers in place; a speaker with scores cannot be removed.

| Field | Points to |
| --- | --- |
| `Team.institutionId`, `Adjudicator.institutionId`, `Team.institutionConflictIds`, `Team.compositeInstitutionIds` | Institution |
| `Team.breakCategories`, `Team.breakCategoryIds`, `Round.breakCategoryIds`, `Debate.breakCategoryId` | BreakCategory |
| `Speaker.categories`, `BreakCategory.speakerCategoryRule.speakerCategoryId` | `preferences.speakerCategories` (older data may hold names or slugs; resolved by id, slug or name) |
| `AdjudicatorConflict.teamId` / `adjudicatorId` / `institutionId` | Team / Adjudicator / Institution |
| `Debate.roundId`, `Motion.rounds[]`, `Team.swingRoundIds`, `roundAvailability` keys | Round |
| `Debate.teams[side].teamId`, `Debate.byeTeamId` | Team |
| `Debate.adjudicators.*Ids`, `PreformedPanel.*Ids` | Adjudicator |
| `Debate.venueId` | Venue |
| `Debate.motionId`, `BallotSubmission.motionId`, `vetoes` values | Motion |
| `BallotSubmission.debateId`, `FeedbackSubmission.debateId`, `BallotIntakeRecord.debateId` | Debate |
| `SpeakerScoreEntry.speakerId` | Speaker (inside the team in that slot) |
| `FeedbackSubmission.answers` keys | Feedback question ids in `preferences` |

## Where data is stored

### 1. The working copy on the device

Each tournament's working copy is in **IndexedDB** (database `crabbytab`, store `kv`; `src/lib/offline/localStore.ts`). Keys are `crabbytab_t_{slug}_{suffix}`, each holding a JSON string:

| Suffix | Holds |
| --- | --- |
| `meta` | The Tournament record |
| `rounds`, `teams`, `adjudicators`, `venues`, `motions`, `debates`, `ballots`, `feedback`, `institutions`, `auditEvents`, `ballotIntake` | One array per collection |
| `breaks` | Break categories (collection `breakCategories`) |
| `syncBaseline`, `syncTombstones`, `syncOverwrites`, `syncDiverged`, `syncUploadIssue`, `privateSyncQueue` | Sync bookkeeping |
| `verifiedRole`, `liveSyncDisabled` | Per-device state |

If IndexedDB is unavailable the same keys fall back to localStorage. Theme, language and remembered portal passcodes stay in localStorage. Separately, the Firebase SDK keeps its own persistent IndexedDB cache for live listeners and offline writes (`src/lib/firebase.ts`).

Local-only tournaments never leave the device. Cloud tournaments sync as described in [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).

### 2. Firestore

The synced collections (`CLOUD_COLLECTIONS` in `src/features/tournament/collections.ts`) are `rounds`, `teams`, `adjudicators`, `venues`, `motions`, `breakCategories`, `debates`, `ballots`, `feedback`, `institutions`, `auditEvents` and `ballotIntake`. On administrator devices, `ballots`, `debates`, `teams` and `adjudicators` are also written and read live, record by record.

"Admin" below means a tournament administrator: the owner, a uid in `admins`, a `staff` member with role `admin`, or a global admin (custom claim `globalAdmin`). "Server" means server routes using the Admin SDK, which bypass the rules.

| Path | Holds | Client access (firestore.rules) |
| --- | --- | --- |
| `tournaments/{tournamentId}` | Tournament (with `preferences`) | Read: admins and data-entry assistants. Create: global admins. Update: admins, but only the owner changes `admins` and nobody changes `ownerId` |
| `tournaments/{id}/{collection}/{recordId}` for the 12 synced collections | One record per document, plus `syncVersion` and, when deleted, `deletedAt` | Admins. Assistants may also create their own unconfirmed ballots and change only check-in fields on teams and adjudicators (with the matching staff permission) |
| `tournaments/{id}/staff/{uid}` | Staff assignment: `email`, `displayName`, `role` (`admin` / `dataEntry`), `addedAt`, `addedBy`; for data entry also `groups`, `extraPermissions`, `permissions` | Admins |
| `tournaments/{id}/syncConflicts/{id}` | Archived versions replaced or deleted by an upload (`collectionName`, `recordId`, `record`, `resolution`, `archivedAt`) | Admins read and create; never update or delete |
| `tournaments/{id}/auditEvents/{id}` | Audit events | Admins read; create only own events; never update or delete |
| `tournaments/{id}/auditReleases/current` and `…/auditReleases/{releaseId}/events/{seq}` | Released, hash-chained public audit log | Server only |
| `tournaments/{id}/apiTokens/{id}` | `name`, `scopes`, `tokenHash`, `createdAt`, `createdBy` (the secret is never stored) | Admins (generic rule); written by the server |
| `tournaments/{id}/emailCampaigns/{id}` | Email history | Admins (generic rule); written by the server |
| `tournaments/{id}/notificationLog/{event-round}` | Automatic-notification claims (one per event and round) | Admins (generic rule); written by the server |
| `tournaments/{id}/data/participantIndex` | Marker (`{ version: 1 }`) that every debate carries `participantIds` | Admins |
| `tournaments/{id}/serverOnly/…` | See below | Never (server only) |
| `tournamentSlugs/{slug}` | `{ tournamentId }`, reserves a slug | Read: signed-in users. Written with the tournament, checked against it |
| `publicViews/{slug}` and `…/chunks/{section}-{hash}-{i}` | Published public snapshot | Never (server only) |
| `apiRateLimits/{key}` | Private-URL and API throttling counters | Server only (catch-all rule: global admins) |
| `users/{uid}` | Allowed by the rules for the user themselves; no current code reads or writes it | Own document only |

Debates in Firestore also carry a derived `participantIds` array (every team and adjudicator in the room) so private portals can query only their own debates. It is cloud-only: downloads strip it and sync hashing ignores it.

Cloud deletions are **soft**: the document stays with `deletedAt` set and a higher `syncVersion`, and the previous version is archived in `syncConflicts`.

### 3. Server-only documents

Under `tournaments/{id}/serverOnly/`, read and written only by server routes:

| Document | Holds |
| --- | --- |
| `registration` | Registration settings; subcollections `submissions`, `representatives`, `transfers`, `teamInvitations` |
| `registrationCounters` | Registration quota counters |
| `staffInvitations/items/{id}` | Staff invitations |
| `staffPermissionGroups` | Custom staff permission groups |
| `emailSettings` | Email sender settings |
| `publicForms` | The public ballot/feedback form password |

### 4. Public snapshots

Public pages never read the tournament collections. When an admin publishes (normally right after an upload), a server route reads the cloud copy and builds a **projection** (`src/lib/publicView/projection.ts`): an allowlist of fields from released data only (never emails, private URLs, passcodes or phone numbers), plus pre-computed tabs and aggregates (`derived.ts`). It is stored by `src/lib/publicView/store.ts`:

| Document | Holds |
| --- | --- |
| `publicViews/{slug}` | `PublicViewRoot`: `tournamentId`, `slug`, `version` (combined hash), `sections` (name → hash and chunk count), `roundIds`, `publishedAt`, `motionSummary`, `seo` |
| `publicViews/{slug}/chunks/…` | Section JSON. Base sections: `tournament`, `rounds`, `teams`, `adjudicators`, `venues`, `motions`, `breakCategories`, `institutions`, `checkins`, `tabs`, `derived`; plus one `round-{roundId}` section (debates and ballots) per public round |

Sections are content-addressed, so an unchanged section is neither rewritten nor re-downloaded, and reads are served through the Vercel Data Cache. See [Public pages and releases](Public-Pages-and-Releases).

## Sync fields

| Field | Meaning |
| --- | --- |
| `syncVersion` | Cloud version of a record; bumped on every cloud write. A device refuses to overwrite a newer cloud version (the conflict is archived instead) |
| `deletedAt` | Soft-deleted in the cloud |
| `participantIds` | Cloud-only debate index for private portals |

## File formats

| Format | Contents | Page |
| --- | --- | --- |
| JSON backup `crabbytab-tournament-backup-v1` | The tournament and every synced collection | [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync) |
| Sync recovery file `crabbytab-sync-recovery-v1` | Archived conflict versions | [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync) |
| Settings file `crabbytab.tournament-config` v1 | Format and preferences only | [Settings reference](Settings-Reference) |
| DebateXML | Tabbycat's archive schema (import creates a new tournament) | [Participants and imports](Participants-and-Imports) |
| CSV | Participant imports and exports | [CSV formats](CSV-Formats) |

## Changing the data model

- Add new fields as **optional** and treat "absent" as the old behaviour: existing tournaments, backups and cloud documents do not have them. Many types document their "Absent = …" default in a comment.
- Older values stay readable (for example `drawStatus: "confirmed"`, speaker categories stored as names, `Venue.category` without `categories`). Read through the helper named in the type's comment rather than the raw field.
- A new collection needs entries in `CLOUD_COLLECTIONS`, the backup validator, the device keys and, if public, the projection; check `firestore.rules` and the assistant and public projections for private fields.
