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

Areas: `tournament` (tournament, preferences, feedback questions, score scales, speaker
categories), `rounds` (rounds, motions), `participants` (institutions, teams, speakers,
adjudicators), `venues`, `breaks`, `draws` (pairings, preformed panels), `results` (ballots),
`feedback`, `checkins` (availability, check-ins), `standings` (read only).

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

### `/me` for participants

`GET /api/v1/tournaments/{slug}/me` identifies a participant from their private URL slip:

```bash
curl -H "Authorization: Key team_abcd2345efgh" -H "X-Passcode: k3j9m2xx" \
  https://HOST/api/v1/tournaments/SLUG/me
```

Unknown keys and wrong passcodes get the same 401, and attempts are limited to 120 per client
address per hour (durable limiter).

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
| feedback questions | `/feedback-questions` | tournament |
| score criteria | `/score-criteria` (score scales; criteria when configured) | tournament |
| speaker categories (+eligibility) | `/speaker-categories[/{id}[/eligibility]]` | tournament / public; eligibility: participants |
| rounds | `/rounds[/{roundSeq}]` | rounds / public |
| motions | `/motions[/{id}]` (`?roundId=`) | rounds / public |
| institutions | `/institutions[/{id}]` | participants / public* |
| teams | `/teams[/{id}]` (`?institutionId=`) | participants / public* |
| speakers | `/speakers[/{id}]` | participants / public* |
| adjudicators | `/adjudicators[/{id}]` (`?institutionId=`) | participants / public* |
| venues, venue categories | `/venues[/{id}]` (`?category=`), `/venue-categories` | venues / public |
| break categories, eligibility, break | `/break-categories[/{id}[/eligibility or /break]]` | breaks / public (break once released) |
| pairings | `/rounds/{seq}/pairings[/{debateId}]` | draws / public |
| preformed panels | `/rounds/{seq}/preformed-panels` | draws |
| ballots | `/rounds/{seq}/ballots` (`?confirmed=`), `/rounds/{seq}/pairings/{id}/ballots[/{ballotId}]` | results |
| availabilities | `/rounds/{seq}/availabilities` | checkins |
| check-ins | `/teams/{id}/checkin`, `/speakers/{id}/checkin`, `/adjudicators/{id}/checkin`, `/venues/{id}/checkin`, `/rounds/{seq}/pairings/{id}/checkin` | checkins |
| feedback | `/feedback[/{id}]` (`?roundId=`, `?targetAdjudicatorId=` or `?sourceId=`) | feedback |
| team standings, by round | `/teams/standings[/rounds]` (`?round=`) | standings / public* |
| speaker standings, replies, by round | `/speakers/standings[/replies or /rounds]` (`?round=`) | standings / public* |
| adjudicator standings | `/adjudicators/standings` | standings + feedback |
| me | `/me` | private URL key + passcode |
| — | `/draws` (the first v1 endpoint, legacy shape) | draws / public |

\* public only once released. Not mapped: Tabbycat's user groups, users, global institutions,
schedule events and web-push registration (CrabbyTab has no such models yet).

Differences from Tabbycat: speakers check in with their team (CrabbyTab checks teams in); a
debate's check-in is its paper-ballot receipts (`ballotIntake`); venue categories are derived
from the venues' `category` values; ids are strings; standings are computed with CrabbyTab's
configured precedence (`docs/standings-and-breaks.md`).

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
| feedback questions | `PUT /feedback-questions` (the full list, each with `sources`) | write:tournament |
| speaker categories | `POST /speaker-categories`, `PATCH` / `DELETE /speaker-categories/{id}` | write:tournament |
| speaker category eligibility | `PUT /speaker-categories/{id}/eligibility` (`speakerIds`) | write:participants |
| — | `POST /publish` (rebuild the public site) | write:tournament |
| rounds | `POST /rounds`, `PATCH` / `DELETE /rounds/{seq}` (release draw, reveal panels, release results, complete, cancel, ...) | write:rounds |
| motions | `POST /motions`, `PATCH` / `DELETE /motions/{id}` | write:rounds |
| institutions, teams, speakers, adjudicators | `POST` on the list, `PATCH` / `DELETE` on an item | write:participants |
| venues | `POST /venues`, `PATCH` / `DELETE /venues/{id}` | write:venues |
| generate draw | `POST /rounds/{seq}/pairings/generate-draw` | write:draws |
| — | `POST /rounds/{seq}/pairings/allocate-adjudicators` | write:draws |
| pairing update | `PATCH /rounds/{seq}/pairings/{id}` (venue, panel, priority) | write:draws |
| preformed panels | `PUT /rounds/{seq}/preformed-panels` | write:draws |
| ballots | `POST /rounds/{seq}/pairings/{id}/ballots`; `PATCH .../ballots/{ballotId}` (`action`: `confirm` or `discard`) | write:results |
| break categories | `POST /break-categories`, `PATCH` / `DELETE /break-categories/{id}` (incl. `teamOverrides`) | write:breaks |
| break eligibility | `PUT /break-categories/{id}/eligibility` (`teamIds`) | write:breaks |
| generate break | `POST /break-categories/{id}/break` | write:breaks |
| availabilities | `PUT /rounds/{seq}/availabilities` (id -> available for teams, adjudicators, venues) | write:checkins |
| check-ins | `PUT` (check in) / `DELETE` (check out) on `/teams/{id}/checkin`, `/speakers/{id}/checkin`, `/adjudicators/{id}/checkin`, `/venues/{id}/checkin`; `PUT /rounds/{seq}/pairings/{id}/checkin` (paper ballot received) | write:checkins |
| feedback | `POST /feedback`, `PATCH /feedback/{id}` (confirm, ignore) | write:feedback |

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
- Writes read what their command checks: single-record edits read the record (and what a
  uniqueness or reference check needs); status changes, deletions, draws, allocation, ballots
  and breaks read the tournament's rounds, debates and ballots (and teams, adjudicators or venues
  where a rule needs them), as the tab room holds them in memory. Each change costs two writes
  (record + archived version) plus one per audit event; a request needing more than 450 writes
  is refused (413).
- A token's `lastUsedAt` is written at most once an hour.

## Rate limits

300 requests per token per minute and 600 per client address per minute (per server instance: a
burst guard that costs no Firestore reads), 1000 writes per token per hour (durable, shared
across instances), 120 `/me` attempts per client address per hour (durable).

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
