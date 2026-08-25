import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  advanceGame,
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  deserializeSave,
  type GameAction,
  type GameState,
} from "../../game";
import {
  bitRougePersistence,
  createGameOfflineAdvanceRunner,
  type GameOfflineAdvanceRunner,
} from "../../platform";
import {
  getSavedGame,
  saveGameState,
  saveGameStateImmediate,
} from "../app/persistence";

/** The shape returned by the sim's `advanceGame`, sliced to just the report. */
type AdvanceReport = ReturnType<typeof advanceGame>["report"];

export const FOREGROUND_ADVANCE_INTERVAL_MS = 10;
const DEFAULT_SAVE_INTERVAL_MS = 4_000;

export interface UseGamePersistenceOptions {
  createOfflineRunner?: () => GameOfflineAdvanceRunner;
  now?: () => number;
  saveIntervalMs?: number;
}

const getCurrentTime = () => Date.now();

export function useGamePersistence({
  createOfflineRunner = createGameOfflineAdvanceRunner,
  now = getCurrentTime,
  saveIntervalMs = DEFAULT_SAVE_INTERVAL_MS,
}: UseGamePersistenceOptions = {}) {
  const [state, setState] = useState<GameState>(() => createInitialGameState());
  const [hydrated, setHydrated] = useState(false);
  const [lastReport, setLastReport] = useState<AdvanceReport | null>(null);
  // Offline reports get their own slot: `lastReport` is overwritten by every
  // foreground advance (~10 ms), so the return dialog reads this instead and
  // it only clears on explicit dismissal.
  const [offlineReport, setOfflineReport] = useState<AdvanceReport | null>(null);
  const [saveDriver] = useState(() => bitRougePersistence.driver);

  const stateRef = useRef(state);
  const hydratedRef = useRef(false);
  const catchupActiveRef = useRef(false);
  const catchupTokenRef = useRef(0);
  const departedAtMsRef = useRef<number | null>(null);
  const resetForegroundClockRef = useRef(true);
  const foregroundAccumulatedMsRef = useRef(0);
  const offlineRunnerRef = useRef<GameOfflineAdvanceRunner | null>(null);

  const commitState = useCallback((next: GameState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const dispatch = useCallback(
    (action: GameAction) => {
      commitState(applyAction(stateRef.current, action));
    },
    [commitState],
  );

  // Offline-advance runner lifecycle: prefer the worker, fall back to the
  // pure synchronous engine when a runner cannot be created.
  useEffect(() => {
    let runner: GameOfflineAdvanceRunner | null = null;
    try {
      runner = createOfflineRunner();
    } catch {
      // The pure engine remains available when a platform runner cannot start.
    }
    offlineRunnerRef.current = runner;
    return () => {
      if (offlineRunnerRef.current === runner) {
        offlineRunnerRef.current = null;
      }
      runner?.dispose();
    };
  }, [createOfflineRunner]);

  const runOfflineAdvance = useCallback(
    async (
      source: GameState,
      elapsedMs: number,
      shouldAbort: () => boolean = () => false,
    ) => {
      if (shouldAbort()) return null;
      const runner = offlineRunnerRef.current;
      if (runner) {
        try {
          const result = await runner.run({
            state: source,
            elapsedMs,
            mode: "offline",
          });
          return shouldAbort() ? null : result;
        } catch {
          if (shouldAbort()) return null;
          // Worker failures fall through to the pure engine.
        }
      }

      if (shouldAbort()) return null;
      return advanceGame(source, elapsedMs, "offline");
    },
    [],
  );

  // Hydrate from the save, catching up on any elapsed offline time before
  // exposing the restored state.
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const timestampMs = now();
      const raw = await getSavedGame();
      if (cancelled) return;

      const { state: restored, savedAtMs, departedAtMs } = deserializeSave(raw);
      if (cancelled) return;

      const departureTimestamp = departedAtMs ?? savedAtMs;
      const elapsedMs =
        departureTimestamp === null
          ? 0
          : Math.max(0, timestampMs - departureTimestamp);

      let hydratedState = restored;

      if (elapsedMs > 0) {
        catchupActiveRef.current = true;
        const catchupToken = catchupTokenRef.current + 1;
        catchupTokenRef.current = catchupToken;

        const outcome = await runOfflineAdvance(
          restored,
          elapsedMs,
          () => cancelled || catchupTokenRef.current !== catchupToken,
        );

        if (cancelled || outcome === null || catchupTokenRef.current !== catchupToken) {
          return;
        }

        hydratedState = outcome.state;
        setLastReport(outcome.report);
        setOfflineReport(outcome.report);
        catchupActiveRef.current = false;
      }

      if (cancelled) return;

      const saveTimestamp = now();
      const cleared = applyAction(hydratedState, {
        type: "recordSave",
        timestampMs: saveTimestamp,
      });

      commitState(cleared);
      departedAtMsRef.current = null;
      hydratedRef.current = true;
      setHydrated(true);

      if (cancelled) return;
      await saveGameState(cleared, saveTimestamp);
    };

    void hydrate();

    return () => {
      cancelled = true;
      catchupTokenRef.current += 1;
      catchupActiveRef.current = false;
    };
  }, [commitState, now, runOfflineAdvance]);

  // rAF loop: accumulate real time into fixed foreground advance steps while
  // the page is visible, not mid catch-up, and hydrated.
  useEffect(() => {
    let frame = 0;
    let previous = performance.now();

    const tick = (time: number) => {
      const delta = Math.max(0, time - previous);
      previous = time;

      if (!hydratedRef.current || catchupActiveRef.current) {
        resetForegroundClockRef.current = true;
        foregroundAccumulatedMsRef.current = 0;
      } else if (resetForegroundClockRef.current) {
        resetForegroundClockRef.current = false;
        foregroundAccumulatedMsRef.current = 0;
      } else if (document.visibilityState !== "hidden") {
        foregroundAccumulatedMsRef.current += delta;
        if (foregroundAccumulatedMsRef.current >= FOREGROUND_ADVANCE_INTERVAL_MS) {
          const elapsedMs = foregroundAccumulatedMsRef.current;
          foregroundAccumulatedMsRef.current = 0;
          const outcome = advanceGame(stateRef.current, elapsedMs, "foreground");
          setLastReport(outcome.report);
          commitState(outcome.state);
        }
      } else {
        foregroundAccumulatedMsRef.current = 0;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [commitState]);

  // Autosave on a fixed interval while visible.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!hydratedRef.current || document.visibilityState === "hidden") return;
      void saveGameState(stateRef.current, now());
    }, saveIntervalMs);

    return () => window.clearInterval(interval);
  }, [now, saveIntervalMs]);

  const persistDeparture = useCallback(() => {
    if (!hydratedRef.current) return;
    catchupTokenRef.current += 1;
    catchupActiveRef.current = false;

    const timestampMs = now();
    const next = applyAction(stateRef.current, {
      type: "recordDeparture",
      timestampMs,
    });
    departedAtMsRef.current = timestampMs;
    commitState(next);
    saveGameStateImmediate(next, timestampMs);
  }, [commitState, now]);

  const resumeFromDeparture = useCallback(async () => {
    if (!hydratedRef.current || catchupActiveRef.current) return;
    const departedAtMs = departedAtMsRef.current;
    if (departedAtMs === null) return;

    const departed = stateRef.current;
    const timestampMs = now();
    const elapsedMs = Math.max(0, timestampMs - departedAtMs);

    catchupActiveRef.current = true;
    const catchupToken = catchupTokenRef.current + 1;
    catchupTokenRef.current = catchupToken;

    const outcome = await runOfflineAdvance(
      departed,
      elapsedMs,
      () => catchupTokenRef.current !== catchupToken,
    );

    if (outcome === null || catchupTokenRef.current !== catchupToken) {
      return;
    }

    setLastReport(outcome.report);
    setOfflineReport(outcome.report);
    const saveTimestamp = now();
    const cleared = applyAction(outcome.state, {
      type: "recordSave",
      timestampMs: saveTimestamp,
    });

    departedAtMsRef.current = null;
    catchupActiveRef.current = false;
    commitState(cleared);
    await saveGameState(cleared, saveTimestamp);
  }, [commitState, now, runOfflineAdvance]);

  // Departure save on visibilitychange/pagehide, with catch-up on return.
  useEffect(() => {
    const handleVisibilityChange = () => {
      resetForegroundClockRef.current = true;
      if (document.visibilityState === "hidden") {
        persistDeparture();
      } else {
        void resumeFromDeparture();
      }
    };
    const handlePageHide = () => {
      resetForegroundClockRef.current = true;
      persistDeparture();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [persistDeparture, resumeFromDeparture]);

  const visible = useMemo(() => deriveVisibleState(state), [state]);

  const dismissOfflineReport = useCallback(() => setOfflineReport(null), []);

  return {
    state,
    visible,
    dispatch,
    lastReport,
    offlineReport,
    dismissOfflineReport,
    saveDriver,
    hydrated,
  };
}
