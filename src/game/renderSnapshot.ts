import { getPortIndicesFor, packetAt, toXY } from "./board";
import {
  countUnlockedSockets,
  getPortIndices,
} from "./board";
import {
  getBacklogCap,
  getDuty,
  getMaxIntegrity,
  getNetWatts,
  getReserveMaxJ,
  getSiliconPayout,
  getSocketUnlockCost,
  THROTTLE_HEAT,
} from "./economy";
import { formatAmount } from "./format";
import type {
  ComponentKind,
  DamageSource,
  Dir,
  FxEvent,
  GameAction,
  GameState,
  TaskKind,
} from "./types";

// ============================================================================
// Renderer contract (WS2). `deriveRenderSnapshot(state)` is pure; the fx event
// ring carries monotonic `seq` values so the renderer can play only what it
// has not seen. RenderCommand is the tap-action subset the canvas emits.
// ============================================================================

export type { FxEvent } from "./types";

export interface RenderComponent {
  kind: ComponentKind;
  level: number;
  powered: boolean;
  faulted: boolean;
  /** 0..1 progress toward the next 30 s fault spread while faulted. */
  faultSpreadProgress: number;
}

export interface RenderSocket {
  index: number;
  x: number;
  y: number;
  unlocked: boolean;
  isPort: boolean;
  dir: Dir;
  /** 0..100 */
  heat: number;
  throttled: boolean;
  component: RenderComponent | null;
  /** Unlock price printed on locked sockets (formatted), null when unlocked. */
  unlockCostLabel: string | null;
  /** True when a WORK tap would do something here (packet hop / core pull / patch). */
  lit: boolean;
}

export interface RenderPacket {
  id: number;
  socketIndex: number;
  taskKind: TaskKind;
  valueLabel: string;
}

export interface RenderBacklogRow {
  id: number;
  kind: TaskKind;
  valueLabel: string;
  /** Milliseconds until the PRIORITY deadline, null for other kinds. */
  deadlineLeftMs: number | null;
}

export interface RenderCrash {
  uptimeMs: number;
  siliconPayout: number;
  /** Damage log ranked by applied damage, descending. */
  damage: { source: DamageSource; amount: number }[];
}

export interface RenderSnapshot {
  boardWidth: number;
  boardHeight: number;
  portIndices: number[];
  sockets: RenderSocket[];
  packets: RenderPacket[];
  backlog: RenderBacklogRow[];
  backlogCap: number;
  integrity: number;
  integrityMax: number;
  reserveJ: number;
  reserveMax: number;
  netWatts: number;
  uptimeMs: number;
  gen: number;
  /** 0..1 board duty (1 = full speed; < 1 = brownout crawl). */
  duty: number;
  /** Non-null while the run is dead and waiting for REFLOW. */
  crash: RenderCrash | null;
  /** Bounded fx ring, ascending `seq`. */
  events: FxEvent[];
  /** Highest seq present in `events` (0 when empty). */
  lastEventSeq: number;
}

/** The tap actions the canvas may emit back through the bridge. */
export type RenderCommand = Extract<
  GameAction,
  {
    type:
      | "workSocket"
      | "rotateSocket"
      | "unlockSocket"
      | "placeComponent"
      | "upgradeComponent"
      | "sellComponent"
      | "togglePower";
  }
>;

const socketIsLit = (state: GameState, index: number): boolean => {
  const board = state.run.board;
  const socket = board.sockets[index];
  if (!socket.unlocked) return false;
  const component = socket.component;
  if (component?.faulted) return true;
  if (packetAt(board, index)) return true;
  if (
    component &&
    component.kind === "core" &&
    !component.faulted &&
    state.run.backlog.length > 0
  ) {
    return true;
  }
  return false;
};

export const deriveRenderSnapshot = (state: GameState): RenderSnapshot => {
  const run = state.run;
  const board = run.board;
  const ports = getPortIndicesFor(state);
  const unlockedCount = countUnlockedSockets(board, ports);

  const sockets: RenderSocket[] = board.sockets.map((socket, index) => {
    const { x, y } = toXY(index, board.width);
    const component = socket.component;
    return {
      index,
      x,
      y,
      unlocked: socket.unlocked,
      isPort: ports.includes(index),
      dir: socket.dir,
      heat: socket.heat,
      throttled: socket.heat >= THROTTLE_HEAT,
      component: component
        ? {
            kind: component.kind,
            level: component.level,
            powered: component.powered,
            faulted: component.faulted,
            faultSpreadProgress: component.faulted
              ? Math.min(1, (component.faultAgeMs % 30_000) / 30_000)
              : 0,
          }
        : null,
      unlockCostLabel: socket.unlocked
        ? null
        : formatAmount(getSocketUnlockCost(unlockedCount)),
      lit: socketIsLit(state, index),
    };
  });

  const crashed = run.integrity <= 0;
  const events = run.events;
  return {
    boardWidth: board.width,
    boardHeight: board.height,
    portIndices: ports,
    sockets,
    packets: board.packets.map((packet) => ({
      id: packet.id,
      socketIndex: packet.socketIndex,
      taskKind: packet.taskKind,
      valueLabel: formatAmount(packet.value),
    })),
    backlog: run.backlog.map((task) => ({
      id: task.id,
      kind: task.kind,
      valueLabel: formatAmount(task.value),
      deadlineLeftMs:
        task.deadlineMs === null ? null : Math.max(0, task.deadlineMs - run.uptimeMs),
    })),
    backlogCap: getBacklogCap(state.meta.architecture),
    integrity: run.integrity,
    integrityMax: getMaxIntegrity(state.meta.architecture),
    reserveJ: run.system.reserveJ,
    reserveMax: getReserveMaxJ(run.system.capacitorLevel, state.meta.architecture),
    netWatts: getNetWatts(run, state.meta),
    uptimeMs: run.uptimeMs,
    gen: state.meta.gen,
    duty: crashed ? 0 : getDuty(run, state.meta),
    crash: crashed
      ? {
          uptimeMs: run.uptimeMs,
          siliconPayout: getSiliconPayout(run.uptimeMs, run.tasksDone),
          damage: (Object.entries(run.damageLog) as [DamageSource, number][])
            .filter(([, amount]) => amount > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([source, amount]) => ({ source, amount })),
        }
      : null,
    events,
    lastEventSeq: events.length > 0 ? events[events.length - 1].seq : 0,
  };
};

export { getPortIndices };
