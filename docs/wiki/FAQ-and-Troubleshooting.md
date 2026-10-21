# FAQ and troubleshooting

Common questions from organisers, and what to do when something looks wrong. Each answer links to the page with the
full explanation.

## Accounts and access

**I signed in but cannot create a tournament.**
Only global administrators can create, import or load a demo tournament. Your account's UID must be in
`FIREBASE_ADMIN_UIDS` on the server, the server needs Firebase Admin credentials, and the current `firestore.rules`
must be deployed. After the variable changes, redeploy and sign out and in again. See [Staff and roles](Staff-and-Roles).

**How do people get an account?**
There is no open sign-up. Either create the account in the Firebase console, or invite people from the tournament's
**Staff** page: they get an email link, choose a name and password, and receive the role in one step. If email is not
set up, the invitation link is shown once on the Staff page so you can send it yourself. See
[Staff and roles](Staff-and-Roles).

**Adding a staff member says the account was not found.**
Assigning directly only works for an existing account. Send an invitation instead.

**A staff member cannot see the tournament.**
The tournament must have been uploaded at least once, and the person must have a role on it. Ask them to reload
`/tournaments`. The Staff page does not refresh by itself when someone accepts an invitation; reload it.

**A data-entry staff member cannot see the draw, motions or standings.**
Their permission groups and the tournament's staff access level decide what they see. Check them on
**Tournament access**, then upload (the access level is a tournament setting). See [Staff and roles](Staff-and-Roles).

## Working offline, uploading and syncing

**Does CrabbyTab work without internet?**
Yes, for the tab room. Each device keeps a full working copy in the browser and computes draws, allocations and
standings itself. Offline changes stay on the device (live changes are queued and sent on reconnect). What needs the
internet: uploading, releases (they are refused while offline), public pages, private URLs and email. See
[Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).

**My changes are not on the public page.**
Public pages show the last **published** cloud copy, not your device. Check, in order:

1. The cloud status pill in the top bar. *N changes not uploaded* means they are only on this device: use
   **Upload now**. *N upload conflicts* or *Upload incomplete* means nothing was published; resolve or upload again.
2. That the thing is released. Draws, results, motions, tabs and breaks each need their own release, and the
   matching switch under Configuration → Public visibility must be on. See
   [Public pages and releases](Public-Pages-and-Releases).
3. Open public pages check for updates every 45 seconds. Reload to see a change at once.

Account menu → **Republish public pages** rebuilds the public pages from the cloud copy. If this device has changes
that are not uploaded, it asks whether to upload them first.

**Changes from another device are missing.**
Ballots, draws, allocations and check-ins sync live between administrator devices for the **active round**, within
seconds. Everything else (settings, rounds and their releases, motions, rooms, breaks, feedback) needs an **Upload
now** on the other device, then **Download and compare** or a reload here. Corrections to earlier rounds also arrive
only after a reload or download. Check the pill says **Live** and that live updates are not paused on either device.

**The pill shows sync conflicts.**
A record changed both here and in the cloud. Open **Resolve sync conflicts** (cloud status menu or account menu),
compare the two versions, and pick **Keep mine** or **Use cloud** for each. Then upload. Nothing is lost: every
replaced cloud version is archived, and account menu → **Export sync recovery** downloads them all.

**The pill shows double confirmations.**
Two devices confirmed different ballots for the same debate before seeing each other's. Open that debate's ballots
and discard the version that should not count. CrabbyTab never picks one for you.

**"The new draw is saved on this device, but updating the cloud copy did not finish."**
Press **Upload now**. The upload completes the change.

**"Could not save … locally".**
The browser's storage is full or blocked (some private-browsing modes do this). Export a backup (account menu), upload
if you can, then free disk space or use a normal window. CrabbyTab retries with the next change.

**I cleared my browser data or changed computers.**
If the tournament was uploaded, sign in and open it again: the cloud copy loads. Otherwise restore your last JSON
backup (account menu → **Restore tournament backup**). Export backups regularly during the event.

## Public pages and private URLs

**The public link shows nothing or "not found".**
A tournament that has never been uploaded exists only on your device. Upload it once; then the public URL works for
everyone.

**Participants' private links do not work.**
Private URLs read the cloud copy, so new or regenerated links work only after you upload. **Regenerate all private
keys** stops every link already handed out. See [Private URLs and portals](Private-URLs-and-Portals).

