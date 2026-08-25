import { amount } from "./amount";
import { getPortIndices, hasArchPerk, toIndex } from "./board";
import { getMaxIntegrity } from "./economy";
import { createRngState, type Xoshiro128State } from "./rng";
import type {
  DamageSource,
  GameState,
  MetaState,
  RunState,
  SocketState,
} from "./types";

export const DEFAULT_SEED = 0x50_1d_e6; // "SOLDEr"

export const BOARD_WIDTH = 5;
export const BASE_BOARD_HEIGHT = 7;
export const TALL_BOARD_HEIGHT = 8;

export const createEmptyDamageLog = (): Record<DamageSource, number> => ({
  backlogOverflow: 0,
  rawCrunch: 0,
  priorityExpired: 0,
  faultSpread: 0,
  overheat: 0,
});

export const createInitialMetaState = (): MetaState => ({
  silicon: 0,
  gen: 1,
  architecture: [],
  bestUptimeMs: 0,
  totalTasks: 0,
  reflows: 0,
  research: { completed: [], active: null },
});

/**
 * §2 boot state, respecting owned ARCH perks: 3 unlocked sockets above the
 * PORT (6 with Start Kit), a free powered CORE L1 on top, arrows preset south,
 * 0 J in the reserve (RAIL I with Start Kit).
 */
export const createFreshRun = (meta: MetaState): RunState => {
  const width = BOARD_WIDTH;
  const height = hasArchPerk(meta.architecture, "board5x8")
    ? TALL_BOARD_HEIGHT
    : BASE_BOARD_HEIGHT;
  const ports = getPortIndices(width, height, hasArchPerk(meta.architecture, "eastPort"));
  const sockets: SocketState[] = [];
  for (let i = 0; i < width * height; i += 1) {
    sockets.push({ unlocked: false, dir: "S", heat: 0, component: null });
  }
  for (const port of ports) sockets[port].unlocked = true;

  const portX = Math.floor(width / 2);
  const column = [
    toIndex(portX, height - 2, width),
    toIndex(portX, height - 3, width),
    toIndex(portX, height - 4, width),
  ];
  for (const index of column) sockets[index].unlocked = true;
  const coreIndex = column[2];

  if (hasArchPerk(meta.architecture, "startKit")) {
    const extra = [
      toIndex(portX - 1, height - 2, width),
      toIndex(portX + 1, height - 2, width),
      toIndex(portX - 1, height - 3, width),
    ];
    for (const index of extra) sockets[index].unlocked = true;
    // Side sockets feed the main column.
    sockets[extra[0]].dir = "E";
    sockets[extra[1]].dir = "W";
    sockets[extra[2]].dir = "E";
  }

  // The free CORE boots unpowered: with 0 W generation a powered chip would
  // put the board in brownout at first launch. Manual WORK ignores power, so
  // the "TAP TO RUN" onboarding is unaffected; buying RAIL I + powering on
  // starts automation.
  sockets[coreIndex].component = {
    kind: "core",
    level: 1,
    powered: false,
    faulted: false,
    faultAgeMs: 0,
  };

  const railLevel = hasArchPerk(meta.architecture, "startKit") ? 1 : 0;

  return {
    uptimeMs: 0,
    pressureMs: 0,
    integrity: getMaxIntegrity(meta.architecture),
    credits: amount(0),
    data: amount(0),
    backlog: [],
    board: { width, height, sockets, packets: [], nextId: 1 },
    system: {
      railLevel,
      capacitorLevel: 0,
      clockLevel: 0,
      reserveJ: 0,
      firmware: [],
    },
    arrivalAccumMs: 0,
    tickAccumMs: 0,
    damageLog: createEmptyDamageLog(),
    tasksDone: 0,
    ventCooldownMs: 0,
    events: [],
    nextEventSeq: 1,
  };
};

export const createInitialGameState = (
  seed = DEFAULT_SEED,
  rng?: Xoshiro128State,
): GameState => {
  const meta = createInitialMetaState();
  return {
    rng: rng ?? createRngState(seed),
    run: createFreshRun(meta),
    meta,
    savedAtMs: null,
    departedAtMs: null,
  };
};
