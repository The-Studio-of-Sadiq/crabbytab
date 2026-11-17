# Firestore indexes

Most queries use the single-field indexes Firestore creates on its own. One needs setting up.

## Staff records across tournaments (collection group `staff`)

The tournament list (`GET /api/tournaments`, `src/lib/accessibleTournaments.ts`) finds the
tournaments an account is staff on with collection-group queries on `staff`:

- `uid ==` (staff records written since they carry the account's uid);
- `email in` (older staff records, which carry only the email).

Firestore does not enable collection-group single-field indexes on its own. Enable them once per
project: Firebase console → Firestore → **Indexes** → **Single field** → **Add exemption**:

| Collection ID | Field  | Query scope      | Ascending |
| ------------- | ------ | ---------------- | --------- |
| `staff`       | `uid`  | Collection group | Enabled   |
| `staff`       | `email`| Collection group | Enabled   |

Until they exist the list still works: for a global admin it lists their owned and administered
tournaments only; for other accounts it falls back to reading every tournament (about two reads per
tournament in the database), and the server logs a warning pointing here.

### Why

Listing an account's tournaments used to read the whole `tournaments` collection, plus one staff
record per tournament for accounts that are not global admins, on every visit to the home page,
**My tournaments** and the motions bank. With these queries the reads grow with the account's own
tournaments, not with the database.

### Known limitation

An older staff record (no `uid` field) is found by the email it was saved with. If the account's
email has changed since, that tournament is not listed until the staff record is saved again (for
example by re-assigning the role). Access itself is unaffected: it is checked by uid.
