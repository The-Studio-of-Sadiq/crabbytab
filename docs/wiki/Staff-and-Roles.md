# Staff and roles

CrabbyTab uses Firebase Authentication (email and password). There is **no open sign-up**: an account is created either by the site operator in the Firebase console or by accepting a **staff invitation** (below). Users sign in at `/login`, reset a forgotten password at `/forgot-password` and change it at `/account/password` (account menu).

## Roles

| Role | How someone gets it | Can do |
| --- | --- | --- |
| **Global administrator** | UID listed in the server variable `FIREBASE_ADMIN_UIDS` | Everything, on every tournament. The only role that can **create tournaments**, import a DebateXML archive and open the demo (Tournaments hub). |
| **Tournament owner** | Created the tournament (or first uploaded it) | Everything on that tournament, including changing its `admins` list. |
| **Tournament administrator** | In the tournament's admins list, or given *Tournament administrator* on **Tournament access** | Everything on that tournament (Tabbycat's tab director): setup, draws, allocation, results, releases, private URLs, email, API tokens, backups, audit log. Cannot change the owner or the admins list. |
| **Data-entry staff** | Given *Data-entry staff* on **Tournament access** | What their **permission groups** allow (below), capped by the tournament's staff access level. |
| **Participant** (no account) | Private URL (and passcode) | Own draw, ballots, feedback, self check-in. See [Private URLs and portals](Private-URLs-and-Portals). |
| **Public** (no account) | — | Released public pages and enabled public forms only. See [Public pages and releases](Public-Pages-and-Releases). |

Signed-out visitors are never administrators, even for a tournament saved on their device.

### Global administrators

On every sign-in the server compares the account's UID with `FIREBASE_ADMIN_UIDS` and adds or removes the `globalAdmin` custom claim; `firestore.rules` trust that claim. After changing the variable, redeploy and have the person sign in again.

## Giving people access

Everything is on **Admin → Assistants** (the page is titled *Tournament access*, also at `/{slug}/staff`), administrators only. Staff roles live in the cloud, so the tournament must have been uploaded.

### Invite by email (works with or without an account)

1. Under **Invite by email**, enter up to 50 addresses (separated by spaces, commas, semicolons or new lines), pick the role and how long the link stays valid (1–30 days, default 7), then **Send invitations**.
2. Each address receives a single-use link to `/invite`. The invitee signs in (existing account) or chooses a name and password (at least 8 characters); the server creates the account for exactly the invited address and grants the role in one step. A role is granted only to an account with the invited email; an existing higher role is never lowered.
3. The list shows open invitations (pending or expired) with delivery status. **Resend** issues a new link (the old one stops working) and restarts the expiry; **Revoke** stops it at once.

If an email cannot be sent (no SMTP, or the provider refused it), the invitation is still created and its link is shown **once** so you can share it another way. Only a hash of the link is stored; to get a new link, resend. The staff list does not refresh by itself when someone accepts; reload the page.

### Assign existing accounts

Under **Assign existing accounts**, enter up to 100 email addresses of existing accounts, choose **Data-entry staff** (default) or **Tournament administrator**, and **Assign selected access**. Unknown addresses are reported as not found; no account directory is exposed. Assigned staff see the tournament on the Tournaments hub.

Removing someone (bin icon, then confirm) deletes only their staff assignment; the owner and the tournament's `admins` list are not changed here. Uploads never change the owner or administrators of a cloud tournament.

## Permissions

Each data-entry staff member has one or more permission groups (tick them under the person in **Assigned to this tournament**, then **Save groups**). A member with no group ticked gets the Tabulation assistant set. Changes apply to the person's next request.

| Permission | Allows | Enforced by |
| --- | --- | --- |
| Enter ballots (`results.enter`) | Enter ballots; they are always stored unconfirmed | data-entry sync route, Firestore rules (live ballot create) |
| Confirm others' ballots (`results.confirm_others`) | Confirm, or blind-check, a ballot someone else entered | assistant-ballots route |
| Receive paper ballots (`ballots.intake`) | Record paper ballots arriving | data-entry sync route |
| Enter feedback (`feedback.enter`) | Enter feedback | data-entry sync route |
| Check-ins and availability (`checkins.edit`) | Check-in and availability of teams and adjudicators; check existing rooms in | data-entry sync route, Firestore rules (live check-in update) |
| Edit participants (`participants.edit`) | Add and edit teams, adjudicators and institutions (break/speaker categories and scores only when creating a record) | data-entry sync route |
| Draw display before release (`draw.display`) | See confirmed draws before release and project them on `/display` | assistant-data route |
| Motions before release (`motions.display`) | See a round's motions before release and reveal them on `/display` | assistant-data route |
| See conflicts (`conflicts.view`) | Adjudicator and team–institution conflicts | assistant-data route |
| Edit conflicts (`conflicts.edit`) | Change those conflicts (only with `conflicts.view`) | data-entry sync route |
| See feedback and adjudicator scores (`feedback.view`) | Feedback scores, comments and answers; adjudicators' base/test scores, score history, breaking and adjudication-core flags | assistant-data route |
| Edit adjudicator scores and breaking (`adjudicators.scores_edit`) | Change base and test scores (also in bulk), breaking status and the tester flag; recorded in the score history | data-entry sync route |
| Edit adjudicator allocations (`allocation.edit`) | Change panels of draws they can see, including unrevealed panels | data-entry sync route (one transaction per round), assistant-data route |
| See standings, break and analytics (`standings.view`) | Standings, break and analytics pages, and results of silent and unreleased rounds | assistant-data route |

