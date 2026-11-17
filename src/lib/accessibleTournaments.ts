import { FieldPath, type DocumentData, type DocumentReference, type Firestore, type QuerySnapshot } from "firebase-admin/firestore";
import { resolveTournamentAccessRole, type TournamentAccessRole } from "@/lib/tournamentAccess";

export interface AccessibleTournament {
  id: string;
  data: DocumentData;
  role: Exclude<TournamentAccessRole, null>;
}

/** Firestore's FAILED_PRECONDITION: here, the collection-group index on staff is not enabled. */
const FAILED_PRECONDITION = 9;

/** `admins.<uid>`: a plain string for ordinary uids, a FieldPath for one with dots or other symbols. */
function adminsFieldPath(uid: string): string | FieldPath {
  return /^[A-Za-z0-9_]+$/.test(uid) ? `admins.${uid}` : new FieldPath("admins", uid);
}

/**
 * Staff records (tournaments/{id}/staff/{uid}) for this account, found by the `uid` field written
 * since staff records carry one, or by the account's email for older records. A record counts only
 * if its document id is the account's uid, so a matching email alone never grants anything.
 * Needs the collection-group index on `staff` (docs/firestore-indexes.md).
 */
async function staffRecordsFor(firestore: Firestore, uid: string, email: string | undefined) {
  const queries: Array<Promise<QuerySnapshot>> = [firestore.collectionGroup("staff").where("uid", "==", uid).get()];
  const emails = [...new Set([email?.trim(), email?.trim().toLowerCase()].filter((value): value is string => Boolean(value)))];
  if (emails.length > 0) queries.push(firestore.collectionGroup("staff").where("email", "in", emails).get());
  const records = new Map<string, { tournamentRef: DocumentReference; role: unknown }>();
  for (const snapshot of await Promise.all(queries)) {
    for (const document of snapshot.docs) {
      const tournamentRef = document.ref.parent.parent;
      if (document.id !== uid || !tournamentRef || tournamentRef.parent.id !== "tournaments") continue;
      records.set(tournamentRef.id, { tournamentRef, role: document.data().role });
    }
  }
  return records;
}

/**
 * Every tournament with a role read from the whole `tournaments` collection (and one staff record
 * per tournament). Costs about two reads per tournament in the database, so it is only the fallback
 * for when the staff collection-group index is missing.
 */
async function scanAllTournaments(firestore: Firestore, uid: string, globalAdmin: boolean) {
  const tournaments = await firestore.collection("tournaments").get();
  const listed = await Promise.all(tournaments.docs.map(async (document): Promise<AccessibleTournament | null> => {
    const data = document.data();
    const staff = await document.ref.collection("staff").doc(uid).get();
    const role = resolveTournamentAccessRole(
      { ownerId: data.ownerId, admins: data.admins && typeof data.admins === "object" ? data.admins : undefined },
      uid,
      staff.data()?.role,
      globalAdmin
    );
    return role ? { id: document.id, data, role } : null;
  }));
  return listed.filter((tournament): tournament is AccessibleTournament => tournament !== null);
}

/**
 * The cloud tournaments this account owns, administers or is staff on, read with targeted queries:
 * the reads grow with the account's own tournaments, not with every tournament in the database.
 *
 * A global admin may open any tournament, but is listed only their own here; they find the others
 * with search (docs/offline-and-accounts.md). Listing every tournament cost one read per tournament
 * in the database on every visit to the home page or My tournaments.
 */
export async function listAccessibleTournaments(input: {
  firestore: Firestore;
  uid: string;
  email?: string;
  globalAdmin: boolean;
}): Promise<AccessibleTournament[]> {
  const { firestore, uid, email, globalAdmin } = input;
  const tournaments = firestore.collection("tournaments");
  const [owned, administered] = await Promise.all([
    tournaments.where("ownerId", "==", uid).get(),
    tournaments.where(adminsFieldPath(uid), "==", true).get(),
  ]);

  let staff: Awaited<ReturnType<typeof staffRecordsFor>>;
  try {
    staff = await staffRecordsFor(firestore, uid, email);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== FAILED_PRECONDITION) throw error;
    console.warn(
      "The collection-group index on staff (uid, email) is missing; see docs/firestore-indexes.md. " +
        (globalAdmin ? "Listing owned and administered tournaments only." : "Reading every tournament instead.")
    );
    if (!globalAdmin) return scanAllTournaments(firestore, uid, globalAdmin);
    staff = new Map();
  }

  const documents = new Map<string, DocumentData>();
  for (const document of [...owned.docs, ...administered.docs]) documents.set(document.id, document.data());
  const missing = [...staff.values()].filter(({ tournamentRef }) => !documents.has(tournamentRef.id));
  if (missing.length > 0) {
    for (const snapshot of await firestore.getAll(...missing.map(({ tournamentRef }) => tournamentRef))) {
      const data = snapshot.data();
      if (data) documents.set(snapshot.id, data);
    }
  }

  const listed: AccessibleTournament[] = [];
  for (const [id, data] of documents) {
    const role = resolveTournamentAccessRole(
      { ownerId: data.ownerId, admins: data.admins && typeof data.admins === "object" ? data.admins : undefined },
      uid,
      staff.get(id)?.role,
      globalAdmin
    );
    if (role) listed.push({ id, data, role });
  }
  return listed;
}
