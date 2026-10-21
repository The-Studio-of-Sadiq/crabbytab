import { customPermissionGroupsRef } from "@/lib/staffAccessServer";
import { FieldPath, type DocumentReference, type Firestore, type Query, type Transaction } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { checkPrivateApiRateLimit } from "@/lib/privateTeamRateLimit";
import {
  MAX_QUERY_LIMIT,
  type ApiCollection,
  type ApiStore,
  type QueryOptions,
  type StoredRecord,
  type TournamentReader,
  type TournamentStore,
  type TournamentTransaction,
} from "./store";

function toRecord(snapshot: { id: string; exists: boolean; data(): Record<string, unknown> | undefined }): StoredRecord | null {
  return snapshot.exists ? { ...(snapshot.data() ?? {}), id: snapshot.id } : null;
}

function buildQuery(tournamentRef: DocumentReference, collection: ApiCollection, options: QueryOptions): Query {
  let query: Query = tournamentRef.collection(collection);
  for (const filter of options.filters ?? []) query = query.where(filter.field, filter.op, filter.value);
  query = query.orderBy(FieldPath.documentId());
  if (options.after) query = query.startAfter(options.after);
  return query.limit(Math.min(Math.max(1, options.limit), MAX_QUERY_LIMIT));
}

function reader(
  firestore: Firestore,
  tournamentRef: DocumentReference,
  transaction?: Transaction
): TournamentReader {
  const getDocument = (ref: DocumentReference) => (transaction ? transaction.get(ref) : ref.get());
  return {
    async getTournament() {
      return toRecord(await getDocument(tournamentRef));
    },
    async get(collection, id) {
      return toRecord(await getDocument(tournamentRef.collection(collection).doc(id)));
    },
    async getMany(collection, ids) {
      if (ids.length === 0) return [];
      const refs = ids.map((id) => tournamentRef.collection(collection).doc(id));
      const snapshots = transaction ? await transaction.getAll(...refs) : await firestore.getAll(...refs);
      return snapshots.map(toRecord).filter((record): record is StoredRecord => record !== null);
    },
    async query(collection, options) {
      const query = buildQuery(tournamentRef, collection, options);
      const snapshot = transaction ? await transaction.get(query) : await query.get();
      return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
    },
  };
}

function tournamentStore(firestore: Firestore, tournamentId: string): TournamentStore {
  const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
  return {
    tournamentId,
    ...reader(firestore, tournamentRef),
    async getCustomPermissionGroups() {
      // Server-only document (lib/staffAccessServer.ts customPermissionGroupsRef).
      return (await customPermissionGroupsRef(tournamentRef).get()).data()?.groups ?? [];
    },
    transaction(fn) {
      return firestore.runTransaction(async (transaction) => {
        const scoped: TournamentTransaction = {
          ...reader(firestore, tournamentRef, transaction),
          set(collection, id, data) {
            transaction.set(tournamentRef.collection(collection).doc(id), data);
          },
          setTournament(data) {
            const { id: _id, ...rest } = data;
            transaction.set(tournamentRef, rest);
          },
        };
        return fn(scoped);
      });
    },
  };
}

export function createFirestoreApiStore(firestore: Firestore = getAdminFirestore()): ApiStore {
  return {
    async findTournamentBySlug(slug) {
      const matches = await firestore.collection("tournaments").where("slug", "==", slug).limit(2).get();
      // An ambiguous slug is treated as unknown rather than guessing which tournament is meant.
      if (matches.size !== 1) return null;
      const document = matches.docs[0];
      return { ...document.data(), id: document.id };
    },
    forTournament(tournamentId) {
      return tournamentStore(firestore, tournamentId);
    },
    async findToken(tournamentId, tokenHash) {
      const snapshot = await firestore.collection("tournaments").doc(tournamentId).collection("apiTokens")
        .where("tokenHash", "==", tokenHash)
        .limit(1)
        .get();
      const document = snapshot.docs[0];
      return document ? { ...document.data(), id: document.id } : null;
    },
    async touchToken(tournamentId, tokenId, at) {
      await firestore.collection("tournaments").doc(tournamentId).collection("apiTokens").doc(tokenId)
        .update({ lastUsedAt: at });
    },
    consumeHourlyRateLimit(key, maxPerHour, now) {
      return checkPrivateApiRateLimit(firestore, key, "api-v1-write", maxPerHour, now);
    },
  };
}