### Groups

| Group | Permissions | Tabbycat equivalent |
| --- | --- | --- |
| Tabulation assistant (default) | The first eight permissions above (fixed: new permissions never widen it) | Tabulation Assistant |
| Ballot desk | Enter ballots, confirm others' ballots, receive paper ballots | — |
| Check-in desk | Check-ins and availability | — |
| Feedback desk | Enter feedback | — |
| Equity | See conflicts, edit conflicts | Equity |
| Adjudication core | See feedback and scores, edit scores and breaking, edit allocations, see conflicts, draw display, motions before release, see standings | Adjudication Core |

**Custom permission groups** (same page): give a group a name and any set of the permissions above. Names must be unique and `conflicts.edit` needs `conflicts.view`. Saving recomputes every data-entry member's permissions at once. A member of a deleted group keeps the group id but gets nothing from it.

### Staff access level

**Staff access and private-URL ballots → Data-entry staff access** caps every data-entry member. It is a tournament setting, so it reaches the server with the next upload.

| Level | Effect |
| --- | --- |
| All areas (default) | No cap |
| Results entry and draw display | Removes *Motions before release* |
| Results entry only | Also removes *Draw display before release* and *Edit adjudicator allocations* |
| No access | Every data-entry account is refused by every staff route and by the Firestore rules |

The same card holds the private-URL ballot and feedback switches; see [Ballots and results](Ballots-and-Results) and [Private URLs and portals](Private-URLs-and-Portals). Public form settings on this page are covered in [Public pages and releases](Public-Pages-and-Releases).

## What data-entry staff see and do

- **Data.** Staff receive a filtered copy of the tournament from the server: no owner/admin details, no private URL keys or passcodes, no speaker or adjudicator emails or phone numbers, no audit log. Conflicts, scores and feedback contents only with the matching permission. Unreleased motions only with *Motions before release*; draft draws never; confirmed unreleased draws only with *Draw display before release* (otherwise only released or confirmed rounds for ballot entry); unrevealed panels only with *Edit adjudicator allocations*.
- **Results.** Ballots and debate points reach their device only for rounds they may see: every round with `standings.view`; rounds whose results are released; for ballot staff also rounds still being entered and completed rounds that are not silent.
- **Sidebar.** Links follow their permissions: Setup (Institutions, Teams, Adjudicators, Diversity, Code names, and Conflicts with `conflicts.view`); the round's Availability (`checkins.edit`), Allocation (`allocation.edit`) and Display (`draw.display`); Results; Feedback (`feedback.enter` or `feedback.view`); Standings, Break and Analytics (`standings.view`). Pages are also checked when opened directly.
- **Administrator-only pages:** Draw, Configuration, Assistants, Private URLs, Email, Audit log, Data exports, Rehearsal, API access, Registration, Schedule, and the Venues, Motions, Speaker categories, Adjudicator requirements and Room preferences setup pages. On the Break page, changing categories, generating the break and overrides stay administrator work; preformed panels too.
- **Ballot confirmation.** Staff with *Confirm others' ballots* confirm on the Results page by review or by blind re-entry (confirmed only if it matches). Nobody confirms their own entry. Refused: unpublished draws, cancelled or completed rounds, advanced eliminations and rounds whose results are released, and a version that is no longer the latest. Staff confirmations are recorded on the ballot, not in the audit log.
- **Syncing.** Their **Upload** sends only the records their permissions cover. A record changed by someone else in the meantime, or made from an outdated copy, is refused and kept on their device; allocations are checked per round (no adjudicator twice, no change to closed rounds or confirmed debates) and all-or-nothing per round.

## Details

- Server enforcement: the three staff routes (`assistant-data`, `data-entry-sync`, `assistant-ballots`) re-read the staff record inside each write transaction, so narrowing someone's groups applies to their next write. The Firestore rules check the same permissions on the two direct live writes staff make (ballot create, check-in update). Hidden links are never the only barrier. See [Security model](Security-Model).
- Invitation links are `{tournament}.{invitation}.{secret}` in the URL fragment (never sent to server logs); wrong tokens are throttled (30 failures per hour per address) and account creation is limited to 10 per address per hour. For defence in depth, turn off client sign-up in the Firebase console (Authentication → Settings → User actions).
- Invitations are only for cloud tournaments. Deleting a tournament does not delete its server-only records (invitations, custom groups).
- API tokens cannot change staff or group membership. See [API and tokens](API-and-Tokens).

## Differences from Tabbycat

- Equity leaves out room-constraint and participant-contact permissions (room preferences, emails and phone numbers stay administrator-only).
- Adjudication core cannot edit motions, feedback questions or releases; make those people administrators.
- Data-entry staff cannot merge individual ballots, and cannot clear a test score (only change it).

More: [staff-access.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/staff-access.md), [staff-invitations.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/staff-invitations.md).
