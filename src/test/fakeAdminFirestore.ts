import type { Firestore } from "firebase-admin/firestore";

/**
 * An in-memory stand-in for the parts of the firebase-admin Firestore API that server routes use:
 * document get/set/create/update/delete, collection reads with equality filters, `getAll`, and
 * transactions whose writes apply together when the callback returns. Paths are plain strings
 * ("tournaments/t1/staff/u1"); inspect or seed `store` directly.
 */

type Data = Record<string, unknown>;

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

export function createFakeAdminFirestore(initial: Record<string, Data> = {}): FakeAdminFirestore {
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

  function querySnapshot(path: string, filters: Array<[string, unknown]>, max?: number) {
    const prefix = `${path}/`;
    const docs = [...store.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .sort()
      .filter((key) => filters.every(([field, value]) => store.get(key)?.[field] === value))
      .slice(0, max)
      .map((key) => snapshot(key));
    if (docs.length === 0) reads += 1;
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  function query(path: string, filters: Array<[string, unknown]>, max?: number): unknown {
    return {
      where: (field: string, _operator: string, value: unknown) => query(path, [...filters, [field, value]], max),
      limit: (next: number) => query(path, filters, next),
      get: async () => querySnapshot(path, filters, max),
    };
  }

  function docRef(path: string): unknown {
    return {
      id: path.split("/").pop()!,
      path,
      get: async () => snapshot(path),
      set: async (data: Data, options?: { merge?: boolean }) => applySet(path, data, options),
      create: async (data: Data) => applyCreate(path, data),
      update: async (data: Data) => applyUpdate(path, data),
      delete: async () => void store.delete(path),
      collection: (name: string) => collectionRef(`${path}/${name}`),
    };
  }

  function collectionRef(path: string) {
    return {
      path,
      doc: (id?: string) => docRef(`${path}/${id ?? `auto-${(autoId += 1)}`}`),
      ...(query(path, []) as object),
    };
  }

  type Ref = { path: string };
  const firestore = {
    collection: (name: string) => collectionRef(name),
    doc: (path: string) => docRef(path),
    getAll: async (...refs: Ref[]) => refs.map((ref) => snapshot(ref.path)),
    runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>): Promise<T> => {
      const writes: Array<() => void> = [];
      const transaction = {
        get: async (ref: Ref) => snapshot(ref.path),
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
