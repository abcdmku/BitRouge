import {
  handleGameOfflineAdvanceWorkerMessage,
  type GameOfflineAdvanceWorkerResponse,
} from "./gameOfflineAdvanceHandler";

interface GameOfflineAdvanceWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: GameOfflineAdvanceWorkerResponse): void;
}

const workerScope = self as unknown as GameOfflineAdvanceWorkerScope;

workerScope.addEventListener("message", (event) => {
  handleGameOfflineAdvanceWorkerMessage(event.data, (response) => {
    workerScope.postMessage(response);
  });
});
