import type { BallotSubmission, Debate, Team } from "@/types";
import {
  PARTICIPANT_IDS_FIELD,
  PARTICIPANT_INDEX_DOCUMENT,
  PARTICIPANT_INDEX_VERSION,
  withoutParticipantIds,
} from "@/lib/privateSync";

/**
 * Participant-scoped reads for the private portals (server-side, firebase-admin). A portal load
 * reads the participant's own debates (`array-contains` on the debates' participant index), the
 * teams and ballots of those debates, instead of every team, debate and ballot of the tournament.
 * Callers still check assignment and release rules from the debate content itself.
 *
 * Typed structurally so tests can pass an in-memory stand-in for the admin SDK.
 */

type Data = Record<string, unknown>;
interface DocumentSnapshotLike {
  id: string;
  exists: boolean;
  data(): Data | undefined;
}
interface QuerySnapshotLike {
  docs: Array<{ id: string; data(): Data }>;
}
interface QueryLike {
  get(): Promise<QuerySnapshotLike>;
}
interface DocumentReferenceLike {
  get(): Promise<DocumentSnapshotLike>;
}
interface CollectionReferenceLike extends QueryLike {
  doc(id: string): DocumentReferenceLike;
  where(field: string, operator: "array-contains" | "in", value: unknown): QueryLike;
}
export interface TournamentReferenceLike {
  collection(name: string): CollectionReferenceLike;
}

/** Firestore's limit on values in an `in` query. */
const IN_QUERY_LIMIT = 30;

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

const isLive = (data: Data | undefined): data is Data => !!data && typeof data.deletedAt !== "string";

/** Whether every debate of the tournament carries the participant index (see `ensureParticipantIndex`). */
export async function hasParticipantIndex(tournamentRef: TournamentReferenceLike): Promise<boolean> {
  const marker = await tournamentRef.collection("data").doc(PARTICIPANT_INDEX_DOCUMENT).get();
  return marker.exists && marker.data()?.version === PARTICIPANT_INDEX_VERSION;
}

/**
 * Live debates that list `participantId` (a team or adjudicator id). Tournaments uploaded before the
 * index existed fall back to reading every debate; callers filter by content either way.
 */
export async function loadParticipantDebates(
  tournamentRef: TournamentReferenceLike,
  participantId: string
): Promise<{ debates: Map<string, Debate>; indexed: boolean }> {
  const indexed = await hasParticipantIndex(tournamentRef);
  const debatesRef = tournamentRef.collection("debates");
  const snapshot = indexed
    ? await debatesRef.where(PARTICIPANT_IDS_FIELD, "array-contains", participantId).get()
    : await debatesRef.get();
  const debates = new Map<string, Debate>();
  for (const document of snapshot.docs) {
    const data = document.data();
    if (isLive(data)) debates.set(document.id, withoutParticipantIds({ ...data, id: document.id }) as unknown as Debate);
  }
  return { debates, indexed };
}

/** The live teams with these ids. */
export async function loadTeamsById(
  tournamentRef: TournamentReferenceLike,
  teamIds: Iterable<string>
): Promise<Map<string, Team>> {
  const teamsRef = tournamentRef.collection("teams");
  // A participant's debates name a few dozen teams at most; one read each.
  const snapshots = await Promise.all([...new Set(teamIds)].map((id) => teamsRef.doc(id).get()));
  const teams = new Map<string, Team>();
  for (const snapshot of snapshots) {
    const data = snapshot.exists ? snapshot.data() : undefined;
    if (isLive(data)) teams.set(snapshot.id, { ...data, id: snapshot.id } as unknown as Team);
  }
  return teams;
}

/** The live ballots of these debates. */
export async function loadBallotsForDebates(
  tournamentRef: TournamentReferenceLike,
  debateIds: Iterable<string>
): Promise<BallotSubmission[]> {
  const ids = [...new Set(debateIds)];
  const ballotsRef = tournamentRef.collection("ballots");
  const snapshots = await Promise.all(
    chunked(ids, IN_QUERY_LIMIT).map((chunk) => ballotsRef.where("debateId", "in", chunk).get())
  );
  return snapshots.flatMap((snapshot) =>
    snapshot.docs.flatMap((document) => {
      const data = document.data();
      return isLive(data) ? [{ ...data, id: document.id } as unknown as BallotSubmission] : [];
    })
  );
}
