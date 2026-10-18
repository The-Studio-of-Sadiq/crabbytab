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
- Issue read-only API tokens for integrations, with separate released-draw
  and all-draw scopes; the OpenAPI document is available at `/api/openapi.json`.
- Export portable DebateXML archives in the Tabbycat DTA schema alongside
  CrabbyTab's full-fidelity JSON backups.
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

Team imports may also include `speaker1_categories` (to `speaker3_categories`),
e.g. `esl; novice`, and `break_categories`, listing the names, slugs or ids of
existing break categories the team is eligible for. An unknown break category
rejects the whole import and names the row.

Break categories may use Standard qualification, AIDA 1996, AIDA 2016 Australs,
or AIDA 2016 Easters rules. The AIDA 2016 options require a two-team format;
the standard rule remains the default for existing and new categories.

### Rounds, breaks and public releases

- A preliminary round can be marked **complete** from the Results page once
  every non-bye debate has a confirmed ballot and none is postponed; it can be
  reopened. Released tabs and adjudicator break-liveness use completed rounds.
- Break sizes need not be powers of two. A break that does not halve cleanly
  (for example 12 two-team or 24 BP teams) starts with a partial elimination
  round: the top `2T − N` seeds get a bye (T is the next full bracket size
  below N) and the remaining seeds are folded. BP breaks must be even. Later
  elimination rounds keep each team's bracket position instead of re-seeding.
- On the Break page each category can be edited or deleted (until its break is
  generated) and teams can be given overrides: *manually included* (takes a
  break place first, but a team never breaks in two categories) or a remark
  that removes it (ineligible, withdrawn, different break, disqualified, lost
  coin toss). Generating a category's break changes only that category.
- Full tabs and breaks are hidden by default: the **Public release** panel on the Standings
  page releases the team, speaker and replies tabs (completed preliminary
  rounds, silent rounds included) and each break category separately.

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

The read-only integration API uses administrator-issued bearer tokens. Store
them securely and revoke them from the tournament's **API Access** page when
they are no longer needed. `read:public` returns only released draws;
`read:draws` also returns unreleased draw assignments. Neither scope returns
participant email addresses, private portal credentials, ballot scores, or
feedback. Full-fidelity CrabbyTab backups remain the recovery format; DebateXML
archives are the interoperable exchange format and may omit fields that the
DebateXML schema does not represent.

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
