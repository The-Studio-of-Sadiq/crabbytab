/**
 * An in-memory stand-in for the parts of the Firestore web SDK the repositories use (documents,
 * collections, equality queries, transactions and write batches). Tests install it with
 * `vi.mock("firebase/firestore", () => import("@/test/fakeFirestore"))` and inspect or seed
 * `fakeStore` directly. A transaction or batch commits all of its writes or none, and
 * `failAfterCommits` makes later commits throw, to simulate a connection dropping part-way.
 * `reads` and `writes` count documents as Firestore bills them (a query reads each returned
 * document, at least one), and audit events are append-only as in firestore.rules.
 * `serverTimestamp()` resolves to the commit's time on a fake clock (every commit is one second
 * after the previous one), read back as a `Timestamp` with `toMillis`, and `where(field, ">", t)`
 * plus `getAggregateFromServer` with `count()`/`sum()` work on it.
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
  /** The fake server clock (milliseconds); the time of the latest commit. */
  now: number;
}

const CLOCK_START = Date.UTC(2026, 0, 1);

export const fakeStore: FakeStore = { documents: new Map(), commits: 0, autoId: 0, reads: 0, writes: 0, now: CLOCK_START };

/** A stored stamp: structuredClone drops class instances, so stamps are kept as plain markers. */
const STAMP_KEY = "__fakeTimestampMillis";
const SERVER_TIMESTAMP = { __fakeServerTimestamp: true } as const;

export class Timestamp {
  constructor(private readonly millis: number) {}
  static fromMillis(millis: number): Timestamp {
    return new Timestamp(millis);
  }
  toMillis(): number {
    return this.millis;
  }
}

export function serverTimestamp(): unknown {
  return SERVER_TIMESTAMP;
}

function stampMillis(value: unknown): number | undefined {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && typeof (value as Data)[STAMP_KEY] === "number") {
    return (value as Data)[STAMP_KEY] as number;
  }
  return undefined;
}

/** Server timestamps in written data become the commit's time. */
function resolveStamps(data: Data): Data {
  const resolved: Data = {};
  for (const [key, value] of Object.entries(data)) {
    resolved[key] = value === SERVER_TIMESTAMP ? { [STAMP_KEY]: fakeStore.now } : value;
  }
  return resolved;
}

/** Stored stamp markers come back as Timestamps, as the SDK returns them. */
function reviveStamps(data: Data): Data {
  const revived: Data = {};
  for (const [key, value] of Object.entries(data)) {
    const millis = stampMillis(value);
    revived[key] = millis === undefined ? value : Timestamp.fromMillis(millis);
  }
  return revived;
}

export function resetFakeStore(): void {
  fakeStore.documents = new Map();
  fakeStore.commits = 0;
  fakeStore.failAfterCommits = undefined;
  fakeStore.autoId = 0;
  fakeStore.reads = 0;
  fakeStore.writes = 0;
  fakeStore.now = CLOCK_START;
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
type Operator = "==" | ">";
interface Filter { field: string; operator: Operator; value: unknown }
interface QueryRef { kind: "query"; path: string; filters: Filter[]; max?: number }
type Constraint = ({ kind: "where" } & Filter) | { kind: "limit"; max: number };

function matches(record: Data, filter: Filter): boolean {
  if (filter.operator === "==") return record[filter.field] === filter.value;
  const stored = stampMillis(record[filter.field]);
  const bound = stampMillis(filter.value);
  if (stored !== undefined && bound !== undefined) return stored > bound;
  const value = record[filter.field];
  return typeof value === "number" && typeof filter.value === "number" && value > filter.value;
}

function commit(apply: () => void, paths: string[]): void {
  if (fakeStore.failAfterCommits !== undefined && fakeStore.commits >= fakeStore.failAfterCommits) {
    throw new Error("unavailable: the connection was lost");
  }
  paths.forEach(assertWritable);
  fakeStore.now += 1000;
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
    data: () => (data === undefined ? undefined : reviveStamps(structuredClone(data))),
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

export function where(field: string, operator: Operator, value: unknown): Constraint {
  return { kind: "where", field, operator, value };
}

export function limit(max: number): Constraint {
  return { kind: "limit", max };
}

export function query(ref: CollectionRef, ...constraints: Constraint[]): QueryRef {
  return {
    kind: "query",
    path: ref.path,
    filters: constraints.flatMap((item) =>
      item.kind === "where" ? [{ field: item.field, operator: item.operator, value: item.value }] : []
    ),
    max: constraints.find((item): item is Extract<Constraint, { kind: "limit" }> => item.kind === "limit")?.max,
  };
}

export async function getDoc(ref: DocRef) {
  return snapshot(ref);
}

export async function getDocs(ref: CollectionRef | QueryRef) {
  const filters = ref.kind === "query" ? ref.filters : [];
  const found = collectionRecords(ref.path).filter((record) => filters.every((filter) => matches(record, filter)));
  const limited = ref.kind === "query" && ref.max !== undefined ? found.slice(0, ref.max) : found;
  fakeStore.reads += Math.max(1, limited.length);
  return {
    docs: limited.map((record) => {
      const { id, ...data } = record;
      return { id, ref: doc(null, ...`${ref.path}/${id}`.split("/")), data: () => reviveStamps(structuredClone(data)) };
    }),
  };
}

type AggregateSpec = { kind: "count" } | { kind: "sum"; field: string };

export function count(): AggregateSpec {
  return { kind: "count" };
}

export function sum(field: string): AggregateSpec {
  return { kind: "sum", field };
}

/** Billed as one read per 1,000 documents counted, at least one. */
export async function getAggregateFromServer(ref: CollectionRef, spec: Record<string, AggregateSpec>) {
  const records = collectionRecords(ref.path);
  fakeStore.reads += Math.max(1, Math.ceil(records.length / 1000));
  const totals = Object.fromEntries(Object.entries(spec).map(([name, item]) => [
    name,
    item.kind === "count"
      ? records.length
      : records.reduce((total, record) => total + (typeof record[item.field] === "number" ? record[item.field] as number : 0), 0),
  ]));
  return { data: () => totals };
}

export async function setDoc(ref: DocRef, data: Data, options?: { merge?: boolean }) {
  commit(() => {
    const current = fakeStore.documents.get(ref.path);
    const resolved = resolveStamps(data);
    fakeStore.documents.set(ref.path, structuredClone(options?.merge && current ? { ...current, ...resolved } : resolved));
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
        const resolved = resolveStamps(data);
        fakeStore.documents.set(ref.path, structuredClone(options?.merge && current ? { ...current, ...resolved } : resolved));
      });
    },
    update: (ref, data) => {
      paths.push(ref.path);
      writes.push(() => fakeStore.documents.set(ref.path, { ...fakeStore.documents.get(ref.path), ...structuredClone(resolveStamps(data)) }));
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
      writes.push(() => fakeStore.documents.set(ref.path, structuredClone(resolveStamps(data))));
    },
    update: (ref: DocRef, data: Data) => {
      paths.push(ref.path);
      writes.push(() => {
        const current = fakeStore.documents.get(ref.path);
        if (current === undefined) throw new Error(`not-found: ${ref.path}`);
        fakeStore.documents.set(ref.path, { ...current, ...structuredClone(resolveStamps(data)) });
      });
    },
    delete: (ref: DocRef) => {
      paths.push(ref.path);
      writes.push(() => fakeStore.documents.delete(ref.path));
    },
    commit: async () => commit(() => writes.forEach((write) => write()), paths),
  };
}
