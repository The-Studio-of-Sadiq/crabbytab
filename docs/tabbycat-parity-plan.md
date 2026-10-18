# CrabbyTab → Tabbycat parity plan

Baseline: `origin/beta` @ `3ff7653` (14 commits ahead of `main`). All file refs are on beta.
Health check run on beta (2026-10-18): `vitest` 301/301 pass · `next lint` pass (5 hook-deps warnings) ·
`next build` pass · `tsc --noEmit` **fails: 33 errors, all in test files** (precedence/calculator/tournamentBackup/email tests).

## Where CrabbyTab stands

**Architecture.** Next.js 15 + React 19, client-side compute. Working copy lives in `localStorage`
per tournament; Firestore is a manually-triggered upload/download mirror (`AUTOMATIC_CLOUD_WRITES = false`).
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
Behaviour notes: publish is skipped when the client's public fingerprint is unchanged (≈3 reads);
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

**Data** — DebateXML **import**, speaker/reply CSV export, full JSON restore (not just merge),
Tabbycat-compatible import.

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

i18n (Tabbycat ships ~15 languages; adopt `next-intl`), accessibility (dialog roles, focus traps,
labelled controls, keyboard DnD), mobile (round creation hidden below `md`), configurable analytics ranges.

## Suggested order

Phase 0 → Phase 1 → Phase 4.1 sync model → Phase 2 (BP draw, allocator) ‖ Phase 3 ballots/release
→ rest of Phase 3 → Phase 5. Each numbered item is roughly one PR with tests.
