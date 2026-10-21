import { handleComputeRequest, type ComputeRequest } from "./computeJobs";

// Typed locally rather than through the "webworker" lib, which would change the DOM globals of
// every other file in the project.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ComputeRequest>) => void) | null;
  postMessage(message: unknown): void;
};

// One job per worker: the client terminates the worker when the job ends or is cancelled.
scope.onmessage = (event) => {
  scope.postMessage(handleComputeRequest(event.data));
};
