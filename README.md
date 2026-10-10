# CrabbyTab

CrabbyTab is an offline-first web app for setting up and running British
Parliamentary (four-team) and two-team parliamentary debate tournaments. It
brings tournament setup, draws, results, standings, and administration tools
together in one interface.

CrabbyTab is an independent project and is not affiliated with Tabbycat.

## What it can do

- Create tournaments with a guided setup wizard and configurable formats,
  rounds, scoring, breaks, and public visibility.
- Import and manage teams, adjudicators, institutions, venues, and motions.
- Generate draws, allocate adjudicators and venues, and manage check-ins.
- Import division IDs and names with teams, then restrict a round draw to one
  division when divisions should run in parallel.
- Record results and ballots, calculate standings, and manage break categories.
- Configure adjudicator panel balancing, feedback questions, and institution
  limits for break qualifiers.
- Publish selected tournament information and provide private ballot and
  feedback links.
- Print round ballots and feedback sheets, and use barcode labels with
  keyboard-scanner check-in.
- Review tournament activity with audit tools and use analytics and display
  views during an event.
- Keep tournament data in the browser for offline use, with optional Firebase
  authentication and cloud synchronization.

### CSV divisions and venue requirements

Team imports can include `division_id` and `division` columns. Select a
division on the Draw page to limit that round's eligible teams; leaving the
round set to **All divisions** preserves the default draw behavior. Team,
adjudicator, and institution imports can also include `required_venue_category`,
`min_venue_capacity`, `requires_accessible_venue`, `requires_online_venue`, and
`requires_near_tab_room` to apply standing venue requirements. Venue imports
accept `near_tab_room` as a capability column.

## Requirements

- Node.js 22
- npm
- A Firebase project for authentication and cloud features (optional for local
  browser-based use)

## Run locally

```sh
npm install
cp .env.example .env.local
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). To use Firebase,
populate the `NEXT_PUBLIC_FIREBASE_*` values in `.env.local` from your Firebase
project. The app can store tournament data in the browser; Firebase enables
cloud-backed tournament discovery, authentication, and synchronization.

Do not commit `.env.local` or credentials. For server-side Firebase
administration, configure `FIREBASE_SERVICE_ACCOUNT_JSON` or the hosting
environment's Application Default Credentials. The email tools also require
the SMTP settings shown in `.env.example`.

Create all user accounts manually in Firebase Authentication; CrabbyTab does
not provide public registration. Set `FIREBASE_ADMIN_UIDS` to a comma-separated
list of Firebase Authentication UIDs for global administrators. Global admins
can manage every tournament and Firestore collection. On sign-in, the server
uses its Firebase Admin credentials to assign the matching Firestore custom
claim; deploy the repository's `firestore.rules` for that claim to grant access.
Tournament owners and tournament administrators can use the tournament's
**Staff** page to assign existing Firebase accounts as tournament
administrators or data-entry staff. Assignments are tournament-scoped; staff
emails must already belong to an account, and no account directory is exposed
to tournament administrators.

When deploying, configure the Firebase Authentication and Firestore services
for your own project and review [firestore.rules](./firestore.rules) before
publishing them. Never expose service-account credentials or SMTP passwords in
client-side environment variables.

Cloud synchronization uses a per-record version. If an offline device edits a
record after another device has changed it, CrabbyTab keeps the cloud copy and
archives both versions rather than silently replacing the newer copy. Use the
tournament's sync-recovery export to inspect archived versions. Deleted cloud
records receive recoverable tombstones, so later downloads do not restore them
and stale uploads cannot remove the tombstone. Team portals show ballots only
after results are released on a non-silent round, and hide speaker scores until
team speaks are released.

## Development

Run the test suite:

```sh
npm test
```

Run lint checks:

```sh
npm run lint
```

Create a production build:

```sh
npm run build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution and pull request
guidance, and [SECURITY.md](./SECURITY.md) for reporting security concerns.

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
