# Contributing

Contributions are welcome: bug fixes, tournament-workflow improvements, accessibility, translations,
documentation, tests and ideas. This page summarises how work flows into CrabbyTab. The source documents are:

- [CONTRIBUTING.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/CONTRIBUTING.md): setting up, making
  a change, opening a pull request.
- [AGENTS.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/AGENTS.md): the engineering rules, for people
  and AI coding agents alike.
- [CODE_OF_CONDUCT.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/CODE_OF_CONDUCT.md).
- [SECURITY.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/SECURITY.md): report vulnerabilities
  privately with GitHub's *Report a vulnerability*, never in a public issue.

Contributions are distributed under **AGPL-3.0-or-later**.

## Branches and pull requests

| Branch | Role |
|---|---|
| `beta` | Where development is integrated. Feature branches start here and pull requests target it. |
| `main` | The default branch on GitHub. It receives `beta` when a release is cut; it is currently behind `beta`. |
| feature branches | One per change, named after it (for example `claude/p2-results-pages`). Merged into `beta` by pull request. |

The workflow:

1. For a substantial change, open an issue first so the scope can be agreed.
2. Branch from `beta`. Keep the branch to one fix or feature. If `beta` moves on, merge it into your branch.
3. Make the change, with tests and documentation (below).
4. Run the checks locally (below).
5. Open a pull request into `beta` using the template: summary, related issue, changes, verification, screenshots
   for UI changes, and any configuration, data or migration implications.

CI runs lint, the type check, the tests and the build on every push and pull request; all must pass.

## Local setup

Node.js 22 (`package.json` sets `engines.node` to `22.x`) and npm. See
[Installation and local development](Installation-and-Local-Development).

```sh
npm ci              # install exactly what package-lock.json records
npm run dev         # http://localhost:3000
```

Copy `.env.example` to `.env.local` only if your change needs Firebase or email. Ordinary tests need no
credentials.

## Engineering rules in short

From [AGENTS.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/AGENTS.md):

- **Read first.** Inspect the existing code before changing it; the code is the source of truth. Reuse existing
  helpers rather than duplicating them. Keep changes focused; do not redesign unrelated pages.
- **Local-first.** Draws, allocation, standings and validation run in the browser as deterministic functions,
  separate from React components. Do not add paid services or remote computation.
- **Tournament integrity.** Never silently relax a hard draw constraint, discard a team, or treat a missing result
  as zero. Report constraints that cannot be met. Randomness takes an explicit seed, so the same inputs and seed
  give the same draw. Do not claim a draw is optimal unless the algorithm proves it.
- **Document trade-offs.** Heuristics, tie-breaking rules and known differences from Tabbycat are written down in
  the code and in `docs/` (see `tabbycat-parity-plan.md`, "Still different from Tabbycat").
- **Security.** Enforce access in `firestore.rules` or server routes, never only in the UI. Keep secrets out of the
  client bundle. Do not weaken the rules to work around a bug. Never log tokens or participant data.
- **Data.** Validate before saving; use transactions or batches for multi-step writes; never silently overwrite
  newer changes; keep stored data backward compatible.
- **UI.** Accessible labels, keyboard use, visible focus, status not by colour alone, loading/empty/error states,
  and protection against double submission. New user-facing text must be translatable (below).
- **Dependencies.** Use the existing stack (Next.js 15, React 19, TypeScript, Tailwind 3, Firebase, lucide-react,
  PapaParse, Vitest). Do not add a dependency for something small, and never upgrade a major version as part of
  an unrelated change.
- **Git.** Do not rewrite history on shared branches or commit secrets, `.env.local`, build output or
  `node_modules`.

## Code style

- TypeScript throughout. Avoid `any`; prefer explicit types or `unknown` with narrowing. Do not loosen
  `tsconfig.json` or disable lint rules to make a change pass.
- Small functions with clear names. Comments explain why (a domain rule, a Tabbycat reference, a trade-off), not
  what the code does.
