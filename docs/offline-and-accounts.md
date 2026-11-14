# Offline use and accounts

CrabbyTab keeps every tournament's working copy on the device (`storage-and-scale.md`). The cloud
(Firebase) is for sharing a tournament between devices and with the public; it is not needed to
run one.

## Device-only tournaments

A tournament that has never been uploaded exists only on this device: its settings carry no cloud
`syncVersion` (`isDeviceOnlyTournament` in `src/lib/tournamentAccess.ts`). On its admin pages:

- **No account is needed.** Whoever holds the device runs it, signed in or not, online or offline,
  and with or without Firebase configured. `TournamentChrome` does not send a signed-out visitor
  to sign in, and the tournament loader opens the working copy without asking the cloud anything.
- **No role check.** The server has never seen the tournament, so the staff-access check is skipped.
- **Shared routes stay protected.** On `/display`, `/public` and private URLs a signed-out viewer is
  never an administrator, device-only tournament or not, so a projector or a visitor at the venue
  never sees unrevealed panels or unreleased data (`isViewerTournamentAdmin`).

Uploading the tournament (to share it between devices or publish it) needs a signed-in account;
from then on it is a cloud tournament.

## Cloud tournaments

A tournament with a cloud copy needs the account that may administer it: sign-in, then a role
check with the server (`/api/tournaments/{id}/access`), repeated at most every 10 minutes
(`STAFF_ACCESS_RECHECK_MS`, `staffAccessCheck.ts`). Signed in once, the device keeps working
offline: Firebase keeps the session, and the role last verified on this device applies until the
server can be asked again. Server routes and Firestore rules check access on every request either
way.

## My tournaments

`tournamentsToList` (`features/tournament/application/tournamentList.ts`):

- device-only tournaments are always listed;
- signed in and online, cloud copies on the device are listed if the server lists them for this
  account (or for a global admin);
- signed out, or with the server unreachable, every tournament on the device is listed, with the
  error shown above the list.

## Creating tournaments

Creating a tournament (the wizard) is limited to global administrators, by decision: it controls
who may start tournaments on a hosted instance. A device-only tournament therefore starts from an
administrator's device; once there, it runs signed out, offline and without Firebase as above.

## Known limitations

- The home page (`/`) lists and creates tournaments under its own rules; **My tournaments**
  (`/tournaments`) is the page that lists device-only tournaments in every case.
