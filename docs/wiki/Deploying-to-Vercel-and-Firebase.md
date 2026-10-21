# Deploying to Vercel and Firebase

CrabbyTab is designed to run for free: a Next.js app on **Vercel** and a **Firebase** project on the **Spark** (no-cost) plan. Nothing in the app needs a paid API. Very large events (around 1000 teams) may need Firebase's pay-as-you-go **Blaze** plan; see [the read and write budget](#staying-inside-the-spark-budget).

You need:

- a GitHub fork or clone of the repository,
- a Vercel account,
- a Firebase project with **Authentication** (email/password) and **Cloud Firestore**,
- optionally an SMTP account for email.

## 1. Create the Firebase project

1. Create a project in the [Firebase console](https://console.firebase.google.com/).
2. **Authentication → Sign-in method:** enable *Email/Password*. Under *Settings → Authorized domains*, add your Vercel URL and any custom domain.
3. **Firestore Database:** create a database in production mode. Choose a region close to your users; it cannot be changed later.
4. **Project settings → Your apps:** add a *Web app* and copy its config values into the `NEXT_PUBLIC_FIREBASE_*` variables.
5. **Project settings → Service accounts:** generate a new private key. The downloaded JSON becomes `FIREBASE_SERVICE_ACCOUNT_JSON`. Treat it as a secret.

## 2. Deploy the Firestore rules

The repository's [`firestore.rules`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/firestore.rules) are part of CrabbyTab's security model. They decide what tournament administrators, data-entry staff, global admins and signed-out visitors may read and write, and they deny every client access to server-only data (registrations, invitations, private-URL secrets). Without them the app does not work correctly and data may be exposed.

The repository has no `firebase.json`, so deploy the rules in one of two ways:

- **Console:** paste the file into **Firestore Database → Rules** and press **Publish**.
- **CLI:** in a separate folder, create a minimal `firebase.json` such as `{ "firestore": { "rules": "firestore.rules" } }`, copy `firestore.rules` next to it, and run `firebase deploy --only firestore:rules --project <your-project-id>`.

Review the rules before publishing them, and redeploy them whenever you update CrabbyTab and the file has changed. The rules are not run in CI (there is no emulator setup), so check changes in the console's **Rules Playground** first; [`docs/live-collaboration.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/live-collaboration.md) lists the cases to try. See [Security model](Security-Model) for what the rules allow.

No composite indexes need to be created by hand. If Firestore ever reports a missing index in the server logs, the error message contains a link that creates it.

## 3. Create the Vercel project

1. Import the repository in Vercel. The framework preset is **Next.js**; the default install and build commands (`npm ci` / `npm run build`) work as they are. Set the Node.js version to **22.x**.
2. Add the environment variables (Production, and Preview if you test previews):

   | Variable | Required | Notes |
   | --- | --- | --- |
   | `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | Firebase web config. Public identifiers, compiled into the browser bundle, so a change needs a redeploy. |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | Yes | Paste the whole JSON; it may stay on one line. Server only. |
   | `FIREBASE_ADMIN_UIDS` | Yes | UIDs of global administrators, comma or space separated. |
   | `NEXT_PUBLIC_APP_URL` | Recommended | Your production URL, used as the base for page metadata. Falls back to `https://$VERCEL_URL`. |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | For email | Without them, everything except sending email works; invitation and registration links are then shown once to copy. |
   | `EMAIL_WEBHOOK_SECRET` | Optional | Enables the signed delivery-status webhook. |
   | `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_SECRET` | Optional | Your own HTTPS SMS relay. |

   Variable details: [Installation](Installation-and-Local-Development#environment-variables).
3. Deploy.

Server routes run on the Node.js runtime. The email send, retry and automatic-notification routes allow up to 60 seconds per request, and one email send is capped at 100 recipients.

## 4. Create accounts and global administrators

CrabbyTab has **no public account sign-up**.

- Create the first accounts in **Firebase → Authentication → Users**. Put the UIDs of the people who run the site into `FIREBASE_ADMIN_UIDS`. On every sign-in the server adds or removes the `globalAdmin` custom claim to match the list, and the Firestore rules trust that claim. After changing the variable, redeploy and have the person sign out and in again.
- Only global admins can create tournaments, load demo tournaments or import DebateXML archives.
- Tournament administrators and data-entry staff are added per tournament on its **Staff** page: either an existing account directly, or an **email invitation**, which lets the invitee create an account for exactly the invited address. See [Staff and roles](Staff-and-Roles).
- Forgotten passwords are reset by email at `/forgot-password` (Firebase sends that email, not your SMTP server).

## 5. Email (optional)

Set the `SMTP_*` variables. Any SMTP provider works; check its daily sending limit against the size of your tournament. Send a test from the tournament's **Email** page. See [Email and notifications](Email-and-Notifications).

## Staying inside the Spark budget

The Spark plan allows **50,000 Firestore document reads and 20,000 writes per day**. CrabbyTab is built around those limits.

### Where reads and writes come from

| Activity | Firestore cost |
| --- | --- |
| Public pages, projector, public check-ins, public schedule | Almost none: served from cached snapshots (below). Audience size hardly matters. |
| Opening a cloud tournament on an administrator device | Reads every collection once, then live listeners take over. For a 100-team BP event with ~150 adjudicators that is a few hundred reads more. |
| Live collaboration (administrator devices) | Ballots, check-ins, draws and allocations are written record by record. Each change costs about one read per other listening admin device; a confirmed ballot about 3. Listeners cover the teams and adjudicators collections and the active round's debates and ballots only. |
| **Upload now** | Sends only records changed since this device last synced, in transactions of up to 150 records. An upload with nothing changed costs a handful of reads. |
| **Download and compare** | Reads the tournament's collections. |
| Publishing public pages (after an upload or release) | About one read per collection to check whether anything public changed; if so, one read of every public collection to rebuild the snapshot. Unchanged publishes are skipped. |
| Private URLs (team, speaker and adjudicator portals) | Participant-scoped: a team portal reads its own debates, their teams and ballots (around 10 debates, not the whole draw). |
| Registration form | 2 reads per page view (cached 30 s at the edge); a submission about 7 reads and 5 writes. |

A rough guide: four administrator devices on a 100-team event stay well inside 50k reads a day. A 1000-team event's first upload is about 10,000 writes, so several full uploads a day exceed Spark's 20,000 writes; plan on Blaze for events of that size. Details: [`docs/storage-and-scale.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/storage-and-scale.md) and [`docs/live-collaboration.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/live-collaboration.md).

### How public caching keeps reads low

- **Public pages never read the tournament collections.** When an administrator uploads or releases something, the browser builds a sanitised *public projection* (only released data) and publishes it to `publicViews/{slug}`, split into sections and one section per public round.
- **The server reads snapshots through the Next.js Data Cache**, which Vercel shares across instances. A publish invalidates the tournament's cache at once. Otherwise the root document is refreshed hourly and section documents daily.
- **The CDN absorbs bursts.** `GET /api/public/tournaments/{slug}` and `/checkins` answer with `Cache-Control: public, max-age=0, s-maxage=15, stale-while-revalidate=30`; `/version` with 10 / 20 seconds. A single round requested with its current content hash (`?round={id}&h={hash}`) is cached for a day, because that URL never changes meaning.
- **Clients poll a tiny version marker.** The public page and the projector check `/version` every 45 seconds and reload only the rounds whose hash changed. The public check-in page refreshes every 30 seconds through the same cache.
- Other public endpoints are cached too: the schedule JSON for 2 minutes, the iCalendar feed and public audit status for a minute, and the cross-tournament motion statistics for 10 minutes.
- A tournament that has **never been published** is built once from its collections on first view and cached for 5 minutes. For large events, publish before sharing links.

Republish by hand from the account menu with **Republish public pages**. It publishes the cloud copy; if this device has changes that are not uploaded, it asks whether to upload first.

## Updating a deployment

1. Pull the new version and read the commit log.
2. Compare `firestore.rules` and `.env.example` with your deployment and update both if they changed.
3. Redeploy on Vercel.
4. Ask organisers to **Upload now** before the update (so nothing is only on one device), and to reload afterwards.

## Checklist

- [ ] Email/password sign-in enabled, authorised domain added
- [ ] Firestore created and `firestore.rules` published
- [ ] Vercel env vars set (Firebase web config, service account, admin UIDs), Node.js 22
- [ ] A global admin can sign in and sees **Create a new tournament**
- [ ] (Optional) SMTP configured and a test email sent from the Email page
- [ ] (Optional) A test tournament uploaded and its public tab opened in a private window
