import { amount, type AmountInput } from "./amount";
import { advanceGame, cloneGameState } from "./advance";
import { toIndex } from "./board";
import { creditAmount } from "./economy";
import { createInitialGameState } from "./initialState";
import type {
  ComponentKind,
  Dir,
  FxEvent,
  GameState,
  PacketState,
  TaskKind,
} from "./types";

/**
 * Test-only state builders. Not exported from the barrel; kept in a plain
 * module (not *.test.ts) so every suite can share them.
 */

export const advanceBy = (state: GameState, totalMs: number, stepMs: number) => {
  let next = state;
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    next = advanceGame(next, Math.min(stepMs, totalMs - elapsed), "foreground").state;
  }
  return next;
};

export const withCredits = (state: GameState, credits: AmountInput): GameState => {
  const draft = cloneGameState(state);
  draft.run.credits = amount(credits);
  return draft;
};

export const withData = (state: GameState, data: AmountInput): GameState => {
  const draft = cloneGameState(state);
  draft.run.data = amount(data);
  return draft;
};

export interface TestChip {
  x: number;
  y: number;
  kind: ComponentKind;
  level?: number;
  powered?: boolean;
  faulted?: boolean;
}

export interface TestBoardSetup {
  seed?: number;
  /** Unlock these cells (the boot column and ports stay unlocked regardless). */
  unlock?: { x: number; y: number }[];
  unlockAll?: boolean;
  chips?: TestChip[];
  /** Remove the free boot CORE first. */
  clearBootCore?: boolean;
  /** Boot CORE power state; defaults to true for automation tests. */
  bootCorePowered?: boolean;
  dirs?: { x: number; y: number; dir: Dir }[];
  railLevel?: number;
  reserveJ?: number;
  credits?: AmountInput;
  integrity?: number;
  uptimeMs?: number;
}

/** Build a deterministic custom board on top of the initial state. */
export const buildState = (setup: TestBoardSetup = {}): GameState => {
  const state = createInitialGameState(setup.seed ?? 1234);
  const run = state.run;
  const board = run.board;
  if (setup.clearBootCore) {
    for (const socket of board.sockets) socket.component = null;
  } else {
    // The boot CORE ships unpowered (calm boot); most automation tests want it
    // running, so power it on here. Pass `bootCorePowered: false` to keep the
    // pristine boot state.
    for (const socket of board.sockets) {
      if (socket.component?.kind === "core") {
        socket.component.powered = setup.bootCorePowered ?? true;
      }
    }
  }
  if (setup.unlockAll) {
    for (const socket of board.sockets) socket.unlocked = true;
  }
  for (const cell of setup.unlock ?? []) {
    board.sockets[toIndex(cell.x, cell.y, board.width)].unlocked = true;
  }
  for (const chip of setup.chips ?? []) {
    const index = toIndex(chip.x, chip.y, board.width);
    board.sockets[index].unlocked = true;
    board.sockets[index].component = {
      kind: chip.kind,
      level: chip.level ?? 1,
      powered: chip.powered ?? true,
      faulted: chip.faulted ?? false,
      faultAgeMs: 0,
    };
  }
  for (const entry of setup.dirs ?? []) {
    board.sockets[toIndex(entry.x, entry.y, board.width)].dir = entry.dir;
  }
  if (setup.railLevel !== undefined) run.system.railLevel = setup.railLevel;
  if (setup.reserveJ !== undefined) run.system.reserveJ = setup.reserveJ;
  if (setup.credits !== undefined) run.credits = amount(setup.credits);
  if (setup.integrity !== undefined) run.integrity = setup.integrity;
  if (setup.uptimeMs !== undefined) {
    run.uptimeMs = setup.uptimeMs;
    run.pressureMs = setup.uptimeMs;
  }
  return state;
};

export const addPacket = (
  state: GameState,
  x: number,
  y: number,
  value: number | string = 1,
  taskKind: TaskKind = "bulk",
): PacketState => {
  const board = state.run.board;
  const packet: PacketState = {
    id: board.nextId,
    taskKind,
    socketIndex: toIndex(x, y, board.width),
    value: creditAmount(Number(value)),
    visitedMask: 0,
    hops: 0,
  };
  board.nextId += 1;
  board.packets.push(packet);
  return packet;
};

export const addTask = (
  state: GameState,
  kind: TaskKind = "bulk",
  value: number | string = 1,
  deadlineMs: number | null = null,
) => {
  const board = state.run.board;
  const task = { id: board.nextId, kind, value: creditAmount(Number(value)), deadlineMs };
  board.nextId += 1;
  state.run.backlog.push(task);
  return task;
};

export const eventsOfKind = <K extends FxEvent["kind"]>(
  state: GameState,
  kind: K,
): Extract<FxEvent, { kind: K }>[] =>
  state.run.events.filter((event): event is Extract<FxEvent, { kind: K }> => event.kind === kind);

/** One full tick (base clock) with zero clock upgrades. */
export const TICK = 500;
