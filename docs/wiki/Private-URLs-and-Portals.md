# Private URLs and portals

Each team and adjudicator has a **private URL** and a separate **passcode**. You can also give each
speaker their own. The portal behind the link lets participants see their own draw, enter ballots
(adjudicators), give feedback and check themselves in. They do not need an account.

| Link | Opens |
| --- | --- |
| `/{slug}/private/team/{key}` (`team_…`) | The team portal |
| `/{slug}/private/speaker/{key}` (`spk_…`) | The same team portal, with the speaker's own passcode |
| `/{slug}/private/adjudicator/{key}` (`adj_…`) | The adjudicator portal |

## Generating credentials

Teams and adjudicators get a key and a passcode when they are added, by hand, CSV import or
registration. Manage them on sidebar → **Public → Private URLs** (administrators only):

- **Adjudicators** / **Teams** tabs, with a search box. Each row has buttons to copy the link and
  the passcode, open the portal as that participant, and generate a passcode if one is missing.
- **Ensure all credentials assigned** fills in any missing keys and passcodes.
- **Regenerate all private keys** issues new keys for everyone, after a confirmation. Every link you
  already gave out stops working.
- **Copy current list** copies the filtered table.
- **Print QR slips** prints one slip per participant in the current list: name, QR code, link and,
  with **Passcodes on slips** ticked, the passcode. QR codes are made in the browser; nothing is
  sent to a third party.
- **Speaker private URLs (optional)** (Teams tab): **Create speaker links** gives every speaker
  without a link a key and passcode of their own. **Remove speaker links** deletes them all. Team
  links and passcodes never change because of this, so printed slips keep working.

Keys are 12 characters from an alphabet without look-alike characters, after the prefix. Passcodes
are also 12 characters.

**Upload after any change.** Portals read the cloud copy, so new or changed links work only after
you upload. You can also send links and passcodes by email with the `{{private_url}}` and
`{{passcode}}` placeholders ([Email and notifications](Email-and-Notifications)).

## Settings that affect portals

| Setting | Where | Default |
| --- | --- | --- |
| Ballot submissions from adjudicators through private URLs | Admin → Assistants → Staff access and private-URL ballots | on |
| Ballots submitted through private URLs: the chair confirms / the tab room confirms | same card | the chair |
| Individual ballots from every voting adjudicator | same card (two-team voting tournaments) | off |
| Allow self-split ballots for solo adjudicators | same card | off |
| Feedback submissions through private URLs | same card | on (needs feedback switched on) |
| Self check-in from private URLs | Configuration → Public visibility | off |
| Scoresheets on team private URLs | Standings → Public release | hidden |
| Team / participant code names | Configuration → Public visibility | off |
| Public pages and portals language | Configuration → Public visibility | viewer's browser |

## Signing in

The participant opens the link and types the passcode. **Remember me on this device** keeps the
passcode in that browser. A wrong passcode and an unknown link get the same answer, so links cannot
be guessed one at a time.

Limits: 300 requests an hour per link, and 100 failed attempts an hour per network address per
tournament. Over a limit the portal gets *429 Too Many Requests* with a retry time.

## What portals show, by draw stage

| Draw stage (Draw page) | Team portal | Adjudicator portal |
| --- | --- | --- |
| Draft, or Confirmed (not released) | Nothing for that round | Nothing for that round |
| **Released to teams only** | Own room, side and opponents. No panel. | Nothing. Ballots cannot be entered. |
| **Released to public** | The same, plus the panel once **Reveal Adjudicators** is on | Their debate: room, teams and sides, the full panel and their role. Ballot entry opens. |

Then, per round:

| Release | Team portal |
| --- | --- |
| Motions released | The motion. Before that it says the motion will be announced. |
| Results published (round not silent, public results on) | Win/loss or points |
| Team speaks published | Speaker scores and totals |
| Scoresheets on team private URLs released | Every adjudicator's full sheet for the team's own debates once results are published, even before team speaks. The panel must be revealed. |

Both portals open on the current round. **All rounds & history** lists earlier rounds. Room links
(online rooms, maps) are shown for rounds still running.

## Team portal

