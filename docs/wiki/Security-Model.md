# Security model

Who can read and write what, and where that is enforced. This page is for contributors and people deploying CrabbyTab. Report vulnerabilities privately as described in [SECURITY.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/SECURITY.md).

There are two enforcement points:

- **`firestore.rules`** for everything the browser reads or writes directly with the Firebase client SDK.
- **Server routes** (`src/app/api/**`) for everything else. They use the Firebase Admin SDK, which ignores the rules, so each route checks the caller itself.

Hiding a link in the UI is never the barrier.

## Identities

| Identity | How it is recognised | Notes |
| --- | --- | --- |
| Global administrator | `globalAdmin` custom claim on the Firebase account | The claim is set from the `FIREBASE_ADMIN_UIDS` environment variable by `GET /api/auth/access` (`src/lib/globalAdmin.ts`). Server routes check the environment variable directly; Firestore rules trust the claim. |
| Tournament administrator | Tournament `ownerId`, an `admins` map entry set to `true`, or `staff/{uid}.role == "admin"` | Global administrators count as administrators of every tournament. |
| Data-entry staff | `staff/{uid}.role == "dataEntry"` | Limited by permission groups and the tournament's access level. See [Staff and roles](Staff-and-Roles). |
| Participant | Private URL key + passcode | No account. |
| Public visitor | None | Sees only the published snapshot. |
| Integration | Bearer API token | Hashed, scoped, revocable. See [API and tokens](API-and-Tokens). |

Accounts are Firebase email/password accounts. The app has no self-sign-up page; staff accounts can be created by accepting a staff invitation (`/api/invitations`).

## Firestore rules

Read [`firestore.rules`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/firestore.rules) itself before changing any client read or write.

| Path | Read | Write |
| --- | --- | --- |
| `tournaments/{id}` | Administrators and data-entry staff | Create: global admins only. Update: administrators, who cannot change `ownerId`; only the owner (or a global admin) may change `admins`. Delete: administrators. |
| `tournaments/{id}/{collection}/{doc}` (any collection not listed below: rounds, teams, adjudicators, debates, ballots, feedback, motions, venues, ... ) | Administrators | Administrators |
| `.../ballots/{id}` | — | Also: data-entry staff may **create** their own unconfirmed, undiscarded ballot (`submitterType "tabroom"`, own uid, whitelisted fields, `syncVersion` 1, existing non-deleted debate of the same round), with `results.enter` |
| `.../teams/{id}`, `.../adjudicators/{id}` | — | Also: data-entry staff may **update** only check-in fields (`checkedIn`, `checkedInAt`, `roundAvailability`, `roundAvailabilityAt`, `checkInHistory` ≤ 50, `syncVersion` +1) on non-deleted records, with `checkins.edit` |
| `.../staff/{uid}` | Administrators | Administrators |
| `.../syncConflicts/{id}` | Administrators | Create only; never update or delete |
| `.../auditEvents/{id}` | Administrators | Create only, attributed to the writer or to `system`; never update or delete |
| `.../auditReleases/**` | Nobody | Nobody (server only) |
| `.../serverOnly/**` | Nobody | Nobody (server only) |
| `.../data/{doc}` | Administrators | Administrators |
| `tournamentSlugs/{slug}` | Any signed-in user | Global admins, or the owner / `admins`-map administrator of the tournament the slug points to (checked against the post-write tournament) |
| `users/{uid}` | That user | That user |
| `publicViews/**` | Nobody | Nobody (server only) |
| Anything else (including top-level `apiRateLimits`) | Global admins | Global admins |

Notes:

