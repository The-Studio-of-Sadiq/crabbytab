# API and tokens

CrabbyTab has a REST API (v1) for one tournament at a time. It mirrors Tabbycat's v1 API (v2.12.1): reads of almost
everything the tab room holds, and writes that run through the same commands, rules and audit log as the tab room.
Use it to drive a projector display, a bot, a results feed or your own tooling.

This page is a summary. The full reference is
[docs/api.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/api.md). Every deployment also serves a
generated reference page at **`/tournaments/api`** and an OpenAPI 3.1 document at **`/api/openapi.json`**. Both are
generated from the same route definitions the server enforces.

## Creating a token

1. Open the account menu (top right) → **API access** (`/{slug}/api`). Only tournament administrators see it.
2. Under **Create token**, give the token a name (for example "Projector display").
3. Choose the **Access**:
   - **Public**: what the public site shows (`read:public`). It cannot be combined with other scopes.
   - **Administrator**: for each area, choose **None**, **Read** or **Read and write**. The scopes are listed
     under the table before you create the token.
4. Press **Create API token**. The token (`ct_live_…`) is shown **once**. Copy it then; only a SHA-256 hash is stored.
5. **Active tokens** lists each token with when it was created and last used. **Revoke** deletes it at once.

Tokens belong to one tournament. Treat them like passwords: keep them out of browser code, source control and URLs.

## Scopes

| Scope | Grants |
|---|---|
| `read:public` | Exactly the published, release-gated public view. |
| `read:<area>` | Administrator read access to one area, unreleased data included. |
| `write:<area>` | Read and write access to one area. |

| Area | Covers |
|---|---|
| `tournament` | Tournament, preferences, feedback questions, score scales and criteria, speaker categories, schedule events |
| `rounds` | Rounds and motions |
| `participants` | Institutions, teams, speakers, adjudicators |
| `venues` | Venues and venue categories |
| `breaks` | Break categories, eligibility and breaks |
| `draws` | Pairings, draw generation, adjudicator allocation, preformed panels |
| `results` | Ballots |
| `feedback` | Adjudicator feedback |
| `checkins` | Availability and check-ins |
| `standings` | Team, speaker, reply and adjudicator standings (read only) |
| `staff` | Staff permission groups (read only) |

No scope ever returns private URL keys, passcodes or email addresses. Staff access cannot be granted through a token:
only a signed-in administrator can do that on the Staff page (see [Staff and roles](Staff-and-Roles)). Tokens created
before per-area scopes (`read:public`, `read:draws`) keep working.

## Public reads without a token

Every endpoint a `read:public` token may use also answers requests with **no `Authorization` header**, as Tabbycat's
anonymous access does. Both see the same published public view:

- draws once released, panels once revealed, motions and results once released;
- team, speaker and reply standings, and the participant and institution lists, only once released (403 before);
- public tab limits apply as on the public page.

These reads come from the cached public snapshot, so they cost no Firestore reads. API writes, like tab-room changes,
reach public reads only when the tournament is **published** (see [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync)).
Anonymous requests are limited to 60 per client address per minute; use a `read:public` token for more.

## Participant keys (`/me`)

A participant can use the key and passcode from their private URL slip instead of a token:

```bash
curl -H "Authorization: Key team_abcd2345efgh" -H "X-Passcode: k3j9m2xx" \
  https://HOST/api/v1/tournaments/SLUG/me
```

The key can be a team's, an adjudicator's or a speaker's own private URL key (see
[Private URLs and portals](Private-URLs-and-Portals)). With it a participant can do what their portal does, under
the portal's own rules:

