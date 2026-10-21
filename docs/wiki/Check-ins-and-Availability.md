# Check-ins and availability

Availability decides which teams are drawn and which adjudicators are allocated in a round. It is managed on the round's **Availability** page (sidebar → *Round · R1* → **Availability**, `/{slug}/checkins`). Administrators and staff with the check-in permission can use it.

## How availability works

- Teams and adjudicators are available or absent **per round**. A per-round value overrides the older tournament-wide check-in flag.
- **Anyone with no availability record counts as available.** Imported and newly added participants are therefore present by default. Mark people *absent* to leave them out. (Tabbycat works the other way round: nobody is in until checked in.)
- **Check-in expiry** (*Admin → Configuration → Public visibility → Check-in expiry*, hours; 0 = never, the default): a timestamped check-in older than this no longer counts. Records without a timestamp are unaffected.
- The **draw** uses team availability. **Allocation** uses adjudicator availability unless *Skip adjudicator check-ins* is on (*Configuration → Draw rules*).
- **Rooms** have their own availability (default and per round, set on Setup → Venues) and a check-in tick; see [Venues and constraints](Venues-and-Constraints).
- Swing teams are available only in the rounds they were created or reused for.

## The Availability page

Pick the round at the top. The page shows:

- Tabs **Teams (present/total)**, **Adjudicators (present/total)** and **Venues (present/total)**, each with a search box and a per-row **Present / Absent** toggle. Expired check-ins are marked *Expired*; each row shows when it was checked in.
- **Speakers** under each team, each with their own check-in toggle (see below).
- **Mark all present**.
- **Copy availability from R(n−1)**: everyone without an explicit setting for this round gets their availability in the previous round (present or absent).
- **Mark breaking adjudicators present**: checks in every adjudicator flagged *Breaking*.
- **Print barcode labels**: Code 39 labels for teams, speakers, adjudicators and venues.
- **Barcode check-in**: a scan box and, where supported, **Use camera**.
- **Check-in history**: the round's 25 most recent changes, with the source (tab room, barcode, bulk, self check-in) and who made them.
- **Public status**: a link to the public check-in page.

### Speaker check-in

Each speaker can be checked in for a round (toggle on the Teams tab, or scan the speaker's barcode). When every speaker of a team is in, the team becomes available. Checking a speaker out does **not** withdraw the team; mark the team absent for that.

### Barcodes and scanners

- Scan with a USB or keyboard-wedge scanner into the scan box (most type the code and press Enter); you can also paste an id. The code is matched to a team, speaker, adjudicator or venue, and that record is checked in for the selected round. Unknown codes show *No team, adjudicator, or venue matches that barcode.*
- **Use camera** works in browsers with the `BarcodeDetector` API; otherwise use a USB scanner.

### What other devices see

For cloud tournaments, team and adjudicator availability is **live** on administrator devices: a check-in made on one device reaches the others within seconds, and goes into the queue while offline. Data-entry staff's check-ins reach administrators when the staff device syncs. Two devices changing different rounds never undo each other; the same field changed on both is last-write-wins. Room availability still travels with **Upload now**.

## Self check-in

With **Self check-in from private URLs** on (*Configuration → Public visibility*), team and adjudicator [private URLs](Private-URLs-and-Portals) show a check-in panel for the **current check-in round**: the earliest round that is neither cancelled nor completed. Participants mark themselves present or absent. Requests are passcode-checked and rate-limited, and refused for any other round. The API offers the same as `PUT /me/checkin`.

Self check-ins are written to the cloud copy. A live administrator device receives them within seconds. A device that is not live sees them after **Download and compare** or a reload; if that device changed the same participant in the meantime, the participant is listed as a sync conflict for you to resolve rather than being silently overwritten.

## Public check-in status

With **Public check-in counts** on (*Configuration → Public visibility*), `/{slug}/checkins/public` shows, per round, how many teams and adjudicators are present out of the total. When the participants list is also public, it lists each team and adjudicator with whether they are checked in for a chosen round. Names follow the public naming rules (team code names, participant code names; anonymous adjudicators are counted but not listed). The page refreshes every 30 seconds from the published public snapshot, so changes appear after the next publish (an upload or release).

## Data-entry staff

[Data-entry staff](Staff-and-Roles) with the check-in permission can use the Availability page; speaker check-ins change the team's speakers, so they also need the participant-editing permission. Their changes reach the cloud when their device syncs.

## Details

- Every change made on the page or by self check-in is recorded on the record itself (time, round, present/absent, source and the staff member's name), at most 50 entries per record; the server appends self check-ins without that cap.
- **Room check-in expiry** (*Configuration → Public visibility*) marks rooms checked in longer ago than that as expired. It does not change whether a room is allocated.
- Availability is exported with Admin → **Data exports → Availability** (every team, adjudicator and venue × every round).
- API: availability and check-in endpoints under `/rounds/{seq}/availabilities` and `/…/checkin` (`write:checkins`); speaker check-in through the API checks in the whole team. See [API and tokens](API-and-Tokens).
- Logic: `src/lib/roundAvailability.ts`, `src/lib/selfCheckIn.ts`, `src/lib/checkins/`. Developer details: [`docs/public-pages-and-notifications.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/public-pages-and-notifications.md).