- Data-entry staff never read tournament subcollections directly. Their copy comes redacted from `/api/tournaments/{id}/assistant-data` (no private URL keys, passcodes, emails, phone numbers; conflicts and scores only with the right permission). Their direct writes also require `assistantMay(...)`: the permission is in their staff document's `permissions` list (missing list = the default set) and the tournament's `assistantAccess` is not `"none"`.
- Firestore combines rules with OR. Global admins match the final catch-all, so append-only rules do not bind them.
- The tournament catch-all matches one level only. Deeper paths (for example `auditReleases/{id}/events`) fall through to the global-admin rule.
- `staff` documents with `role: "admin"` make someone an administrator, and any administrator may write `staff`. So "only the owner may change `admins`" protects the `admins` map, not the set of administrators as a whole. The staff route also lets any administrator assign the admin role.
- **Server-written collections under the admin catch-all.** `apiTokens`, `emailCampaigns` and `notificationLog` are written by server routes, but they are not excluded from the catch-all, so tournament administrators can also read and write them directly from the browser. In practice: administrators can read API token records (name, scopes, creator, timestamps and the SHA-256 `tokenHash`; the secret is never stored), create or edit token records directly, edit or delete email history, and edit or delete notification log entries (which could make an automatic notification send again or not at all). Administrators already have full control of the tournament, so this grants no new access, but these records are not tamper-proof against administrators.
- There is no rules emulator in CI. `src/lib/serverOnlyRules.test.ts` and `src/lib/liveRules.test.ts` check the rules **text** (the `serverOnly` exclusion and deny rule; the staff field lists match `src/lib/dataEntrySync.ts`). Test rule changes in the Firebase console Rules Playground before deploying. See [`docs/live-collaboration.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/live-collaboration.md#firestore-rules) for the checklist.

Never loosen the rules to work around a bug.

## Server-only documents

`tournaments/{id}/serverOnly/**` is denied to every client and only touched by server routes:

| Document | Contents |
| --- | --- |
| `staffInvitations/items/*` | Staff invitations (token stored as a hash; administrators never see it) |
| `staffPermissionGroups` | Custom permission groups |
| `emailSettings` | Reply-To and saved email templates |
| `publicForms` | Public-form password as a salted scrypt hash (`src/lib/publicFormsPassword.ts`) |
| Registration settings, submissions, representatives, team invitations, transfers | Registration (`src/lib/registration/`); link tokens stored as hashes |

Also server-only: `auditReleases` (released audit snapshots), `publicViews` (public snapshots) and the top-level `apiRateLimits`.

## Server routes

- **Administrator routes** verify the Firebase ID token and resolve the role with `authorizeTournamentAdministrator` (`src/lib/tournamentAdminAuth.ts`); some re-check inside the write (`assertStillAdministrator`).
- **Staff routes** (`assistant-data`, `data-entry-sync`, `assistant-ballots`) use `authorizeDataEntryStaff` and re-read the staff document inside each write transaction (`currentDataEntryPermissions` in `src/lib/staffAccessServer.ts`), so revoking a group applies to the next record. Synced records are whitelisted per field (`DATA_ENTRY_FIELDS` in `src/lib/dataEntrySync.ts`); staff ballots are always unconfirmed; guarded fields (conflicts, scores, panels) are accepted only with the matching permission and from a copy based on the current `syncVersion`. Nobody confirms their own ballot.
- **Private portals** (`/api/private/team`, `/api/private/sync`) find the participant by private URL key and compare the passcode in constant time. Teams cannot submit ballots; adjudicators only for their own debates; feedback only between people who sat in that debate.
- **Email delivery webhook** (`/api/email/webhook`) requires an HMAC signature with `EMAIL_WEBHOOK_SECRET` and is disabled without it.
- **Payload caps**, for example: data-entry sync 4 MB and 5,000 records per collection; private sync 100 queued items; public forms 64 KB.

## Staff permissions

Permissions (`src/lib/staffPermissions.ts`): `results.enter`, `results.confirm_others`, `ballots.intake`, `feedback.enter`, `checkins.edit`, `participants.edit`, `draw.display`, `motions.display`, `conflicts.view`, `conflicts.edit`, `feedback.view`, `adjudicators.scores_edit`, `allocation.edit`, `standings.view`.

- Built-in groups: Tabulation assistant (default), Ballot desk, Check-in desk, Feedback desk, Equity, Adjudication core. Administrators can add up to 30 custom groups (stored server-only; `PUT /api/tournaments/{id}/staff/groups` validates them and recomputes every staff member's stored `permissions` in one transaction).
- The tournament's access level (`assistantAccess`: all areas, results and draw display, results only, none) caps every group. `none` refuses every staff route and the two direct rule-based writes.
- Staff documents created before groups existed have no `permissions` field and keep the default set.

Details: [`docs/staff-access.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/staff-access.md).

## Passcodes and secrets

| Secret | Stored as | Compared by |
| --- | --- | --- |
| Participant private URL key and passcode (`privateUrlKey`, `privatePasscode`) | **Plain text** on team / adjudicator records (administrators can read them; printed on slips) | `passcodesMatch` (`src/lib/passcode.ts`): both values SHA-256 hashed, then `timingSafeEqual`, so timing reveals neither length nor prefix |
| API token (`ct_live_` + 64 hex) | SHA-256 hash (`tokenHash`), shown once at creation | Hash lookup (`src/lib/apiTokens.ts`) |
| Staff invitation, registration links | Hashes in `serverOnly` | Server-side |
| Public-form password | Salted scrypt hash in `serverOnly/publicForms` | `timingSafeEqual` |
| Service account, SMTP password, webhook secret | Server environment variables only | — |

Participant devices remember portal passcodes in localStorage.

## Rate limits

Durable limits are sliding one-hour windows stored in the top-level `apiRateLimits` collection, keyed by a SHA-256 hash of the identity (`src/lib/privateTeamRateLimit.ts`). Client addresses come from `x-real-ip` / `x-forwarded-for`, which Vercel sets.

| Where | Limit |
| --- | --- |
| Private portals, per private link (`team`, `sync`) | 300 requests / hour |
| Private portals, failed attempts (unknown key or wrong passcode) per address | 100 / hour; checked before the key lookup |
| Staff invitations | 30 failed tokens and 10 new accounts per address per hour |
| Public forms | 30 failed passwords per address per hour; 240 submissions per address and 6,000 per tournament per hour |
| Public registration | 30 failed links per address; 40 per address per tournament, 60 per address, 600 per tournament per hour |
| v1 API (`src/lib/api/v1/rateLimit.ts`) | 600 requests/min per address, 60 anonymous/min per address, 300/min per token (in memory, per server instance); 1,000 writes/hour per token and 120 `/me` lookups/hour per address (durable) |

The in-memory API limits are a burst guard per serverless instance, not a global quota.

## API tokens

Created and revoked only through `/api/tournaments/{id}/api-tokens` (administrators). Scopes (`src/lib/apiScopes.ts`):

- `read:public` — only what the public site shows. Cannot be combined with other scopes.
- `read:{resource}` and `write:{resource}` for `tournament`, `rounds`, `participants`, `venues`, `breaks`, `draws`, `results`, `feedback`, `checkins`; `read:standings` and `read:staff` only. `write` implies `read`. No token can grant staff access.

Tokens stay valid until revoked, including after the administrator who created them loses access. See the note above on direct browser access to `apiTokens`.

## What is public

Only the **public projection** (`src/lib/publicView/projection.ts`), built on the server at publish time. It copies an allowlist of fields per collection and applies the release settings:

| Published (when released / switched on) | Never published |
| --- | --- |
| Tournament name, slug, format, preferences (minus private speaker categories; schedule only when released; room category descriptions only when marked public) | Owner, admin list, owner email |
| Rounds that are visible (draw released, results released, or in a released tab), with their status flags | Unreleased or locked draws, cancelled rounds |
| Debates of visible rounds: teams, sides, room, bracket; panels only once revealed; points and speaker totals only with released results | Unrevealed panels, results of silent or unreleased rounds |
| Confirmed ballots of rounds with public results; speaker scores only when team speaks are released; per-adjudicator sheets and split adjudicators only when switched on and the panel is revealed | Unconfirmed or discarded ballots |
| Teams that appear publicly (in a public debate, a released break, released participants list or side allocations): name or code name, speakers, institution and emoji if switched on, public speaker categories | Private URL keys, passcodes, emails, phone numbers, private speaker categories, conflicts |
| Adjudicators on revealed panels or released lists: name, institution if switched on, trainee / core / breaking flags only when that list is released | Base and test scores, feedback, score history, conflicts |
| Released motions; info slides of rounds with released info slides | Unreleased motions |
| Break categories; the generated break only when released | Break overrides, unreleased breaks |
| Institutions only when their list is released; rooms (name, category, capacity, accessibility, http(s) links) | — |
| Aggregates computed on the server: tabs with top-N limits, adjudicator tab, diversity, feedback progress (feedback is read only when one of these is on) | Raw feedback (the `feedback` collection is always empty) |

See [Public pages and releases](Public-Pages-and-Releases).

## Browser and headers

- `securityHeaders.mjs` (applied to every path by `next.config.mjs`) sets a Content-Security-Policy (`default-src 'self'`; connections only to self and Firebase endpoints; `frame-ancestors 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`; `script-src` allows `'unsafe-inline'` for Next.js bootstrap scripts, plus `'unsafe-eval'` in development), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy` that disables camera, microphone and geolocation. `src/lib/securityHeaders.test.ts` covers it.
- The organiser's working copy in IndexedDB holds everything an administrator can see, including passcodes and feedback. Use trusted devices and clear site data on shared computers.
- Signed-out viewers are never treated as administrators.

## Untrusted input

CSV and DebateXML files are parsed as data only. DebateXML with DOCTYPE or entity declarations is refused and record counts are capped. CSV exports escape formula-like cells. Room links are published only if they are http(s).

## Known gaps

- Participant passcodes and private URL keys are stored in plain text (administrators can read them).
- `apiTokens`, `emailCampaigns` and `notificationLog` are writable by administrators from the browser (see above).
- Firestore rules are not executed in CI (text checks only).
- State rules (locked ballots, completed rounds) are checked on the device for administrators' live writes, not by the rules.
- `script-src` allows inline scripts.

## Related pages

[Architecture](Architecture) · [Data model](Data-Model) · [Staff and roles](Staff-and-Roles) · [API and tokens](API-and-Tokens) · [Private URLs and portals](Private-URLs-and-Portals)
