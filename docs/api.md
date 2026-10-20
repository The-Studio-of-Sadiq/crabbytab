# REST API (v1)

CrabbyTab's API mirrors Tabbycat's v1 API (`tabbycat/api/urls.py`, v2.12.1) for one tournament
at a time. The route definitions in `src/lib/api/v1/routes/` are the single source of truth: the
dispatcher enforces them, and both the OpenAPI 3.1 document (`GET /api/openapi.json`) and the
reference page (`/tournaments/api`) are generated from them.

## Tokens and scopes

Tournament administrators create tokens on **API access** (tournament menu). A token belongs to one
tournament, is stored as a SHA-256 hash and is shown once. Revoking deletes it.

| Scope | Grants |
|---|---|
| `read:public` | Exactly what the public site shows: the published, release-gated public view. Cannot be combined with other scopes. |
| `read:<area>` | Administrator read access to one area (unreleased data included). |
| `write:<area>` | Read and write access to one area (see "Writes"). |

Areas: `tournament` (tournament, preferences, feedback questions, score scales and criteria,
speaker categories, schedule events), `rounds` (rounds, motions), `participants` (institutions,
teams, speakers, adjudicators), `venues` (venues, venue categories), `breaks`, `draws` (pairings,
preformed panels), `results` (ballots), `feedback`, `checkins` (availability, check-ins),
`standings` (read only), `staff` (permission groups, read only: staff access is granted only by a
signed-in administrator on the Staff page, never by a token).

Tokens created before per-area scopes (`scope: "read:public"` or `"read:draws"`) keep working.

Never returned, whatever the scope: private URL keys, passcodes and email addresses.

### Public tokens and release gates

A `read:public` token is served from the published public view
(`src/lib/publicView/projection.ts`), the same data the public site shows: draws only once
released, panels once revealed, motions once released, results once released; team, speaker and
reply standings and the participant and institution lists only once the tab director releases them
(403 before that); a break category's break once released. The view is cached on Vercel, so public
reads cost almost no Firestore reads. Data changed in the tab room reaches public tokens when it is
published, exactly as for the public site.

### Anonymous access

