# Installation and local development

This page gets CrabbyTab running on your own machine. To put it online for a real tournament, continue with [Deploying to Vercel and Firebase](Deploying-to-Vercel-and-Firebase).

## Requirements

- **Node.js 22** (`package.json` pins `"node": "22.x"`).
- **npm**. `package-lock.json` is the authoritative lockfile. The repository also contains a `bun.lock`; leave it alone unless you are deliberately changing package-manager conventions.
- A **Firebase project** with Authentication (email/password) and Cloud Firestore. Tournament data lives in your browser, but creating a tournament (including a demo tournament or a DebateXML import) needs a signed-in **global administrator**, and that needs Firebase Authentication plus server credentials. Without Firebase the hub shows *Firebase is not configured*.
- Optional: an **SMTP server** to try the email tools, staff invitations and registration emails.

## Install and run

```sh
git clone https://github.com/The-Studio-of-Sadiq/crabbytab.git
cd crabbytab
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. The dev server always uses port 3000.

## Environment variables

Copy `.env.example` to `.env.local` and fill it in. Never commit `.env.local`.

| Variable | Where it is used | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Server (page metadata) | Canonical base URL of the site. If empty it falls back to `https://$VERCEL_URL` on Vercel, otherwise `http://localhost:3000`. |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_APP_ID`, `_AUTH_DOMAIN`, `_MEASUREMENT_ID`, `_MESSAGING_SENDER_ID`, `_PROJECT_ID`, `_STORAGE_BUCKET` | Browser | The Firebase web-app config from *Project settings → Your apps*. These are public identifiers, not secrets. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Server only | The full JSON of a Firebase service-account key, on one line. Escaped `\n` in the private key are converted back to newlines. If empty, the server falls back to Application Default Credentials. |
| `FIREBASE_ADMIN_UIDS` | Server only | Firebase Authentication UIDs of **global administrators**, separated by commas or whitespace. See [Staff and roles](Staff-and-Roles). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | Server only | Outgoing mail. `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are required for email; `SMTP_PORT` defaults to 587. `SMTP_SECURE` is `true` or `false` (TLS from the start of the connection); if empty, it is on only for port 465. |
| `EMAIL_WEBHOOK_SECRET` | Server only, optional | Shared secret for the signed delivery-status webhook (`POST /api/email/webhook`). Without it the endpoint answers 404. |
| `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_SECRET` | Server only, optional | A generic HTTPS SMS relay you control; each SMS is POSTed and signed with the secret. No SMS provider is built in. |

Details for the email and SMS variables: [`docs/email-notifications.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/email-notifications.md).

> **Never** put the service account, SMTP password or webhook secrets in a `NEXT_PUBLIC_` variable — those are compiled into the browser bundle.

## Make yourself a global administrator

CrabbyTab has no public account sign-up. (The `/register/{slug}` pages are tournament *registration* forms for teams and adjudicators, not account creation.) Accounts are created in Firebase Authentication by hand, or by accepting a staff invitation from a tournament administrator.

1. In the Firebase console, enable **Authentication → Sign-in method → Email/Password** and add a user.
2. Copy that user's UID into `FIREBASE_ADMIN_UIDS` in `.env.local`.
3. Provide server credentials (`FIREBASE_SERVICE_ACCOUNT_JSON`). On every sign-in the server adds or removes the `globalAdmin` custom claim to match the list.
4. Deploy the repository's `firestore.rules` to your project (see [Deploying](Deploying-to-Vercel-and-Firebase#2-deploy-the-firestore-rules)).
5. Restart `npm run dev`, sign in at `/login` and open `/tournaments`. You should now see **Create a new tournament**, *Or import a DebateXML archive* and *Or load a demo tournament for a rehearsal*.

## Trying it out without real data

- **Demo tournament:** `/tournaments` → *Or load a demo tournament for a rehearsal* creates a seeded BP (24 teams) or WSDC (16 teams) practice tournament on this device. Its URL starts with `demo-`. See the [First tournament walkthrough](First-Tournament-Walkthrough).
- **Sample CSVs:** the `testdata/` folder contains small files (institutions, teams, adjudicators, venues, motions) for the import pages. See [CSV formats](CSV-Formats).

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build (also type-checks application code) |
| `npm run start` | Serve the production build on port 3000 |
| `npm run test` | Run the Vitest suite once (no Firebase credentials needed) |
| `npm run lint` | `next lint` |
| `npx tsc --noEmit` | Full type check including tests |

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run test` and `npm run build` in that order. Run the same before opening a pull request.

### Details

- The 1000-team scale benchmark runs inside `npm run test` with 2 rounds per format (about 20 s). Set `CRABBYTAB_SCALE=full` to play every round, or `CRABBYTAB_SCALE=off` to skip it. See [`docs/storage-and-scale.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/storage-and-scale.md).
- `tools/tabbycat-diff` compares CrabbyTab's draws, standings, breaks and allocations against recorded Tabbycat v2.12.1 output; its report runs in `npm run test` without Docker or Python. Regenerating Tabbycat's golden output needs Docker (or Python 3.11 and PostgreSQL); see its README.
- `tools/i18n` holds the translation tooling; see [`docs/internationalization.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/internationalization.md).
- `site/build.mjs` renders these wiki pages into the static GitHub Pages site and checks every internal link and anchor (`--strict` fails on a broken link). `marked` is not a project dependency; the script header explains how to point it at a separate install.
- The repository has no Firestore emulator setup, so `firestore.rules` are not executed in CI. Check rule changes in the Firebase console's Rules Playground before deploying them.

## Next steps

- [Deploying to Vercel and Firebase](Deploying-to-Vercel-and-Firebase)
- [First tournament walkthrough](First-Tournament-Walkthrough)
- [Architecture](Architecture) if you want to change the code
