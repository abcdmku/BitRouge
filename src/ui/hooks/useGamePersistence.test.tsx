import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sim (`src/game`) is owned by another agent and may not exist/compile
// yet, so it is fully mocked here. `advanceGame` increments a counter on the
// (fake) state each call so foreground/offline advances are observable.
vi.mock("../../game", () => {
  let createCount = 0;

  const createInitialGameState = vi.fn((seed?: number) => {
    createCount += 1;
    return { kind: "initial", seed: seed ?? 0, counter: 0, createCount };
  });

  const applyAction = vi.fn((state: unknown, action: unknown) => ({
    ...(state as Record<string, unknown>),
    lastAction: action,
  }));

  const advanceGame = vi.fn(
    (state: unknown, elapsedMs: number, mode: "foreground" | "offline") => {
      const current = state as Record<string, unknown>;
      const counter = ((current.counter as number) ?? 0) + 1;
      return {
        state: { ...current, counter, lastMode: mode, lastElapsedMs: elapsedMs },
        report: { mode, elapsedMs, counter },
      };
    },
  );

  const deriveVisibleState = vi.fn((state: unknown) => ({ visibleOf: state }));

  const deserializeSave = vi.fn(
    (raw: string | null | undefined): {
      state: unknown;
      savedAtMs: number | null;
      departedAtMs: number | null;
    } => {
      if (!raw) {
        return { state: createInitialGameState(), savedAtMs: null, departedAtMs: null };
      }
      return JSON.parse(raw);
    },
  );

  const serializeSave = vi.fn((state: unknown, savedAtMs: number) =>
    JSON.stringify({ state, savedAtMs, departedAtMs: null }),
  );

  return {
    createInitialGameState,
    applyAction,
    advanceGame,
    deriveVisibleState,
    deserializeSave,
    serializeSave,
  };
});

import {
  advanceGame,
  applyAction,
  deserializeSave,
  type GameState,
} from "../../game";
import { bitRougePersistence } from "../../platform";
import { SAVE_KEY } from "../app/persistence";
import { useGamePersistence, type UseGamePersistenceOptions } from "./useGamePersistence";

type PersistenceHook = ReturnType<typeof useGamePersistence>;

let latestHook: PersistenceHook | null = null;

function Harness({ options }: { options: UseGamePersistenceOptions }) {
  latestHook = useGamePersistence(options);
  return null;
}

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useGamePersistence", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cancelRafSpy: ReturnType<typeof vi.spyOn>;
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    await bitRougePersistence.clear();
    latestHook = null;

    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    // The rAF loop is not under test here; keep it inert so it cannot
    // interfere with assertions about hydration/autosave/departure.
    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    cancelRafSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
    if (originalVisibilityDescriptor) {
      Object.defineProperty(document, "visibilityState", originalVisibilityDescriptor);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
    await bitRougePersistence.clear();
    vi.clearAllMocks();
  });

  it("hydrates from empty storage by creating the initial state", async () => {
    act(() => {
      root.render(
        <Harness
          options={{
            now: () => 1_000,
            createOfflineRunner: () => ({
              mode: "synchronous",
              run: vi.fn(),
              dispose: vi.fn(),
            }),
          }}
        />,
      );
    });
    await flushEffects();

    expect(deserializeSave).toHaveBeenCalledWith(null);
    // No departure/save timestamp on a fresh save, so no offline advance runs.
    expect(advanceGame).not.toHaveBeenCalled();
    expect(latestHook?.hydrated).toBe(true);
    expect(latestHook?.state).toMatchObject({ kind: "initial" });
    // The hook clears any departure via a `recordSave` dispatch on hydration.
    expect(applyAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "initial" }),
      { type: "recordSave", timestampMs: 1_000 },
    );

    const stored = await bitRougePersistence.get<string>(SAVE_KEY);
    expect(stored).not.toBeNull();
  });

  it("runs offline catch-up with mode 'offline' when a departure elapsed", async () => {
    const departedAtMs = 50_000;
    await bitRougePersistence.set(
      SAVE_KEY,
      JSON.stringify({
        state: { kind: "restored", counter: 0 },
        savedAtMs: 40_000,
        departedAtMs,
      }),
    );

    const run = vi.fn((request: { state: unknown; elapsedMs: number; mode: string }) =>
      Promise.resolve(advanceGame(request.state as GameState, request.elapsedMs, "offline")),
    );
    const runner = { mode: "synchronous" as const, run, dispose: vi.fn() };

    act(() => {
      root.render(
        <Harness
          options={{
            now: () => 100_000,
            createOfflineRunner: () => runner,
          }}
        />,
      );
    });
    await flushEffects();

    expect(run).toHaveBeenCalledWith({
      state: expect.objectContaining({ kind: "restored" }),
      elapsedMs: 50_000,
      mode: "offline",
    });
    expect(advanceGame).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "restored" }),
      50_000,
      "offline",
    );
    expect(latestHook?.lastReport).toMatchObject({ mode: "offline", elapsedMs: 50_000 });
    expect(latestHook?.hydrated).toBe(true);
  });

  it("autosaves on the configured interval", async () => {
    vi.useFakeTimers();
    const runner = { mode: "synchronous" as const, run: vi.fn(), dispose: vi.fn() };

    act(() => {
      root.render(
        <Harness
          options={{
            now: () => 5_000,
            saveIntervalMs: 4_000,
            createOfflineRunner: () => runner,
          }}
        />,
      );
    });
    await flushEffects();

    expect(latestHook?.hydrated).toBe(true);
    const afterHydrate = await bitRougePersistence.get<string>(SAVE_KEY);
    expect(afterHydrate).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    const afterAutosave = await bitRougePersistence.get<string>(SAVE_KEY);
    // The autosave write serializes the current in-memory state; it should
    // still be present (and unchanged in shape) after the interval fires.
    expect(afterAutosave).not.toBeNull();
    expect(JSON.parse(afterAutosave as string)).toMatchObject({ savedAtMs: 5_000 });
  });

  it("saves a departure immediately when the tab becomes hidden", async () => {
    const runner = { mode: "synchronous" as const, run: vi.fn(), dispose: vi.fn() };

    act(() => {
      root.render(
        <Harness
          options={{
            now: () => 9_000,
            createOfflineRunner: () => runner,
          }}
        />,
      );
    });
    await flushEffects();
    expect(latestHook?.hydrated).toBe(true);

    (applyAction as ReturnType<typeof vi.fn>).mockClear();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(applyAction).toHaveBeenCalledWith(
      expect.anything(),
      { type: "recordDeparture", timestampMs: 9_000 },
    );

    const stored = await bitRougePersistence.get<string>(SAVE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toMatchObject({ savedAtMs: 9_000 });
  });
});
