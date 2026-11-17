import type { Firestore } from "firebase-admin/firestore";

/**
 * An in-memory stand-in for the parts of the firebase-admin Firestore API that server routes use:
 * document get/set/create/update/delete, collection and collection-group reads with equality
 * filters (dotted field paths such as "admins.u1" reach into maps), `getAll`, and transactions
 * whose writes apply together when the callback returns. Paths are plain strings
 * ("tournaments/t1/staff/u1"); inspect or seed `store` directly.
 */

type Data = Record<string, unknown>;
/** Field, value and operator: "==" (the default), "array-contains", "array-contains-any" or "in". */
type Filter = [string, unknown, string?];

export interface FakeAdminFirestore {
  firestore: Firestore;
  store: Map<string, Data>;
  /** Number of documents read, as Firestore bills them. */
  reads: () => number;
}

function alreadyExists(path: string): Error {
  return Object.assign(new Error(`Document already exists: ${path}`), { code: 6 });
}

function notFound(path: string): Error {
  return Object.assign(new Error(`No document to update: ${path}`), { code: 5 });
}

export function createFakeAdminFirestore(
  initial: Record<string, Data> = {},
  /** `collectionGroupError`: thrown by every collection-group read (e.g. a missing index). */
  options: { collectionGroupError?: Error } = {}
): FakeAdminFirestore {
  const store = new Map<string, Data>(Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]));
  let reads = 0;
  let autoId = 0;

  const snapshot = (path: string) => {
    reads += 1;
    const data = store.get(path);
    return {
      id: path.split("/").pop()!,
      ref: docRef(path),
      exists: data !== undefined,
      data: () => (data ? structuredClone(data) : undefined),
    };
  };

  const applySet = (path: string, data: Data, options?: { merge?: boolean }) => {
    store.set(path, structuredClone(options?.merge ? { ...store.get(path), ...data } : data));
  };
  const applyCreate = (path: string, data: Data) => {
    if (store.has(path)) throw alreadyExists(path);
    store.set(path, structuredClone(data));
  };
  const applyUpdate = (path: string, data: Data) => {
    if (!store.has(path)) throw notFound(path);
    store.set(path, structuredClone({ ...store.get(path), ...data }));
  };

  const fieldValue = (data: Data | undefined, field: string): unknown =>
    field.split(".").reduce<unknown>(
      (value, segment) => (value && typeof value === "object" ? (value as Data)[segment] : undefined),
      data
    );

  /** A collection path ("tournaments/t1/staff"), or `{ group }` for every collection with that id. */
  type Source = string | { group: string };
  const inSource = (key: string, source: Source) => {
    if (typeof source === "string") {
      const prefix = `${source}/`;
      return key.startsWith(prefix) && !key.slice(prefix.length).includes("/");
    }
    const segments = key.split("/");
    return segments.length % 2 === 0 && segments[segments.length - 2] === source.group;
  };

  function querySnapshot(source: Source, filters: Filter[], max?: number) {
    const docs = [...store.keys()]
      .filter((key) => inSource(key, source))
      .sort()
      .filter((key) => filters.every(([field, value, operator]) => {
        const stored = fieldValue(store.get(key), field);
        if (operator === "array-contains") return Array.isArray(stored) && stored.includes(value);
        if (operator === "array-contains-any") {
          return Array.isArray(stored) && Array.isArray(value) && value.some((item) => stored.includes(item));
        }
        if (operator === "in") return Array.isArray(value) && value.includes(stored);
        return stored === value;
      }))
      .slice(0, max)
      .map((key) => snapshot(key));
    if (docs.length === 0) reads += 1;
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  function query(source: Source, filters: Filter[], max?: number): unknown {
    return {
      where: (field: string, operator: string, value: unknown) => query(source, [...filters, [field, value, operator]], max),
      limit: (next: number) => query(source, filters, next),
      get: async () => {
        if (typeof source !== "string" && options.collectionGroupError) throw options.collectionGroupError;
        return querySnapshot(source, filters, max);
      },
    };
  }

  function docRef(path: string): unknown {
    return {
      id: path.split("/").pop()!,
      path,
      get parent() {
        return collectionRef(path.split("/").slice(0, -1).join("/"));
      },
      get: async () => snapshot(path),
      set: async (data: Data, options?: { merge?: boolean }) => applySet(path, data, options),
      create: async (data: Data) => applyCreate(path, data),
      update: async (data: Data) => applyUpdate(path, data),
      delete: async () => void store.delete(path),
      collection: (name: string) => collectionRef(`${path}/${name}`),
    };
  }

  function collectionRef(path: string): unknown {
    const segments = path.split("/");
    return {
      path,
      id: segments[segments.length - 1],
      get parent() {
        return segments.length > 1 ? docRef(segments.slice(0, -1).join("/")) : null;
      },
      doc: (id?: string) => docRef(`${path}/${id ?? `auto-${(autoId += 1)}`}`),
      ...(query(path, []) as object),
    };
  }

  type Ref = { path: string };
  const firestore = {
    collection: (name: string) => collectionRef(name),
    collectionGroup: (group: string) => query({ group }, []),
    doc: (path: string) => docRef(path),
    getAll: async (...refs: Ref[]) => refs.map((ref) => snapshot(ref.path)),
    runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>): Promise<T> => {
      const writes: Array<() => void> = [];
      const transaction = {
        // A document reference, or a query (no path) read inside the transaction.
        get: async (ref: Ref | { get: () => Promise<unknown> }) =>
          "path" in ref ? snapshot(ref.path) : ref.get(),
        set: (ref: Ref, data: Data, options?: { merge?: boolean }) => {
          writes.push(() => applySet(ref.path, data, options));
          return transaction;
        },
        create: (ref: Ref, data: Data) => {
          writes.push(() => applyCreate(ref.path, data));
          return transaction;
        },
        update: (ref: Ref, data: Data) => {
          writes.push(() => applyUpdate(ref.path, data));
          return transaction;
        },
        delete: (ref: Ref) => {
          writes.push(() => void store.delete(ref.path));
          return transaction;
        },
      };
      const result = await callback(transaction);
      // All or nothing, as a committed transaction.
      const before = new Map(store);
      try {
        writes.forEach((write) => write());
      } catch (error) {
        store.clear();
        before.forEach((value, key) => store.set(key, value));
        throw error;
      }
      return result;
    },
  };

  return { firestore: firestore as unknown as Firestore, store, reads: () => reads };
}
