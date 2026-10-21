# Caching, indexing and performance

How CrabbyTab keeps public pages fast and inside the Firestore free tier (Spark: 50,000 document reads
per day), how search engines see a tournament, and what is known about very large (1000-team) events.

## For organisers

### Public pages show the last published copy

Public pages, the projector (`/{slug}/display`) and private-URL portals never read your device. They
read a **public snapshot** that the server builds from the cloud copy when you publish.

- **Releasing something publishes it.** Releasing or unreleasing a draw, results, team speaks, a motion,
  a tab, a break or a participant list uploads this device's pending changes and publishes public pages
  in one step. If the upload or the publish fails, the dialog says the change is saved on this device
  but **not public yet**.
- **Upload now** also publishes after the upload, unless the upload left sync conflicts (publishing then
  would mix your changes with older versions). Resolve the conflicts first.
- **Republish public pages** (in the top-bar menu, with Tournament settings and the backup actions) publishes again without other changes, for example
  after changing a public-visibility setting.
- Changes made only by data-entry staff reach public pages after the next administrator upload or publish.
- A tournament that has **never been published** is built live from its cloud collections and cached for
  five minutes. That is expensive for large events, so publish once before you share links.

### How quickly the public sees a change

| Who is looking | When they see the new version |
| --- | --- |
| Someone opening or reloading a public page | Within about 15 seconds (the CDN cache of the main response) |
| A public page or projector left open | At the next version check, every 45 seconds while the tab is visible |
| Check-in status page | Within about 15 seconds of the next publish |
| Schedule page / calendar feed | Within about 2 / 5 minutes |

Public pages open with the latest round straight away and load earlier rounds after it, so standings and
results can fill in a moment later on big tournaments.

### Search engines

**Admin → Configuration → Public visibility → Public homepage → Search engines** (Tabbycat's
`search_engine_indexing`) has three choices:

| Choice | Effect |
| --- | --- |
| Allow every public page to be indexed (default) | Public pages are indexable; the sitemap lists the public tab plus the schedule and check-in pages when they are switched on. |
| Only the public tab homepage | Only `/{slug}/public` is indexable; every other public page gets `noindex, nofollow`. The sitemap lists the public tab only. |
| No pages | Every public page gets `noindex, nofollow`; the tournament is left out of the sitemap. |

Gotchas:

- `noindex` is a request; well-behaved search engines follow it, others may not. **It is not a privacy
  control** — anyone with the link can still open a public page. Hide information with the public
  visibility settings instead.
- The setting takes effect when you publish (it is read from the public snapshot).
- The cross-tournament motion statistics page (`/tournaments/motions/public`) is `noindex` whenever any
  tournament pooled there has a setting other than "all".
- Link previews (title, description, image when a link is pasted into chat apps) are produced whatever
  the setting. The description is the first paragraph of your public homepage (as plain text), else
  your welcome message, shortened to 160 characters, or a generated sentence.
- The tab room, projector, private URLs, sign-in, invitation and account pages are always `noindex`.

## Details

### What costs Firestore reads

| Activity | Reads |
| --- | --- |
| A visitor opening a public page | Normally none: served from the CDN or the Vercel Data Cache. A cache miss costs one read per snapshot chunk it needs. |
| Version checks from open public pages | None after the first per publish (cached). |
| A publish | A few aggregation reads to check whether anything changed (skipped publish ≈ 3 reads + one per source collection); otherwise one full read of every public collection (`feedback` only when a public feature needs it) plus writes of the changed sections. |
| An administrator device opening a cloud tournament | One read of every collection, then live listeners: about 325 reads for a 100-team BP event, plus about one read per change per other administrator device. |
| A private-URL portal load | Only that participant's debates, their teams and their ballots (about 10 debates for a team at a 1000-team BP event), via the `participantIds` index. |
| Sitemap | At most one read per published tournament every six hours. |
| Pooled motion statistics | About one read per contributing tournament per hour. |

