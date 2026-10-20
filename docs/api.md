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

## Firestore reads (Spark tier)

- Administrator list endpoints read one page; detail endpoints read one document (two for
  nested records). Standings, availabilities, speaker lookups and speaker-category eligibility
  read the tournament's teams, debates and confirmed ballots (proportional to the tournament) —
  use them sparingly on the free tier.
- Each authenticated request also reads the tournament (slug lookup) and the token.
- A token's `lastUsedAt` is written at most once an hour.

## Rate limits

300 requests per token per minute and 600 per client address per minute (per server instance: a
burst guard that costs no Firestore reads), 1000 writes per token per hour (durable, shared
across instances), 120 `/me` attempts per client address per hour (durable).

## Implementation

- `src/lib/api/v1/schema.ts`: schema DSL (validation and JSON Schema from one definition).
- `router.ts` (route type), `http.ts` (dispatch: authentication, scopes, limits, validation,
  error mapping), `data.ts` (administrator vs public data source, pagination),
  `store.ts` / `firestoreStore.ts` / `memoryStore.ts` (persistence port), `serializers.ts`
  (allow-listed output), `openapi.ts`, `routes/*`.
- `src/app/api/v1/[[...path]]/route.ts` serves every endpoint; `src/app/api/openapi.json/route.ts`
  the document; `src/app/tournaments/api/page.tsx` the reference page.
- Tests: `src/lib/api/v1/*.test.ts` with the fixture `src/test/apiFixture.ts` (a tournament built
  with the tab-room commands, served from the in-memory store and a real public projection).
