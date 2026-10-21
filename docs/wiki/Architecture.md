# Architecture

CrabbyTab is a Next.js 15 (App Router) + React 19 + TypeScript application with Tailwind CSS, Firebase Authentication and Cloud Firestore, deployed on Vercel. This page is for contributors. Read [`AGENTS.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/AGENTS.md) for the engineering rules.

## Principles

- **Local-first.** Draws, allocation, standings, breaks and validation are pure TypeScript functions that run in the organiser's browser. No paid compute service is involved.
- **Deterministic and testable.** Randomness goes through one seeded source (`src/lib/draw/rng.ts`). Domain logic is unit-tested without Firebase.
- **Least privilege.** Browsers talk to Firestore directly only as tournament administrators (plus two narrow direct writes for data-entry staff). Participants, most staff work, the public site and integrations go through server routes that use the Firebase Admin SDK. See [Security model](Security-Model).
- **Cheap reads.** The public site is served from a snapshot built at publish time and cached, never from live collections (Spark tier: 50k reads/day). See [Caching, indexing and performance](Caching-Indexing-and-Performance).

## How data moves

```
Organiser device                          Firestore                        Vercel server
-------------------                       ---------                        -------------
IndexedDB working copy  --upload/download-->  tournaments/{id}/...  <--Admin SDK--  /api/** routes
TournamentContext       <==live listeners==>  (ballots, debates,                    |
(pure libs compute)                            teams, adjudicators)                 v
                                                                    publicViews/{slug} (snapshot)
                                                                                    |
Public pages / portals  <---------------- cached JSON from /api/public/** ---------+
```

### 1. The working copy (IndexedDB)

Each tournament's working copy lives on the device in IndexedDB (database `crabbytab`, store `kv`), under keys `crabbytab_t_{slug}_{suffix}` (`meta`, `rounds`, `teams`, `debates`, `ballots`, `feedback`, `auditEvents`, `syncBaseline`, ...), each a JSON string.

- `src/lib/offline/localStore.ts` is the only code that touches it. `TournamentContext` loads one tournament's keys into memory when it opens, reads and writes synchronously, and flushes coalesced writes to IndexedDB in one transaction a moment later. A failed flush (quota, blocked storage) shows an alert and is retried with the next change.
- Older working copies in localStorage are migrated to IndexedDB on first use. If IndexedDB is unavailable the same store falls back to localStorage (about 5 MB).
- Theme, language and remembered portal passcodes stay in localStorage.
- `public/sw.js` is a service worker that caches the app shell and static chunks, so the app reopens offline. `src/lib/offline/chunkRecovery.ts` reloads once when a deploy has removed a chunk the page asks for.
- Draw generation and auto-allocation can run in a Web Worker (`src/features/tournament/compute/`), so large draws do not freeze the page and can be cancelled.

A tournament that has never been uploaded is local-only: nothing leaves the device.

### 2. Cloud sync (upload / download)

For collections that are not live (settings, rounds, motions, venues, break categories, feedback, institutions, audit events), the organiser syncs explicitly with **Upload** and **Download and compare** (`src/features/tournament/application/cloudSync.ts`, `infrastructure/tournamentRepository.ts`).

- Every cloud record has a `syncVersion`. The device keeps a **sync baseline** (version and content hash of each record at its last sync) and uploads only records changed since then.
- Uploads run in transactions of up to 150 records. A record whose cloud copy is newer, or soft-deleted, is refused and archived in `syncConflicts`; the replaced version of an overwritten record is archived too. The **Resolve sync conflicts** dialog lets the organiser choose.
- Audit events are append-only and created in plain batches.
- Automatic per-action cloud writes exist in `TournamentContext` but are switched off (`AUTOMATIC_CLOUD_WRITES = false`).

Details: [`docs/storage-and-scale.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/storage-and-scale.md) and [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).

### 3. Live collaboration

For cloud tournaments on administrator devices, `ballots`, `debates`, `teams` and `adjudicators` are **live**: written to Firestore record by record as they change and received from other devices within seconds.

- Writes: `saveLiveRecords` → `planLiveWrites` (`application/liveSync.ts`) diffs what a command changed and writes field-level patches (`set` with `mergeFields`), one atomic `writeBatch` per command, bumping `syncVersion`.
- Listeners: `createLiveSession` (`application/liveSession.ts`, adapter `infrastructure/liveRepository.ts`) listens to whole `teams` and `adjudicators` collections and to `debates` and `ballots` of the active round only.
- Offline: the Firestore SDK's persistent cache (IndexedDB, `src/lib/firebase.ts`) queues writes across reloads. Uploads and publishes wait up to 20 s for queued live writes to be acknowledged.
- Conflicts: incoming changes use the same baseline rule as a download; a locally edited record that the cloud also changed becomes a sync conflict. Two devices confirming different ballot versions of one debate is detected (`findConfirmationConflicts`) and shown, never resolved automatically.
- Live updates can be paused per device from the cloud status menu.

Data-entry staff are not live. They read a redacted copy from `/api/tournaments/{id}/assistant-data` and send changes through `/api/tournaments/{id}/data-entry-sync`, which whitelists fields and checks permissions per record (`src/lib/dataEntrySync.ts`).

Participants never touch the working copy. Private portals call `/api/private/team` (read) and `/api/private/sync` (queued ballots, feedback, check-ins; `src/lib/privateSync.ts`). Debates in Firestore carry a cloud-only `participantIds` index so portals query only their own debates.

Details: [`docs/live-collaboration.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/live-collaboration.md).

### 4. Publishing the public site

The public site is a **snapshot built at publish time**, not a view of live data.

1. After an upload or a release, the browser calls `POST /api/tournaments/{id}/public-view` (`application/publicView.ts`).
2. The server reads the cloud collections and builds the **public projection** (`src/lib/publicView/projection.ts`): an allowlist of fields, filtered by release settings. Tabs with top-N limits and other aggregates are computed here (`derived.ts`).
3. `snapshot.ts` splits it into sections: base sections (`tournament`, `rounds`, `teams`, ...) and one `round-{id}` section per public round. Each is content-hashed and chunked (≤700 KB per document) under `publicViews/{slug}`.
4. `store.ts` invalidates only the changed sections' cache tags (`revalidateTag`). Reads go through `unstable_cache` (Vercel Data Cache) with short CDN caching; a round fetched with its current hash is cached for a day.
5. Public pages fetch `/api/public/tournaments/{slug}` (and `/version` to poll for a new publish). Public layouts render metadata server-side (`publicView/robots.ts`, `seo.ts`); the pages themselves are client components.

Details: [`docs/public-pages-and-notifications.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/public-pages-and-notifications.md), [Public pages and releases](Public-Pages-and-Releases).

## Server routes

All server routes live in `src/app/api/**` and use the Admin SDK from `src/lib/firebaseAdmin.ts` (credentials from `FIREBASE_SERVICE_ACCOUNT_JSON` or application default credentials). The Admin SDK bypasses Firestore rules, so every route authorises the caller itself:

| Route group | Purpose | Caller check |
| --- | --- | --- |
| `/api/auth/access` | Sync the `globalAdmin` claim | Firebase ID token |
| `/api/tournaments`, `/lookup` | Tournaments for the user | ID token |
| `/api/tournaments/{id}/access` | Caller's role | ID token |
| `/api/tournaments/{id}/staff`, `/staff/groups`, `/staff/invitations` | Staff, permission groups, invitations | Administrator |
| `/api/tournaments/{id}/assistant-data`, `/data-entry-sync`, `/assistant-ballots` | Data-entry staff read, write, confirm | Data-entry staff with the right permission |
| `/api/tournaments/{id}/public-view` | Publish the public snapshot | Administrator |
| `/api/tournaments/{id}/notifications`, `/email/settings`, `/api/email/*` | Email and automatic notifications | Administrator (`/api/email/webhook`: provider) |
| `/api/tournaments/{id}/api-tokens` | Manage API tokens | Administrator |
| `/api/tournaments/{id}/audit/release` | Release the audit log | Administrator |
| `/api/tournaments/{id}/registration/**`, `/public-forms` | Registration and public-form settings | Administrator |
| `/api/invitations` | Accept a staff invitation | Invitation token, rate-limited |
| `/api/private/team`, `/api/private/sync` | Private portals | Private key + passcode, rate-limited |
| `/api/public/tournaments/{slug}` (+ `/version`, `/checkins`, `/audit`, `/schedule`, `/schedule/ical`), `/api/public/motions` | Public data | None (cached) |
| `/api/public/tournaments/{slug}/forms`, `/registration` | Public ballot/feedback forms, registration | Optional password or link, rate-limited |
| `/api/v1/**` | Integration API | Bearer API token |
| `/api/openapi.json` | API description | None |

Administrator routes use `authorizeTournamentAdministrator` (`src/lib/tournamentAdminAuth.ts`); staff routes use `authorizeDataEntryStaff` (`src/lib/staffAccessServer.ts`). See [API and tokens](API-and-Tokens).

## Pages (App Router)

- `src/app/[tournamentSlug]/` — one tournament. The layout wraps pages in `TournamentProvider` and the tournament chrome (sidebar). Staff pages: `draw`, `allocation`, `results`, `standings`, `break`, `feedback`, `checkins`, `imports`, `exports`, `config`, `schedule`, `registration`, `email`, `private-urls`, `staff`, `api`, `audit`, `analytics`, `rehearsal`, `print`, `display`. Participant and public pages: `public/**`, `private/{team,adjudicator,speaker}`, `team/[teamId]`, and public sub-routes such as `audit/public`, `checkins/public`, `schedule/public`.
- `src/app/tournaments/` — hub, setup wizard (`new`), import, demo, motions bank, API reference.
- `src/app/register/[slug]`, `invite`, `account`, `login`, `forgot-password`.
- `robots.ts`, `sitemap.ts` — search-engine files built from published snapshots.

Which staff page needs which permission is in `routeRequirement` (`src/lib/tournamentRoutes.ts`). Top-level route names are reserved slugs (`RESERVED_SLUGS`).

## Languages

The interface is translated with a small typed dictionary in `src/lib/i18n/`, not a library. English (`messages/en.ts`) is bundled with every page. Each other language is its own code-split chunk loaded on demand (`loadCatalogue` in `messages/index.ts`; Bengali as TypeScript, the others as JSON in `messages/locales/`) and then cached by the service worker. The locale is chosen on the client (viewer's choice, then the tournament's public language, then the browser), so URLs and cached public pages are unchanged. See [Languages and translations](Languages-and-Translations) and [`docs/internationalization.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/internationalization.md).

## Where logic lives

| Layer | Path | Role |
| --- | --- | --- |
| Domain libraries | `src/lib/**` | Pure functions, no React. Tournament rules live here. |
| Commands | `src/features/tournament/application/` | One use case each: run state guards (`stateGuards.ts`), call domain libs, return records to save and audit events. |
| Persistence | `src/features/tournament/infrastructure/` | Firestore repositories, upload transactions, live listeners. |
| Off-thread compute | `src/features/tournament/compute/` | Web Worker wrapper for draws and allocation. |
| State | `src/contexts/TournamentContext.tsx`, `AuthContext.tsx` | Working copy, commands, sync and live session; auth and global-admin claim. |
| UI | `src/app/**`, `src/components/**`, `src/features/tournament/components/` | Rendering and interaction. |

Main domain libraries:

| Path | Contents |
| --- | --- |
| `lib/draw/` | Draw generators (random, power-paired, seeded, round robin, manual, elimination and partial elimination; two-team, BP and N-team debates), Hungarian and Tabbycat-style Hungarian, blossom matching (`weightedMatching.ts`), side allocation, adjudicator allocator, venue allocator, draw validation, seeded RNG |
| `lib/standings/` | Standings metrics, precedence, category and as-of-round standings |
| `lib/breakqual/` | Break qualification, cutoff ties, overrides, liveness |
| `lib/scoring/`, `lib/ballots/` | Score validation; ballot results, individual ballots, result formats |
| `lib/adjudicators/` | Conflicts, testers, allocation positions, diversity |
| `lib/feedback/`, `lib/motions/`, `lib/schedule/`, `lib/checkins/`, `lib/venues/`, `lib/participants/`, `lib/registration/` | Their areas |
| `lib/publicView/` | Public projection, snapshot, hashing, cached store, SEO |
| `lib/api/v1/` | Integration API router, schema, stores, rate limits |
| `lib/email/`, `lib/sms/`, `lib/csv/`, `lib/qr/`, `lib/i18n/`, `lib/offline/` | Their areas |
| `lib/*.ts` | Private URLs, passcodes, rate limits, API tokens and scopes, staff permissions, audit chain, data-entry sync, private sync, tournament access, release rules |

## Directory map

```
firestore.rules            Security rules (see Security-Model)
securityHeaders.mjs        CSP and other headers, used by next.config.mjs
public/sw.js               Service worker (offline app shell)
src/
  app/                     Routes (pages and /api)
  components/              Layout, setup wizard, public pages, i18n provider, shared UI
  contexts/                TournamentContext, AuthContext
  features/tournament/
    application/           Commands, cloudSync, liveSync, liveSession, publicView, ...
    infrastructure/        Firestore repositories and live adapter
    compute/               Web Worker jobs
    components/            Feature components (ballot entry, release panel, ...)
  lib/                     Domain libraries (above)
  test/                    Shared test fixtures
  types/index.ts           Domain types
docs/                      Developer docs (more detail than this wiki)
```

## Related pages

[Data model](Data-Model) · [Security model](Security-Model) · [Caching, indexing and performance](Caching-Indexing-and-Performance) · [Languages and translations](Languages-and-Translations) · [Testing](Testing)