| Endpoint | What it does |
|---|---|
| `GET /me` | Who the key belongs to (a speaker's key identifies their team, with `speakerId`). |
| `GET /me/ballots`, `POST /me/ballots` | See the ballots the portal shows; a voting adjudicator submits a ballot (refused when private-URL ballots are off). |
| `GET /me/feedback`, `POST /me/feedback` | See and submit feedback along the tournament's feedback paths. |
| `PUT /me/checkin` | Self check-in for the current round, when self check-in is on. |

Unknown keys and wrong passcodes get the same 401. Attempts are limited to 120 per client address per hour. Ballot
receipts are not emailed for API submissions.

## Main endpoints

All paths are below `/api/v1/tournaments/{slug}`. Rounds are addressed by sequence number (`/rounds/3`), everything
else by id.

| Area | Read | Write |
|---|---|---|
| Tournament | `/`, `/preferences`, `/feedback-questions`, `/score-criteria`, `/schedule-events`, `/speaker-categories` | `PATCH`, `PATCH /preferences`, `POST /publish` |
| Rounds | `/rounds`, `/motions` | create, update (release draw, reveal panels, release results, complete), delete |
| Participants | `/institutions`, `/teams`, `/speakers`, `/adjudicators` | create, update, delete |
| Venues | `/venues`, `/venue-categories` | create, update, delete |
| Draws | `/rounds/{seq}/pairings`, `/rounds/{seq}/preformed-panels` | `generate-draw`, `allocate-adjudicators`, hand-made pairings, pairing edits, preformed panels |
| Results | `/rounds/{seq}/ballots`, `/rounds/{seq}/pairings/{id}/ballots` | submit, confirm, discard, unconfirm |
| Breaks | `/break-categories[/{id}/eligibility or /break]` | categories, eligibility, generate or clear a break |
| Check-ins | `/rounds/{seq}/availabilities`, `…/checkin` | availability, check in or out |
| Feedback | `/feedback` | submit, confirm, ignore, delete |
| Standings | `/teams/standings`, `/speakers/standings`, `/speakers/standings/replies`, `/adjudicators/standings` | — |

Standings take `?round=N` (standings after round N), `?category=` (a break or speaker category) and `?metrics=a,b,c`
(rank by those metrics for this request). Metrics with no data yet are `null`, never 0, as in Tabbycat.

Large lists are paginated with `limit` (1–200, default 50) and `cursor`, and return `{ "data": [...], "nextCursor" }`.

## How writes behave

- **Same rules as the tab room.** A write runs a tab-room command in one Firestore transaction; a refused write
  changes nothing. A rule violation is `409 rule_violation` with `violations[]`. If every violation is overridable,
  repeat the request with `"override": { "reason": "..." }`; the reason is recorded in the audit log. Hard rules
  cannot be overridden.
- **Versions.** Each changed record gets the next `syncVersion` and the replaced version is archived. Send
  `expectedVersion` on a `PATCH` to get `409 conflict` instead of overwriting a concurrent change. Deletions are soft.
- **Regenerating a draw.** `POST /rounds/{seq}/pairings/generate-draw` on a round that already has a draw is refused
  with `409 conflict` unless you send `"replaceExistingDraw": true`, as in Tabbycat. Earlier versions always
  regenerated; clients that relied on that must add the flag.
- **Double entry.** With double entry on (see [Ballots and results](Ballots-and-Results)), a token counts as one
  person: it cannot confirm a ballot it entered without an override. A blind check (`checksVersion: N`) that differs
  from version N is refused with `409 conflict` and a `differences[]` list; confirm version N instead, or resend with
  `"acceptDifferences": true`.
- **Ballots** are sent as the ballot form records them; points, wins, margins and voting majorities are computed by
  the server, never accepted from the client.
- **Audit.** Each write is recorded with `actorId: "api-token:<id>"`, the token name and the request id. See
  [Audit log](Audit-Log).
- **Other devices.** Ballots, debates, teams and adjudicators reach open admin devices live; other changes arrive on
  their next download.

Unknown query parameters and body fields are rejected with 422, so typos are never ignored.

## Limits and errors

| Limit | Value |
|---|---|
| Requests per token | 300 per minute (per server instance) |
| Requests per client address | 600 per minute (per server instance) |
| Anonymous requests | 60 per client address per minute (per server instance) |
| Writes per token | 1000 per hour (shared across instances) |
| `/me` attempts | 120 per client address per hour (shared across instances) |
| Writes per request | 450 Firestore writes, else `413` |

Errors are `{ "error": { "code", "message", ... } }` with codes `bad_request` (400), `unauthenticated` (401),
`forbidden` (403), `not_found` (404), `method_not_allowed` (405), `conflict` / `rule_violation` (409),
`payload_too_large` (413), `validation_failed` (422), `rate_limited` (429, with `Retry-After`) and `internal` (500).

On the free Spark plan, standings and availability reads load the tournament's teams, debates and ballots; use them
sparingly. Public and anonymous reads cost nothing.

## Differences from Tabbycat

- Not mapped: site-wide users and global institutions, web-push registration, Tabbycat's generic `/questions`, and
  listing, creating or deleting tournaments (a token belongs to one tournament).
- Staff and group membership cannot be written through a token.
- Anonymous ballot and feedback creation is through the public forms, not the API.
- Speakers check in with their team; a debate's check-in is its paper-ballot receipt.
- A pairing's importance uses CrabbyTab's 0–10 scale, so Tabbycat's negative levels are refused.
- Ids are strings; standings use CrabbyTab's configured precedence.
- Serializers do not yet carry team references, pronouns or last names.

## Details

- Implementation: `src/lib/api/v1/` (route definitions in `routes/`, dispatch in `http.ts`, writes in `session.ts`
  and `tabRoom.ts`); every endpoint is served by `src/app/api/v1/[[...path]]/route.ts`.
- `GET /draws` is the first v1 endpoint, kept with its original response shape for existing clients.
- Every response has `Cache-Control: no-store` and an `X-Request-Id` header.
- A token's "last used" time is written at most once an hour.