- Business logic lives in `src/lib/**` and `src/features/tournament/application/`; Firestore access in
  `src/features/tournament/infrastructure/` and server routes under `src/app/api/`. See [Architecture](Architecture).
- Components are server components unless they need interactivity or browser APIs (`"use client"`).
- Styling with Tailwind and the shared components in `src/components/ui/`; see
  [design-system.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/design-system.md). For
  right-to-left languages use logical utilities (`ms-*`, `pe-*`, `text-start`).
- `npm run lint` must be clean.

## Tests

Every change to business logic needs a test: draws and constraints, byes and side balance, standings and
tie-breaks, ballots and scoring, breaks, CSV import, permissions and error cases. Include the infeasible case,
not just the happy path, and a fixed-seed reproducibility check for anything random.

Before opening a pull request, run what CI runs:

```sh
npm run lint
npx tsc --noEmit
npm run test
npm run build
```

If your change alters draws, standings, breaks or allocation, the Tabbycat differential test may report a changed
discrepancy. Review it, record a verdict in `tools/tabbycat-diff/known-differences.json`, and regenerate the
report. Details, and how to run single files: [Testing](Testing).

If you cannot run a check, say so in the pull request and list what you did run.

## Documentation to update

Update docs in the same pull request when a change affects setup, environment variables, commands, tournament
rules or draw behaviour, data formats, security or user-facing workflows.

- **Developer docs** in `docs/*.md` (the detailed, per-area reference). The main ones:

  | File | Area |
  |---|---|
  | `draw-generation.md`, `adjudicator-allocation.md`, `tournament-rules-enforcement.md` | draws, allocation, rule checks |
  | `results-and-ballots.md`, `ballot-intake.md`, `standings-and-breaks.md` | results and the break |
  | `participants.md`, `registration.md`, `data-import-export.md` | participants, registration, CSV, DebateXML |
  | `public-pages-and-notifications.md`, `email-notifications.md`, `rounds-schedule-and-motions.md` | public site, email, schedule, motions |
  | `staff-access.md`, `staff-invitations.md`, `api.md` | roles, invitations, the REST API |
  | `storage-and-scale.md`, `live-collaboration.md` | device storage, upload, live sync, Firestore cost |
  | `internationalization.md`, `design-system.md` | languages, UI components |
  | `tabbycat-parity-plan.md` | the roadmap and "Still different from Tabbycat" |

- **This wiki**, which lives in the repository under `docs/wiki/`. Edit the pages there in your pull request, not
  in the GitHub wiki editor. Links between pages use the page name without `.md` (`[Testing](Testing)`); links to
  `docs/*.md` use full GitHub URLs on the `beta` branch. Describe only implemented behaviour and mark limitations
  plainly.

  When `docs/wiki/**` changes on `main` or `beta`, the Pages workflow
  ([`.github/workflows/pages.yml`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/.github/workflows/pages.yml))
  renders the pages into the guide on the project website and, if the `WIKI_TOKEN` secret is set, copies them to
  the GitHub wiki (pages are added or updated, never deleted). To preview the guide locally, see
  [site/README.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/site/README.md).

- **`.env.example`** when you add a configuration variable (placeholders only).

## Translations

All user-facing text goes through the i18n catalogues, and every English key must exist in every other catalogue,
or the tests fail. When you add a string, add the key to every locale (copy the English text if you cannot
translate it, and say so in the pull request). Every non-English catalogue is machine-drafted, so corrections
from fluent speakers are especially welcome. How to add a string, add a language and run `npm run i18n:check`:
[Languages and translations](Languages-and-Translations).

## Lockfiles

- `package-lock.json` is the authoritative lockfile; CI installs with `npm ci`. If you change dependencies, update
  `package.json` and `package-lock.json` together with npm.
- The repository also contains a `bun.lock`. Do not delete or regenerate it casually, and do not switch the
  project to another package manager.
- Build-time tools for the website (`marked`) are installed into a temporary folder and are deliberately not in
  `package.json`.
