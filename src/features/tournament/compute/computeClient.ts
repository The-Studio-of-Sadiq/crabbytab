import {
  executeComputeRequest,
  type ComputeKind,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResults,
} from "./computeJobs";

/** The organiser cancelled a running draw or allocation; nothing was saved. */
export class ComputeCancelledError extends Error {
  constructor() {
    super("Cancelled. Nothing was changed.");
    this.name = "ComputeCancelledError";
  }
}

export type WorkerFactory = () => Worker;

const defaultWorkerFactory: WorkerFactory | null =
  typeof Worker === "undefined"
    ? null
    : () => new Worker(new URL("./compute.worker.ts", import.meta.url), { type: "module" });

/**
 * Runs a computation in its own Web Worker so the page stays responsive, and terminates the worker
 * when it finishes or `signal` aborts (rejecting with ComputeCancelledError). Where workers are
 * unavailable (server rendering, tests, or a worker that cannot start) it runs inline after
 * yielding once, so the caller's progress state can render first. The result is the same either
 * way: the computations are deterministic for their input (draws take their seed from it).
 */
export function runComputeJob<K extends ComputeKind>(
  request: Extract<ComputeRequest, { kind: K }>,
  options: { signal?: AbortSignal; createWorker?: WorkerFactory | null } = {}
): Promise<ComputeResults[K]> {
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(new ComputeCancelledError());
  const createWorker = options.createWorker === undefined ? defaultWorkerFactory : options.createWorker;
  const inline = () =>
    new Promise<ComputeResults[K]>((resolve, reject) => {
      setTimeout(() => {
        if (signal?.aborted) return reject(new ComputeCancelledError());
        try {
          resolve(executeComputeRequest(request) as ComputeResults[K]);
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  if (!createWorker) return inline();

  let worker: Worker;
  try {
    worker = createWorker();
  } catch (error) {
    console.warn("Could not start a background worker; computing on the page instead:", error);
    return inline();
  }
  return new Promise<ComputeResults[K]>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new ComputeCancelledError());
    };
    signal?.addEventListener("abort", onAbort);
    worker.onmessage = (event: MessageEvent<ComputeResponse>) => {
      finish();
      if (event.data.ok) resolve(event.data.result as ComputeResults[K]);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      finish();
      reject(new Error(event.message || "The background computation failed."));
    };
    worker.postMessage(request);
  });
}
