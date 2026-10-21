# CrabbyTab

CrabbyTab is a free, offline-first web app for running debate tournaments: British
Parliamentary, two-team formats (Australs, WSDC, UADC, APDA, Karl Popper and others) and
N-teams-per-room events such as public speaking. It covers setup, registration, draws,
adjudicator and venue allocation, ballots, feedback, standings, breaks, public pages and
participant portals in one Next.js app, with the tab room's working copy kept on the device.

CrabbyTab is an independent project inspired by [Tabbycat](https://github.com/TabbycatDebate/tabbycat)
and is not affiliated with it. A source-level audit against Tabbycat v2.12.1, and the remaining
differences, are in [`docs/tabbycat-parity-plan.md`](docs/tabbycat-parity-plan.md).

## Documentation

- **Guide and landing page:** <https://the-studio-of-sadiq.github.io/crabbytab/> (built from
  [`docs/wiki/`](docs/wiki) by [`site/`](site)).
- **Wiki:** <https://github.com/The-Studio-of-Sadiq/crabbytab/wiki> — installation, deployment,
  a first-tournament walkthrough, the organiser guide, settings and CSV reference, and developer
  pages. Its source is [`docs/wiki/`](docs/wiki); edit pages there in a pull request.
- **Developer docs:** [`docs/`](docs) — algorithms, data flow, security and API details.

## Highlights

- **Draws:** power-paired, random, seeded, round robin, manual and elimination draws for two-team
  and BP formats, random and manual draws for N teams per room, Tabbycat's pairing, pull-up,
  side-allocation and conflict-avoidance options, draw stages (confirmed, released to teams,
  released), concurrent rounds and a schedule.
- **Allocation:** CrabbyTab's own panel allocator plus faithful ports of Tabbycat's voting and
  consensus allocators, preformed panels, break liveness priorities, conflicts and room
  constraints.
- **Results:** consensus, voting and median ballots, double entry, self-split ballots, private-URL
  and public-form ballots, motions and vetoes, feedback with configurable paths and questions.
- **Standings and breaks:** every Tabbycat team and speaker metric, configurable precedence,
  standings as of any round, AIDA and standard break rules, break categories and liveness.
- **Public site:** release switches for every tab, publish-time snapshots cached on the CDN (built
  for Firebase's free tier), code names, schedule and iCal, search-engine controls, sitemap and
  link previews.
- **People and access:** registration with invitations, staff permission groups, per-team,
  per-adjudicator and per-speaker private URLs, email notifications.
- **26 languages** (English plus every language Tabbycat offers, machine-drafted), right-to-left
  layouts, lazy-loaded catalogues.
- **Integration:** a REST API (`/api/v1`) with scoped tokens, anonymous reads of public data and
  participant keys ([`docs/api.md`](docs/api.md), `/tournaments/api`, `/api/openapi.json`);
  DebateXML import/export and full JSON backups.
- **Trust:** an append-only, hash-chained audit log, a rule engine with recorded overrides, and a
  differential test harness against Tabbycat itself ([`tools/tabbycat-diff`](tools/tabbycat-diff)).

## Requirements

- Node.js 22 and npm
- A Firebase project (Authentication and Firestore). Creating a tournament — including a demo or
  a DebateXML import — needs a global administrator, which the server verifies with
  firebase-admin, so a service account is required even for local use.
- Optional: SMTP for email, Vercel for hosting.

## Run locally

```sh
npm ci
cp .env.example .env.local   # fill in the Firebase, admin and (optional) SMTP values
npm run dev
```

Open <http://localhost:3000>. Set `FIREBASE_ADMIN_UIDS` to the Firebase Authentication UIDs of
global administrators and `FIREBASE_SERVICE_ACCOUNT_JSON` (or Application Default Credentials) for
server routes. Deploy [`firestore.rules`](firestore.rules) to your project. Never commit
`.env.local` or credentials. Accounts are created in Firebase Authentication or by accepting a
tournament staff invitation; there is no open sign-up.

Deployment, environment variables, the Firestore read budget and caching are described in the
wiki: [Deploying to Vercel and Firebase](https://github.com/The-Studio-of-Sadiq/crabbytab/wiki/Deploying-to-Vercel-and-Firebase)
and [Caching, indexing and performance](https://github.com/The-Studio-of-Sadiq/crabbytab/wiki/Caching-Indexing-and-Performance).

## Development

```sh
npm test            # Vitest, including the Tabbycat differential harness
npm run lint
npm run build
npx tsc --noEmit
npm run i18n:new -- <code>   # start a new language from the English template
npm run i18n:check           # check every language catalogue
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidance, [SECURITY.md](./SECURITY.md)
for reporting security concerns, and [`docs/internationalization.md`](docs/internationalization.md)
for translating.

## License and attribution

CrabbyTab is licensed under the GNU Affero General Public License, version 3
or, at your option, any later version (AGPL-3.0-or-later). See
[LICENSE](./LICENSE) for the complete license text.

Copyright © 2026 Sadiq Khan. Please retain this copyright and license
information when redistributing the project or derivative works. The AGPL
requires making the corresponding source available to users interacting with a
modified version over a network, under the license's terms. It does not require
every organization using the unmodified software privately to publish its
entire repository. This summary is not legal advice; consult the license for
the complete terms.