Anonymous visitors never open Firestore listeners; only administrator devices do (see
[live-collaboration.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/live-collaboration.md#cost-spark-tier)).

### Publish-time snapshots (`src/lib/publicView/*`)

- `projection.ts` decides what is public (an allowlist: hidden values never reach a snapshot, a cache or
  a browser). `derived.ts` computes tabs and aggregates at publish time. See [Security model](Security-Model).
- `snapshot.ts` splits the view into **sections**: base sections (`tournament`, `rounds`, `teams`,
  `adjudicators`, `venues`, `motions`, `breakCategories`, `institutions`, `checkins`, `tabs`, `derived`)
  and one `round-{roundId}` section per public round with that round's debates and ballots. Each
  section is hashed (`hash.ts`) and chunked into documents of at most about 700 KB.
- `store.ts` (`publishPublicView`, called by `POST /api/tournaments/[id]/public-view`):
  1. Skips the rebuild when the device's public fingerprint and the cloud source token (aggregation
     counts and `syncVersion` sums) both match the last publish.
  2. Otherwise reads the source collections, writes only the sections whose hash changed to
     `publicViews/{slug}/chunks/{section}-{hash}-{i}`, then switches the root `publicViews/{slug}`
     over in one write, then deletes chunks the new root no longer uses.
  3. Retires views published under an older slug and calls `revalidateTag(publicViewTag(slug))`
     (tag `public-view:{slug}`).
- The root also stores a small `seo` summary and, when motion statistics are released, a
  `motionSummary`, so the sitemap and pooled motion page never read whole snapshots.

### Vercel Data Cache

Server reads go through `unstable_cache` (Next.js 15; `"use cache"` is not used):

| Entry | Key | Revalidate | Invalidated by |
| --- | --- | --- | --- |
| Public view root | `public-view-root`, slug | 1 hour | tag `public-view:{slug}` on every publish |
| Section | slug, section, hash, chunk count | 24 hours | never needed: content-addressed by hash |
| Never-published fallback | `public-view-live`, slug | 5 minutes | tag `public-view:{slug}` on first publish |
| Sitemap sources | `public-sitemap-sources` | 6 hours | tag `public-sitemap` (publishes deliberately do not clear it) |
| Pooled motion summaries | `public-motion-summaries` | 1 hour | none |

Because sections are cached separately and keyed by hash, publishing one round's results invalidates
only the root and the sections that actually changed; every entry stays well below the cache's 2 MB limit.

### CDN headers

`publicCacheHeaders(sMaxAge, staleWhileRevalidate)` sends
`Cache-Control: public, max-age=0, s-maxage=…, stale-while-revalidate=…`: browsers always revalidate,
the CDN absorbs refresh storms.

| Route (`/api/public/...`) | `s-maxage` / `stale-while-revalidate` |
| --- | --- |
| `tournaments/[slug]` (base + latest round) | 15 s / 30 s |
| `tournaments/[slug]?round={id}&h={hash}` with the current hash | 1 day / 1 hour (a content address) |
| same with a stale or missing hash | 15 s / 30 s |
| `tournaments/[slug]/version` | 10 s / 20 s |
| `tournaments/[slug]/checkins`, `/forms` | 15 s / 30 s |
| `tournaments/[slug]/registration` | 30 s / 60 s (60 s / 120 s when closed) |
| `tournaments/[slug]/audit` (release status) | 60 s / 300 s |
| `tournaments/[slug]/schedule` | 120 s / 600 s |
| `tournaments/[slug]/schedule/ical` | 300 s / 900 s |
| `motions` (pooled statistics) | 600 s / 3600 s |

### Version polling and per-round paging

- Public pages and the projector poll `/version` every 45 s (`PUBLIC_VIEW_POLL_MILLISECONDS`), only while
  the browser tab is visible, and refetch the projection only when the version changed.
- The main response holds every base section, the latest public round, and `roundSections`
  (round id → hash). Public pages then load the other rounds three at a time; the projector loads only
  the round it shows; private portals load every round first (`fetchCompletePublicProjection`). Rounds
  whose hash did not change are kept.
- Views published before per-round sections are still served (split by round when read) until the
  next publish rewrites them.

### robots.txt, sitemap.xml and metadata

- **`src/app/robots.ts`** returns `buildRobotsRules(resolveSiteUrl())` from `src/lib/seo/robotsRules.ts`:
  one rule for every crawler that allows `/` and the public pages (`/*/public`, `/*/public/…`,
  `/*/schedule/public`, `/*/checkins/public`, `/*/audit/public`) and disallows `/api/` (including
  `/api/public/`), `/login`, `/invite`, `/account`, `/forgot-password`, `/tournaments/new|import|demo`,
  private URLs (`/*/private/`), the projector (`/*/display`) and every tab-room section from
  `TOURNAMENT_STAFF_SECTIONS`. Because crawlers apply the longest matching rule, each disallowed section
  has a longer Allow for its public twin. It points to `{site}/sitemap.xml`. A test fails if a route
  folder under `src/app/[tournamentSlug]/` is missing from the section list.
- **`src/app/sitemap.ts`** is rendered per request (`force-dynamic`, so a build without credentials does
  not bake in an empty sitemap). It lists the site home page plus `publicSitemapEntries` for every
  **published** tournament (`publicViews/{slug}` roots, at most 15,000): nothing under "none", the public
  tab (priority 0.8) under "homepage only", and under "all" also the schedule (0.5) and check-in (0.3)
  pages when switched on, with `lastModified` from the publish time. Without Firebase admin credentials
  or on a Firestore error it lists only the home page. Record pages, the audit log and the registration
  form are not listed but stay crawlable through links.
- **Metadata.** `src/app/[tournamentSlug]/layout.tsx` sets `noindex, nofollow` for everything under a
  tournament. Public pages override it in `generateMetadata` via `publicPageMetadata`
  (`src/lib/publicView/robots.ts`), which reads only the cached `tournament` section and returns a
  title (`{page} · {tournament} | CrabbyTab`), description, canonical URL, Open Graph and Twitter cards
  with `/og-image.png`, and robots from `robotsForPublicPage`. This covers the public tab (the
  "homepage"), team and adjudicator record pages, the public ballot and feedback forms
  (`/public/ballots`, `/public/feedback`), the schedule, check-in and audit pages, and the
  registration form. An unknown tournament is `noindex`; any other read error
  keeps the page indexable so a transient failure does not drop it from search results.
- Absolute URLs use `NEXT_PUBLIC_APP_URL`, else `https://$VERCEL_URL`, else `http://localhost:3000`
  (`src/lib/seo/site.ts`). Set `NEXT_PUBLIC_APP_URL` in production so the sitemap and canonical URLs use
  your real domain.

### Large tournaments (1000 teams)

From [storage-and-scale.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/storage-and-scale.md):

- **Device storage.** The working copy is in IndexedDB (a 1000-team working copy is 7–13 MB, beyond
  localStorage's ~5 MB). Without IndexedDB (some private-browsing modes) it falls back to localStorage
  and its limit.
- **Uploads** send only records changed since the last sync, in transactions of up to 150 records.
  An initial upload of a 1000-team BP event is about 10,000 reads and 10,300 writes; uploading again with
  nothing changed is about 4 reads. Spark allows 20,000 writes a day, so **plan on the Blaze plan** for
  events of this size.
- **Public snapshot** after 9 rounds: about 5 MB (BP) or 8.4 MB (WSDC) in 18 sections, the largest under
  900 KB; the first public response is 0.9–1.3 MB.
- **Speed.** Draws take up to about 3 s a round, standings under 0.1 s; auto-allocation is the slowest
  step (seconds per round) and runs in a Web Worker so the page stays usable. Large rounds can be split
  into shards on the allocation board.
- The benchmark (`src/features/tournament/application/scale.test.ts`) plays 2 rounds by default;
  `CRABBYTAB_SCALE=full` plays all 9 and `CRABBYTAB_SCALE=off` skips it. See [Testing](Testing).

### Known limits

- Publishing reads every public collection once (unless nothing changed), so publish when something is
  ready rather than continuously on very large events.
- Never-published tournaments are built live and may be too large to cache.
- A second browser tab sees another tab's changes to the same tournament only after a reload.

See also: [Architecture](Architecture), [Public pages and releases](Public-Pages-and-Releases),
[Settings reference](Settings-Reference), [Deploying](Deploying-to-Vercel-and-Firebase), and
[public-pages-and-notifications.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/public-pages-and-notifications.md).
