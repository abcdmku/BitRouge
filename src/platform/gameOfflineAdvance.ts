import {
  createOfflineAdvanceRunner,
  type OfflineAdvanceRunner,
  type OfflineAdvanceWorkerPort,
  wrapBrowserOfflineAdvanceWorker,
} from "./offlineAdvance";
import {
  runGameOfflineAdvance,
  type GameAdvanceOutcome,
  type GameOfflineAdvanceRequest,
} from "./gameOfflineAdvanceHandler";

export type GameOfflineAdvanceRunner = OfflineAdvanceRunner<
  GameOfflineAdvanceRequest,
  GameAdvanceOutcome
>;

export interface GameOfflineAdvanceRunnerOptions {
  createWorker?: () => OfflineAdvanceWorkerPort;
}

function createDefaultGameOfflineWorker(): OfflineAdvanceWorkerPort {
  return wrapBrowserOfflineAdvanceWorker(
    new Worker(new URL("./gameOfflineAdvance.worker.ts", import.meta.url), {
      type: "module",
    }),
  );
}

export function createGameOfflineAdvanceRunner(
  options: GameOfflineAdvanceRunnerOptions = {},
): GameOfflineAdvanceRunner {
  const createWorker =
    options.createWorker ??
    (typeof Worker === "undefined" ? undefined : createDefaultGameOfflineWorker);

  return createOfflineAdvanceRunner({
    advanceSynchronously: runGameOfflineAdvance,
    createWorker,
  });
}

export type { GameOfflineAdvanceRequest } from "./gameOfflineAdvanceHandler";