Every endpoint a `read:public` token may use also answers requests with **no `Authorization`
header at all** (Tabbycat's anonymous access to public data). Such a request sees exactly what a
`read:public` token sees — the published public view, release-gated, never unreleased data — and
costs no Firestore reads. It is limited to 60 requests per client address per minute (per server
instance); use a token for more. Administrator endpoints still answer 401 without a token, and a
malformed `Authorization` header is always 401.

### `/me` for participants

`GET /api/v1/tournaments/{slug}/me` identifies a participant from their private URL slip:

```bash
curl -H "Authorization: Key team_abcd2345efgh" -H "X-Passcode: k3j9m2xx" \
  https://HOST/api/v1/tournaments/SLUG/me
```

Unknown keys and wrong passcodes get the same 401, and attempts are limited to 120 per client
address per hour (durable limiter).

The same two headers let a participant submit what the private portal submits (Tabbycat's URL-key
ballot and feedback submission), checked with the portal's own rules
(`src/lib/privateBallot.ts`, `src/lib/participantSubmissions.ts`, shared with
`/api/private/sync`):

- `POST /me/ballots` — a voting adjudicator's ballot for a debate of a released draw
  (`debateId`, `speakerScores` by side in speaking order, `teamScores` with each side's `rank`,
  `teamId` when sides are chosen on the ballot, `selfSplit`). Refused when the tournament turned
  private-URL ballots off. A chair's ballot is confirmed unless the tab room confirms private
  ballots; it supersedes the adjudicator's earlier versions; a completed or published round keeps
  its result (the ballot is stored unconfirmed for the tab room). Ballot receipts are not emailed
  for API submissions.
- `POST /me/feedback` — feedback under the tournament's feedback paths and questions.
- `PUT /me/checkin` — `{ "available": true|false }` for the current round, when self check-in is on.

Someone else's debate, or one whose draw is not released to the participant, is a 404. Audit
events name the participant (`actorId: "participant:<type>:<id>"`, `actorType: "public"`).

## Requests and responses

```bash
TOKEN=ct_live_...
curl -H "Authorization: Bearer $TOKEN" https://HOST/api/v1/tournaments/SLUG/rounds
curl -H "Authorization: Bearer $TOKEN" "https://HOST/api/v1/tournaments/SLUG/teams?limit=100"
curl -H "Authorization: Bearer $TOKEN" "https://HOST/api/v1/tournaments/SLUG/teams?limit=100&cursor=dGVhbS0wNTA"
curl -H "Authorization: Bearer $TOKEN" "https://HOST/api/v1/tournaments/SLUG/rounds/3/pairings"
curl -H "Authorization: Bearer $TOKEN" "https://HOST/api/v1/tournaments/SLUG/teams/standings?round=4"
```

- Rounds are addressed by sequence number (`/rounds/{roundSeq}`); everything else by id.
- Paginated lists (teams, speakers, adjudicators, institutions, venues, a round's ballots,
  feedback, break eligibility) take `limit` (1–200, default 50) and `cursor`, and return
  `{ "data": [...], "nextCursor": "..." | null }`. Pages are in document-id order and a page
  reads only `limit + 1` documents. Lists bounded by the tournament's configuration (rounds,
  motions, break categories, a round's pairings) return `{ "data": [...] }` in natural order.
- Errors are `{ "error": { "code", "message", "issues"?, "violations"? } }`. Codes:
  `bad_request` (400), `validation_failed` (422, `issues[]` with paths), `unauthenticated` (401),
  `forbidden` (403), `not_found` (404), `method_not_allowed` (405, `Allow` header),
  `rule_violation` (409, tournament rules, `violations[]`), `conflict` (409),
  `payload_too_large` (413), `rate_limited` (429, `Retry-After`), `internal` (500).
- Unknown query parameters and body fields are rejected (422), so typos are never ignored.
- Every response has `Cache-Control: no-store` and an `X-Request-Id`.

### Read endpoints

All paths are below `/api/v1/tournaments/{slug}`.

| Tabbycat | CrabbyTab | Scope |
|---|---|---|
| tournament detail | (the slug itself) | tournament / public |
| preferences | `/preferences` | tournament |
| feedback questions | `/feedback-questions[/{id}]` (`?fromTeams=`, `?fromAdjudicators=`) | tournament |
| score criteria | `/score-criteria[/{id}]` (score scales; criteria when configured) | tournament |
| schedule events | `/schedule-events[/{id}]` | tournament / public (once `publicSchedule` is on) |
| user groups | `/user-groups[/{id}]` (built-in and custom staff permission groups) | staff |
| speaker categories (+eligibility) | `/speaker-categories[/{id}[/eligibility]]` | tournament / public; eligibility: participants |
| rounds | `/rounds[/{roundSeq}]` | rounds / public |
| motions | `/motions[/{id}]` (`?roundId=`) | rounds / public |
| institutions | `/institutions[/{id}]` | participants / public* |
| teams | `/teams[/{id}]` (`?institutionId=`) | participants / public* |
| speakers | `/speakers[/{id}]` | participants / public* |
| adjudicators | `/adjudicators[/{id}]` (`?institutionId=`, `?break=true` for breaking adjudicators) | participants / public* (breaking: once released) |
| venues, venue categories | `/venues[/{id}]` (`?category=`), `/venue-categories[/{name}]` | venues / public |
| break categories, eligibility, break | `/break-categories[/{id}[/eligibility or /break]]` | breaks / public (break once released) |
| pairings | `/rounds/{seq}/pairings[/{debateId}]` | draws / public |
| preformed panels | `/rounds/{seq}/preformed-panels[/{panelId}]` | draws |
| ballots | `/rounds/{seq}/ballots` (`?confirmed=`), `/rounds/{seq}/pairings/{id}/ballots[/{ballotId}]` | results |
| availabilities | `/rounds/{seq}/availabilities` (`?teams=`, `?adjudicators=`, `?venues=`) | checkins |
| check-ins | `/teams/{id}/checkin`, `/speakers/{id}/checkin`, `/adjudicators/{id}/checkin`, `/venues/{id}/checkin`, `/rounds/{seq}/pairings/{id}/checkin` | checkins |
| feedback | `/feedback[/{id}]` (`?roundId=` one or comma-separated, `?targetAdjudicatorId=`, `?sourceId=`, `?sourceType=`; combinable) | feedback |
| team standings, by round | `/teams/standings[/rounds]` (`?round=`; standings also `?category=` break category, `?metrics=`) | standings / public* |
| team current-round results | `/teams/standings/current-rounds` | standings / public (unless `publicStandings` is off) |
| speaker standings, replies, by round | `/speakers/standings[/replies or /rounds]` (`?round=`, `?metrics=`; speakers `?category=` speaker category; by round `?substantive=`, `?replies=`, `?ghost=`) | standings / public* |
| adjudicator standings | `/adjudicators/standings` | standings + feedback |
| me | `/me` | private URL key + passcode |
| — | `/draws` (the first v1 endpoint, legacy shape) | draws / public |

\* public only once released.

Standings queries:

- `?round=N` gives the standings after round N. Public tokens (and anonymous requests) may pick
  any round of the released tab (completed preliminary rounds); others are 404.
- `?category=` ranks a break category's eligible teams (team standings) or a speaker category's
  speakers (speaker standings) among themselves. Public requests need break eligibility released
  (`publicBreakCategories` or break category tabs) and see only public speaker categories.
- `?metrics=a,b,c` ranks by those metric ids for this request only (Tabbycat's `metrics`); every
  metric is returned whatever the ranking, so Tabbycat's `extra_metrics` is not needed.
- `/teams/standings/current-rounds` is the public Standings page (Tabbycat's
  `public_team_standings`): each team's results in rounds whose results are released and not
  silent; speaker scores only for rounds whose team speaks are released, totals only when all are.
- `/speakers/standings/rounds` lists each speech with its `kind` (`substantive`, `reply`,
  `ghost`); substantive speeches by default.

Not mapped, by design: site-wide users and global institutions (accounts are Firebase Auth
identities and institutions are per tournament), web-push registration (CrabbyTab notifies by
email and has no browser push), Tabbycat's generic `/questions` (registration questions), and
the list/create/delete of tournaments (a token belongs to one tournament).

Differences from Tabbycat: speakers check in with their team (CrabbyTab checks teams in); a
debate's check-in is its paper-ballot receipts (`ballotIntake`); a venue category is a name on
the venues plus optional display settings; ids are strings; standings are computed with
CrabbyTab's configured precedence (`docs/standings-and-breaks.md`). A check-in "identifier"
(Tabbycat's POST on a check-in) is the record id itself for people and rooms (the Code 39 barcode
on the check-ins page) and the ballot-sheet code for debates, so `POST .../checkin` returns it.

## Writes

Every write runs a tab-room command (`src/features/tournament/application/*`) through
`src/lib/api/v1/session.ts` and `tabRoom.ts`: the same command, the same tournament rules
(`stateGuards.ts`) and the same audit events as the UI, never a raw Firestore write.

- **Atomic.** A write runs in one Firestore transaction: the command reads what it needs, and its
  changes are committed together only if it succeeds. A refused write changes nothing.
- **Rules.** A blocked action returns `409 rule_violation` with `violations[]`
  (`rule`, `message`, `overridable`). Where every violation is overridable, repeat the request with
  `"override": { "reason": "..." }`; the reason is recorded in the audit log
  (`rules.overridden`), exactly like the tab room's override dialog. Hard rules (deleting a team
  that has debated, a tie at the break cutoff, ...) cannot be overridden.
- **Versions.** Every changed record is written at the next `syncVersion`, and the version it
  replaces is archived in `syncConflicts` (resolution `superseded`, or `recoverable-delete` for a
  deletion). Deletions are soft (`deletedAt`). Send `expectedVersion` (the `syncVersion` you read)
  on PATCH requests to get `409 conflict` instead of overwriting a concurrent change. Responses
  show the stored `syncVersion`.
- **Tab-room devices.** Records that sync live (ballots, debates, teams, adjudicators) reach open
  admin devices through their listeners. Everything else reaches a device on its next download; a
  device that uploads an older copy has it archived as a sync conflict instead of overwriting the
  API's change (the same protection as between two devices).
- **Public site.** API writes change the cloud data at once but reach the public site (and
  `read:public` tokens) when the tournament is published: `POST /tournaments/{slug}/publish`
  (`write:tournament`) or Publish in the tab room.
- **Audit.** Each write's audit events carry `actorId: "api-token:<id>"`, the token's name and the
  request id (`X-Request-Id`).
- **Double entry.** With `ballotDoubleEntry` on, a token counts as one person: it cannot confirm a
  ballot it entered without an override; a second token (or a person in the tab room) can.
- **Ballots** are sent as the ballot form records them (`entry.speakerScores` by side, `ranks` for
  consensus ballots, `sheets` for voting ballots, `forfeitSide`, `motionId`, `vetoes`) and are
  validated with the form's own checks; points, wins, margins and voting majorities are computed,
  never accepted from the client. Manual-ballot debates also need `sides`.

`drawStatus` values: `none`, `draft`, `locked` (confirmed, not released), `teams_released` (each
team sees its pairing on its private URL only) and `confirmed` (the public release; `released` is
read as a synonym). See [draw-generation.md](./draw-generation.md#draw-release-stages).

Generate round 3's draw, allocate panels of three and release it:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' \
  https://HOST/api/v1/tournaments/SLUG/rounds/3/pairings/generate-draw
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"panelSize":3}' \
  https://HOST/api/v1/tournaments/SLUG/rounds/3/pairings/allocate-adjudicators
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"drawStatus":"confirmed","adjudicatorsRevealed":true}' https://HOST/api/v1/tournaments/SLUG/rounds/3
```

Enter and confirm a two-team consensus ballot (body of
`POST /rounds/3/pairings/DEBATE_ID/ballots`):

```json
{
  "entry": {
    "speakerScores": {
      "AFF": [{ "speakerId": "s1", "position": 1, "score": 75 }, { "speakerId": "s2", "position": 2, "score": 74 },
              { "speakerId": "s3", "position": 3, "score": 76 }, { "speakerId": "s1", "position": 4, "score": 37.5 }],
      "NEG": [{ "speakerId": "s4", "position": 1, "score": 73 }, { "speakerId": "s5", "position": 2, "score": 74 },
              { "speakerId": "s6", "position": 3, "score": 72 }, { "speakerId": "s4", "position": 4, "score": 36 }]
    },
    "ranks": { "AFF": 1, "NEG": 2 }
  },
  "confirmed": true
}
```

A change blocked by an overridable rule, retried with a reason (body of `PATCH /rounds/3`):

```json
{ "completed": true, "override": { "reason": "Debate 7 postponed to tomorrow" } }
```

### Write endpoints

All paths are below `/api/v1/tournaments/{slug}`.

| Tabbycat | CrabbyTab | Scope |
|---|---|---|
| tournament update | `PATCH` (name, short name, active) | write:tournament |
| preferences | `PATCH /preferences` (`{ preferences: {...} }`, partial; `null` restores a default) | write:tournament |
| feedback questions | `PUT /feedback-questions` (the full list, each with `sources`); `POST /feedback-questions`, `PATCH` / `DELETE /feedback-questions/{id}` | write:tournament |
| score criteria | `PUT /score-criteria` (the full list); `POST /score-criteria`, `PATCH` / `DELETE /score-criteria/{id}` (locked once ballots exist, as in the tab room) | write:tournament |
| schedule events | `POST /schedule-events`, `PATCH` / `DELETE /schedule-events/{id}` (validated like the schedule page) | write:tournament |
| speaker categories | `POST /speaker-categories`, `PATCH` / `DELETE /speaker-categories/{id}` | write:tournament |
| speaker category eligibility | `PUT /speaker-categories/{id}/eligibility` (`speakerIds`, replace); `PATCH` (add only) | write:participants |
| — | `POST /publish` (rebuild the public site) | write:tournament |
| rounds | `POST /rounds`, `PATCH` / `DELETE /rounds/{seq}` (release draw, reveal panels, release results, complete, cancel, ...) | write:rounds |
| motions | `POST /motions`, `PATCH` / `DELETE /motions/{id}` | write:rounds |
| institutions, teams, speakers, adjudicators | `POST` on the list, `PATCH` / `DELETE` on an item | write:participants |
| venues | `POST /venues`, `PATCH` / `DELETE /venues/{id}` | write:venues |
| venue categories | `POST /venue-categories`, `PATCH` (rename, members, display) / `DELETE /venue-categories/{name}` | write:venues |
| generate draw | `POST /rounds/{seq}/pairings/generate-draw` (`drawType`, `options`, `replaceExistingDraw`, `discardExistingResults`) | write:draws |
| pairings by hand | `POST /rounds/{seq}/pairings` (`teams` by side, `venueId`), `DELETE /rounds/{seq}/pairings/{id}`, `DELETE /rounds/{seq}/pairings` (the whole draw) | write:draws |
| — | `POST /rounds/{seq}/pairings/allocate-adjudicators` | write:draws |
| pairing update | `PATCH /rounds/{seq}/pairings/{id}` (teams/sides, venue, panel, priority) | write:draws |
| preformed panels | `PUT /rounds/{seq}/preformed-panels` (replace), `DELETE` (all); `POST` (one), `PATCH` / `DELETE .../preformed-panels/{id}`; `POST .../preformed-panels/from-anticipated-draw` (`prioritise`: `bracket` or `liveness`) | write:draws |
| ballots | `POST /rounds/{seq}/pairings/{id}/ballots`; `PATCH .../ballots/{ballotId}` (`action`: `confirm` or `discard`) | write:results |
| break categories | `POST /break-categories`, `PATCH` / `DELETE /break-categories/{id}` (incl. `teamOverrides`) | write:breaks |
| break eligibility | `PUT /break-categories/{id}/eligibility` (`teamIds`, replace); `PATCH` (add only) | write:breaks |
| generate break | `POST /break-categories/{id}/break`; `PATCH .../break` (`remarks`: team id -> remark or null, then regenerate); `DELETE .../break` (clear it; refused once its rounds have a draw) | write:breaks |
| availabilities | `PUT /rounds/{seq}/availabilities` (id -> available, per round, venues included); `PATCH` (toggle listed ids); `DELETE ?teams=true&adjudicators=true&venues=true` (mark every one of those kinds unavailable) | write:checkins |
| check-ins | `PUT` (check in) / `DELETE` (check out) / `PATCH` (toggle) / `POST` (identifier) on `/teams/{id}/checkin`, `/speakers/{id}/checkin`, `/adjudicators/{id}/checkin`, `/venues/{id}/checkin`, `/rounds/{seq}/pairings/{id}/checkin` (paper ballot received / withdrawn) | write:checkins |
| feedback | `POST /feedback`, `PATCH /feedback/{id}` (confirm, ignore), `DELETE /feedback/{id}` (soft delete, audited) | write:feedback |

**Generating a draw** follows Tabbycat: a round that already has a draw is refused with
`409 conflict` unless `replaceExistingDraw: true` is sent (before this, the endpoint always
regenerated; clients that relied on that must add the flag). `drawType` sets the round's draw type
(saved on the round); `options` override the tournament's draw preferences for this generation
only and are recorded in the draw's audit event (`requestedDrawOptions`). Options use CrabbyTab's
preference names: `pairingMethod`, `oddBracketMethod`, `conflictAvoidance` (Tabbycat's
`avoid_conflicts`), `pullupRestriction`, `sideAllocationRule` (only `balanced` / `random`, and only
when the tournament uses one of them), `avoidSameInstitution`, `avoidTeamHistory`,
`teamHistoryPenalty`, `teamInstitutionPenalty`, `sideBalancePenalty`, `pairingDeviationPenalty`,
`previouslySawPullupPenalty`, `pullupPenalty`, `maxTimesPerSide`, `maxAllowedSideImbalance`, and for
BP `bpPullupDistribution`, `bpPositionCost`, `bpAssignmentMethod`, `renyiOrder`,
`bpPositionCostExponent`.

**Hand-edited pairings** go through the draw editor's command: a team debates once per round
(409), elimination rounds take only qualified teams, a room must be available in the round and
free, a debate with ballots cannot lose its teams or be deleted, and changing a released or
completed round's matchups needs `override.reason`. Deleting a round's whole draw also sets its
draw status back to `none`.

**Availability** is per round for rooms too (`Venue.roundAvailability`; before this the API set the
room's tournament-wide default). Every change is recorded as a check-in event on the record, as on
the check-ins page.

Checks beyond the tab room's own: unknown body fields are rejected; team, venue and institution
names (and institution codes) are unique; references (institutions, break categories, speaker
categories, conflict targets, panel members, venues, rounds) must exist; a speaker with recorded
speeches cannot be removed; an adjudicator sits on one panel per round; a motion recorded on a
ballot cannot be deleted. Preferences keep their JSON type; feedback questions and speaker
categories are changed through their own endpoints.

## Firestore reads (Spark tier)

- Administrator list endpoints read one page; detail endpoints read one document (two for
  nested records). Standings, availabilities, speaker lookups and speaker-category eligibility
  read the tournament's teams, debates and confirmed ballots (proportional to the tournament) —
  use them sparingly on the free tier.
- Each authenticated request also reads the tournament (slug lookup) and the token.
- Anonymous requests read only the cached public view (no Firestore reads).
- Writes read what their command checks: single-record edits read the record (and what a
  uniqueness or reference check needs); status changes, deletions, draws, allocation, ballots
  and breaks read the tournament's rounds, debates and ballots (and teams, adjudicators or venues
  where a rule needs them), as the tab room holds them in memory. Each change costs two writes
  (record + archived version) plus one per audit event; a request needing more than 450 writes
  is refused (413).
- A token's `lastUsedAt` is written at most once an hour.

## Rate limits

300 requests per token per minute and 600 per client address per minute (per server instance: a
burst guard that costs no Firestore reads), 60 anonymous requests per client address per minute
(per instance), 1000 writes per token per hour (durable, shared across instances), 120 `/me`
attempts (including participant submissions) per client address per hour (durable).

## Implementation

- `session.ts` (diff-and-commit around a Firestore transaction), `tabRoom.ts` (the commands
  wired to a session), `ballotInput.ts` (ballot form entry -> submission), `routes/write/*`.
- `src/lib/api/v1/schema.ts`: schema DSL (validation and JSON Schema from one definition).
- `router.ts` (route type), `http.ts` (dispatch: authentication, scopes, limits, validation,
  error mapping), `data.ts` (administrator vs public data source, pagination),
  `store.ts` / `firestoreStore.ts` / `memoryStore.ts` (persistence port), `serializers.ts`
  (allow-listed output), `openapi.ts`, `routes/*`.
- `src/app/api/v1/[[...path]]/route.ts` serves every endpoint; `src/app/api/openapi.json/route.ts`
  the document; `src/app/tournaments/api/page.tsx` the reference page.
- Tests: `src/lib/api/v1/*.test.ts` with the fixture `src/test/apiFixture.ts` (a tournament built
  with the tab-room commands, served from the in-memory store and a real public projection).