**A private link says too many requests.**
Links are rate-limited (per link, and failed passcodes per network). Wait for the retry time shown. A whole venue on
one network typing wrong passcodes can trigger the network limit.

**Teams cannot see the motion on their portal.**
Release the motions for the round on the Motions page and make sure the release has been uploaded (releases upload
and publish in one step when you are online).

**Emailing private URLs is refused.**
Either a participant has no private URL or passcode yet (generate them on the Private URLs page), or one email
address belongs to two different participants. Fix the duplicate address and try again.

**Will search engines index our tournament or participants' links?**
Private URLs, the projector and every tab-room page are excluded from crawling and marked `noindex`. For public
pages, choose **Search engines** under Configuration → Public visibility: every page, only the public homepage, or
none. Search engines may ignore `noindex`, so it is not a privacy control, and the sitemap is refreshed at most every
six hours. See [Caching, indexing and performance](Caching-Indexing-and-Performance).

## Draws

**"Number of teams (…) must be divisible by …".**
Mark the right teams available for the round, add a swing team (Draw page, **Swing teams**), or set *Bye team
selection method* to *Lowest ranked* or *Random*. See [Rounds and draws](Rounds-and-Draws).

**The draw failed because of a side limit.**
*Maximum allowed side imbalance* is a hard limit. Raise it (0 turns it off) or adjust the draw by hand.
*Maximum times per side* does not block a draw.

**"Every team needs a seed for a seeded draw."**
Seeded and round-robin draws need a seed for every team. Set them in the draw setup panel on the Draw page, or import
them with the team seed column.

**Can I regenerate a draw?**
Yes. If ballots exist you are warned that they will be discarded (kept in history, no longer counting). A confirmed
or released draw needs a reason. Only regenerate if the round was not debated as drawn.

**Can I run a format with three, five or six teams per room?**
Yes: the *N teams per room* format. As in Tabbycat, it supports random and manual draws only; power-paired, seeded
and round-robin draws, side rules and generated elimination draws are refused. A random draw puts any remainder in
a short last room, or gives byes if a bye method is set. See [Tournament setup and formats](Tournament-Setup-and-Formats).

## Results

**I can't confirm a ballot I entered.**
With double entry on, a different person must check it.

**"… is declared the winner with a lower total. Low-point wins are not allowed."**
Fix the scores, or set *Deciding the winner* (tournament settings, results rules) to allow low-point wins if your
rules permit them. See [Ballots and results](Ballots-and-Results).

**"… speaks more than once".**
Mark the extra speech as an iron-person (ghost) speech.

**Published results disappeared from the public page.**
Confirming a changed ballot, or discarding the confirmed one, withdraws the round's results and team speaks release.
Check the result and release it again.

**An adjudicator's private-URL ballot does not show up.**
Private-URL ballots go to the cloud. For the active round they reach administrator devices live; for other rounds use
**Download and compare** or reload. Depending on *Ballots submitted through private URLs*, a chair's ballot either
counts at once or waits unconfirmed for the tab room. It never replaces a ballot the tab room already confirmed.

## Language

**How do I change the interface language?**
For yourself: account menu → language (or the language menu on public pages). For participants: Configuration →
Public visibility → **Public pages and portals language**; a viewer's own choice still wins. All languages other than
English are machine-drafted and need review. Emails and some server messages are still in English. See
[Languages and translations](Languages-and-Translations).

## Hosting and quota

**Are we within the free Firestore quota?**
Public audience size barely matters: public pages are served from cached snapshots. Reads come mainly from opening
the tournament on admin devices, uploads, downloads and private-URL use. A 100-team event with a few admin devices
stays well inside Spark's 50,000 reads a day. A 1000-team event's first upload is about 10,000 writes, so plan on the
Blaze plan for events that size. Upload when you need to, not constantly. See
[Deploying to Vercel and Firebase](Deploying-to-Vercel-and-Firebase#staying-inside-the-spark-budget) and
[Caching, indexing and performance](Caching-Indexing-and-Performance).

**Can I run it without Firebase?**
Without Firebase configured nobody can sign in, so no tournament can be created, and there are no public pages,
private URLs, staff accounts or email. In practice a Firebase project is required.

Still stuck? Open an issue on [GitHub](https://github.com/The-Studio-of-Sadiq/crabbytab/issues). Never include
participant data or credentials.
