/**
 * An in-memory stand-in for the parts of the Firestore web SDK the repositories use (documents,
 * collections, equality queries, transactions and write batches). Tests install it with
 * `vi.mock("firebase/firestore", () => import("@/test/fakeFirestore"))` and inspect or seed
 * `fakeStore` directly. A transaction or batch commits all of its writes or none, and
 * `failAfterCommits` makes later commits throw, to simulate a connection dropping part-way.
 * `reads` and `writes` count documents as Firestore bills them (a query reads each returned
 * document, at least one), and audit events are append-only as in firestore.rules.
 */

type Data = Record<string, unknown>;

export interface FakeStore {
  documents: Map<string, Data>;
  commits: number;
  /** When set, every commit after this many successful ones throws. */
  failAfterCommits?: number;
  autoId: number;
  reads: number;
  writes: number;
}

export const fakeStore: FakeStore = { documents: new Map(), commits: 0, autoId: 0, reads: 0, writes: 0 };

export function resetFakeStore(): void {
  fakeStore.documents = new Map();
  fakeStore.commits = 0;
  fakeStore.failAfterCommits = undefined;
  fakeStore.autoId = 0;
  fakeStore.reads = 0;
  fakeStore.writes = 0;
}

/** firestore.rules: an existing audit event can never be overwritten. */
function assertWritable(path: string): void {
  if (/\/auditEvents\/[^/]+$/.test(path) && fakeStore.documents.has(path)) {
    throw Object.assign(new Error("permission-denied: audit events are append-only"), { code: "permission-denied" });
  }
}

/** Documents directly inside a collection path, as plain records with their ids. */
export function collectionRecords(path: string): Array<Data & { id: string }> {
  const prefix = `${path}/`;
  return [...fakeStore.documents.entries()]
    .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
    .map(([key, data]) => ({ ...structuredClone(data), id: key.slice(prefix.length) }));
}

interface DocRef { kind: "doc"; path: string; id: string }
interface CollectionRef { kind: "collection"; path: string }
interface QueryRef { kind: "query"; path: string; filters: Array<{ field: string; value: unknown }>; max?: number }
type Constraint = { kind: "where"; field: string; value: unknown } | { kind: "limit"; max: number };

function commit(apply: () => void, paths: string[]): void {
  if (fakeStore.failAfterCommits !== undefined && fakeStore.commits >= fakeStore.failAfterCommits) {
    throw new Error("unavailable: the connection was lost");
  }
  paths.forEach(assertWritable);
  apply();
  fakeStore.commits += 1;
  fakeStore.writes += paths.length;
}

function snapshot(ref: DocRef) {
  fakeStore.reads += 1;
  const data = fakeStore.documents.get(ref.path);
  return {
    id: ref.id,
    ref,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : structuredClone(data)),
  };
}

export function doc(parent: unknown, ...segments: string[]): DocRef {
  if (parent && typeof parent === "object" && (parent as CollectionRef).kind === "collection") {
    const collectionPath = (parent as CollectionRef).path;
    const id = segments[0] ?? `auto-${++fakeStore.autoId}`;
    return { kind: "doc", path: `${collectionPath}/${id}`, id };
  }
  const path = segments.join("/");
  return { kind: "doc", path, id: segments[segments.length - 1] };
}

export function collection(_db: unknown, ...segments: string[]): CollectionRef {
  return { kind: "collection", path: segments.join("/") };
}

export function where(field: string, _operator: "==", value: unknown): Constraint {
  return { kind: "where", field, value };
}

export function limit(max: number): Constraint {
  return { kind: "limit", max };
}

export function query(ref: CollectionRef, ...constraints: Constraint[]): QueryRef {
  return {
    kind: "query",
    path: ref.path,
    filters: constraints.flatMap((item) => (item.kind === "where" ? [{ field: item.field, value: item.value }] : [])),
    max: constraints.find((item): item is Extract<Constraint, { kind: "limit" }> => item.kind === "limit")?.max,
  };
}

export async function getDoc(ref: DocRef) {
  return snapshot(ref);
}

export async function getDocs(ref: CollectionRef | QueryRef) {
  const filters = ref.kind === "query" ? ref.filters : [];
  const matches = collectionRecords(ref.path).filter((record) =>
    filters.every((filter) => record[filter.field] === filter.value)
  );
  const limited = ref.kind === "query" && ref.max !== undefined ? matches.slice(0, ref.max) : matches;
  fakeStore.reads += Math.max(1, limited.length);
  return {
    docs: limited.map((record) => {
      const { id, ...data } = record;
      return { id, ref: doc(null, ...`${ref.path}/${id}`.split("/")), data: () => structuredClone(data) };
    }),
  };
}

export async function setDoc(ref: DocRef, data: Data, options?: { merge?: boolean }) {
  commit(() => {
    const current = fakeStore.documents.get(ref.path);
    fakeStore.documents.set(ref.path, structuredClone(options?.merge && current ? { ...current, ...data } : data));
  }, [ref.path]);
}

export async function runTransaction<T>(_db: unknown, update: (transaction: {
  get(ref: DocRef): Promise<ReturnType<typeof snapshot>>;
  set(ref: DocRef, data: Data, options?: { merge?: boolean }): void;
  update(ref: DocRef, data: Data): void;
  delete(ref: DocRef): void;
}) => Promise<T>): Promise<T> {
  const writes: Array<() => void> = [];
  const paths: string[] = [];
  const result = await update({
    get: async (ref) => snapshot(ref),
    set: (ref, data, options) => {
      paths.push(ref.path);
      writes.push(() => {
        const current = fakeStore.documents.get(ref.path);
        fakeStore.documents.set(ref.path, structuredClone(options?.merge && current ? { ...current, ...data } : data));
      });
    },
    update: (ref, data) => {
      paths.push(ref.path);
      writes.push(() => fakeStore.documents.set(ref.path, { ...fakeStore.documents.get(ref.path), ...structuredClone(data) }));
    },
    delete: (ref) => {
      paths.push(ref.path);
      writes.push(() => fakeStore.documents.delete(ref.path));
    },
  });
  if (writes.length > 0) commit(() => writes.forEach((write) => write()), paths);
  return result;
}

export function writeBatch(_db: unknown) {
  const writes: Array<() => void> = [];
  const paths: string[] = [];
  return {
    set: (ref: DocRef, data: Data) => {
      paths.push(ref.path);
      writes.push(() => fakeStore.documents.set(ref.path, structuredClone(data)));
    },
    update: (ref: DocRef, data: Data) => {
      paths.push(ref.path);
      writes.push(() => {
        const current = fakeStore.documents.get(ref.path);
        if (current === undefined) throw new Error(`not-found: ${ref.path}`);
        fakeStore.documents.set(ref.path, { ...current, ...structuredClone(data) });
      });
    },
    delete: (ref: DocRef) => {
      paths.push(ref.path);
      writes.push(() => fakeStore.documents.delete(ref.path));
    },
    commit: async () => commit(() => writes.forEach((write) => write()), paths),
  };
}