- The team's speakers and their debates, as in the table above.
- **Feedback on adjudicators** once the panel is revealed. If the chair dissented, the form asks
  the team to rate the panellist who gave the oral adjudication instead. **Feedback on opponent
  teams** when the feedback paths allow it.
- Self check-in for the current round, if switched on.
- **Teams cannot submit ballots.** The server refuses them.
- Other teams appear under their code names in the code-name modes; the team's own name stays real.
  With participant code names on, other teams' speakers and the adjudicators appear under theirs.

## Adjudicator portal

- **Debates Assigned**, with their role (chair, panellist, trainee).
- **Ballot entry** for chairs and voting panellists. Trainees see *Trainees may observe but cannot
  submit ballots.* If private-URL ballots are off, they see *Ballots are not submitted online at
  this tournament.*
  - The form follows the round's ballot rules (speaker scores or results only, ranks, BP or
    two-team, N-team rooms). It asks which team took which side if sides were not set by the draw.
    With several motions it asks which was debated (never pre-filled) and each team's veto, when
    vetoes are on.
  - With **the chair confirms**, a chair's ballot counts at once. With **the tab room confirms**,
    every ballot waits. With individual ballots on, each voting adjudicator's sheet is stored
    unconfirmed and the sheets are merged when they are complete and agree. A solo adjudicator may
    declare a 2:1 split when self-split is allowed.
  - If the tab room already confirmed the debate's result, or the round is completed or its results
    are published, the ballot is stored unconfirmed for the tab room and changes nothing.
  - A ballot receipt email is sent if receipts are on.
  - More: [Ballots and results](Ballots-and-Results).
- **Feedback** on other adjudicators and on teams, as the feedback paths allow.
- Self check-in for the current round, if switched on.
- Speaker names stay real here (the adjudicator needs them for the ballot). Other adjudicators
  appear under code names when participant code names are on.

## Self check-in

With **Self check-in from private URLs** on, both portals show a check-in panel for the current
round: the earliest round that is neither cancelled nor completed. Other rounds are refused. The
check-in is written to the cloud copy and reaches your device on the next download or tournament
open. If you edited that participant on your device in the meantime, it shows up as a sync conflict
for you to resolve. See [Check-ins and availability](Check-ins-and-Availability).

## Working offline

A ballot or feedback submitted without a connection is kept in the browser (*Saved on this device;
it will sync when you are online.*) and sent when the device is back online.

## Where submissions go

The server writes portal submissions straight to the **cloud copy**, not to your device. Each write
bumps the record's version, so an older upload from a tab-room device cannot silently overwrite
it. Download (or use live sync) to see them in the tab room. See
[Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).

## Security notes

- Anyone with the link **and** the passcode can act as that participant. If slips are lost,
  regenerate all keys and upload. (The page has no button to change one participant's passcode.)
- A speaker's link opens only their own team, and only with that speaker's passcode. A removed
  speaker's link opens nothing.
- Keys and passcodes are visible to administrators only. Data-entry staff never receive them, and
  they are never published or returned by the REST API.
- The REST API's `/me` endpoints accept the same key and passcode, so participants can use apps
  built on it ([API and tokens](API-and-Tokens)).

## Differences from Tabbycat

- Speaker links are optional; Tabbycat gives every speaker one. Team links remain the default.
- Private URLs and public forms are separate switches. In Tabbycat "private URLs" and "public" are
  exclusive choices.
- Portal check-in, ballots and feedback reach the tab room through the cloud copy, not instantly.

## Details

- A portal load reads only the participant's own debates (through a participant index), their
  teams and ballots, and the rounds. Rounds are sent with a whitelist of fields, so preformed
  panels, pre-allocated sides and draw seeds never reach participants.
- The adjudicator portal shows the debate's motion as soon as the draw is released, without
  waiting for the motion release. In rounds with several motions, it also receives the round's
  motions so the ballot can ask which was debated.
- Developer detail:
  [public-pages-and-notifications.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/public-pages-and-notifications.md)
  (speaker private URLs, QR slips, self check-in),
  [results-and-ballots.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/results-and-ballots.md),
  [staff-access.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/staff-access.md).
