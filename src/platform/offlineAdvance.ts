export const OFFLINE_ADVANCE_WORKER_CHANNEL = "bitrouge:offline-advance" as const;

export interface OfflineAdvanceWorkerRequest<TRequest> {
  channel: typeof OFFLINE_ADVANCE_WORKER_CHANNEL;
  kind: "request";
  requestId: number;
  request: TRequest;
}

export interface OfflineAdvanceSerializedError {
  message: string;
  name: string;
  stack?: string;
}

export type OfflineAdvanceWorkerResponse<TResult> =
  | {
      channel: typeof OFFLINE_ADVANCE_WORKER_CHANNEL;
      kind: "success";
      requestId: number;
      result: TResult;
    }
  | {
      channel: typeof OFFLINE_ADVANCE_WORKER_CHANNEL;
      error: OfflineAdvanceSerializedError;
      kind: "failure";
      requestId: number;
    };

export interface OfflineAdvanceWorkerHandlers {
  onError(error: unknown): void;
  onMessage(message: unknown): void;
}

export interface OfflineAdvanceWorkerPort {
  postMessage(message: unknown): void;
  subscribe(handlers: OfflineAdvanceWorkerHandlers): () => void;
  terminate(): void;
}

export type OfflineAdvanceFunction<TRequest, TResult> = (
  request: TRequest,
) => TResult | Promise<TResult>;

export type OfflineAdvanceRunnerMode = "synchronous" | "worker";

export interface OfflineAdvanceRunner<TRequest, TResult> {
  readonly mode: OfflineAdvanceRunnerMode;
  dispose(): void;
  run(request: TRequest): Promise<TResult>;
}

export interface OfflineAdvanceRunnerOptions<TRequest, TResult> {
  advanceSynchronously: OfflineAdvanceFunction<TRequest, TResult>;
  createWorker?: () => OfflineAdvanceWorkerPort;
}

interface PendingRequest<TRequest, TResult> {
  reject(error: unknown): void;
  request: TRequest;
  resolve(result: TResult): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isSerializedError(value: unknown): value is OfflineAdvanceSerializedError {
  return Boolean(
    isRecord(value) &&
      typeof value.message === "string" &&
      typeof value.name === "string" &&
      (value.stack === undefined || typeof value.stack === "string"),
  );
}

function isWorkerResponse<TResult>(
  value: unknown,
): value is OfflineAdvanceWorkerResponse<TResult> {
  if (
    !isRecord(value) ||
    value.channel !== OFFLINE_ADVANCE_WORKER_CHANNEL ||
    typeof value.requestId !== "number"
  ) {
    return false;
  }

  if (value.kind === "success") {
    return Object.hasOwn(value, "result");
  }

  return value.kind === "failure" && isSerializedError(value.error);
}

function getTargetedRequestId(value: unknown): number | null {
  if (
    !isRecord(value) ||
    value.channel !== OFFLINE_ADVANCE_WORKER_CHANNEL ||
    typeof value.requestId !== "number"
  ) {
    return null;
  }

  return value.requestId;
}

function deserializeError(error: OfflineAdvanceSerializedError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  if (error.stack) {
    result.stack = error.stack;
  }
  return result;
}

export function serializeOfflineAdvanceError(
  error: unknown,
): OfflineAdvanceSerializedError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return {
    message: typeof error === "string" ? error : "Offline advancement failed.",
    name: "Error",
  };
}

export function createBrowserOfflineAdvanceWorkerPort(
  scriptUrl: string | URL,
  options: WorkerOptions = {},
): OfflineAdvanceWorkerPort {
  if (typeof Worker === "undefined") {
    throw new Error("Web Workers are unavailable in this runtime.");
  }

  return wrapBrowserOfflineAdvanceWorker(
    new Worker(scriptUrl, { type: "module", ...options }),
  );
}

export function wrapBrowserOfflineAdvanceWorker(
  worker: Worker,
): OfflineAdvanceWorkerPort {
  return {
    postMessage(message) {
      worker.postMessage(message);
    },
    subscribe(handlers) {
      const handleMessage = (event: MessageEvent<unknown>) => {
        handlers.onMessage(event.data);
      };
      const handleError = (event: ErrorEvent) => {
        handlers.onError(event.error ?? new Error(event.message));
      };
      const handleMessageError = () => {
        handlers.onError(new Error("Offline Worker message could not be decoded."));
      };

      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleError);
      worker.addEventListener("messageerror", handleMessageError);

      return () => {
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        worker.removeEventListener("messageerror", handleMessageError);
      };
    },
    terminate() {
      worker.terminate();
    },
  };
}

export function createOfflineAdvanceRunner<TRequest, TResult>({
  advanceSynchronously,
  createWorker,
}: OfflineAdvanceRunnerOptions<TRequest, TResult>): OfflineAdvanceRunner<
  TRequest,
  TResult
> {
  let disposed = false;
  let nextRequestId = 1;
  let unsubscribeWorker: (() => void) | null = null;
  let worker: OfflineAdvanceWorkerPort | null = null;
  let workerDisabled = createWorker === undefined;
  const pendingRequests = new Map<number, PendingRequest<TRequest, TResult>>();

  const runSynchronously = async (request: TRequest): Promise<TResult> =>
    advanceSynchronously(request);

  const disableWorker = (): void => {
    workerDisabled = true;
    unsubscribeWorker?.();
    unsubscribeWorker = null;
    worker?.terminate();
    worker = null;
  };

  const fallBackPendingRequests = (): void => {
    const requests = Array.from(pendingRequests.values());
    pendingRequests.clear();
    disableWorker();

    for (const pending of requests) {
      void runSynchronously(pending.request).then(pending.resolve, pending.reject);
    }
  };

  const handleMessage = (message: unknown): void => {
    const targetedRequestId = getTargetedRequestId(message);
    if (
      targetedRequestId === null ||
      !pendingRequests.has(targetedRequestId)
    ) {
      return;
    }

    if (!isWorkerResponse<TResult>(message)) {
      fallBackPendingRequests();
      return;
    }

    const pending = pendingRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    pendingRequests.delete(message.requestId);
    if (message.kind === "success") {
      pending.resolve(message.result);
      return;
    }

    pending.reject(deserializeError(message.error));
  };

  const ensureWorker = (): OfflineAdvanceWorkerPort | null => {
    if (workerDisabled || !createWorker) {
      return null;
    }

    if (worker) {
      return worker;
    }

    try {
      worker = createWorker();
      unsubscribeWorker = worker.subscribe({
        onError: fallBackPendingRequests,
        onMessage: handleMessage,
      });
      return worker;
    } catch {
      disableWorker();
      return null;
    }
  };

  return {
    get mode() {
      return workerDisabled ? "synchronous" : "worker";
    },

    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      disableWorker();
      const error = new Error("Offline advance runner has been disposed.");
      for (const pending of pendingRequests.values()) {
        pending.reject(error);
      }
      pendingRequests.clear();
    },

    async run(request: TRequest) {
      if (disposed) {
        throw new Error("Offline advance runner has been disposed.");
      }

      const activeWorker = ensureWorker();
      if (!activeWorker) {
        return runSynchronously(request);
      }

      const requestId = nextRequestId;
      nextRequestId += 1;

      return new Promise<TResult>((resolve, reject) => {
        pendingRequests.set(requestId, { reject, request, resolve });

        const message: OfflineAdvanceWorkerRequest<TRequest> = {
          channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
          kind: "request",
          request,
          requestId,
        };

        try {
          activeWorker.postMessage(message);
        } catch {
          fallBackPendingRequests();
        }
      });
    },
  };
}
