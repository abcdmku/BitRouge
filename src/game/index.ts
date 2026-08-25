// ============================================================================
// BitRouge v3 "SOLDER" — public sim surface. WS2 renders from
// deriveRenderSnapshot, WS3 reads deriveVisibleState and dispatches
// GameActions, the platform drives advanceGame + serialize/deserializeSave.
// ============================================================================

// ---- currencies / rng -------------------------------------------------------
export type { Amount, AmountInput, ExactCost, ExactResourceBag } from "./amount";
export {
  ZERO_AMOUNT,
  amount,
  amountAbs,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountFloor,
  amountMax,
  amountMin,
  amountMultiply,
  amountPow,
  amountRound,
  amountSubtract,
  amountToNumber,
  amountToSafeNumber,
  exactCost,
  exactResourceBag,
  sumAmounts,
} from "./amount";
export type { RngResult, Xoshiro128State } from "./rng";
export { createRngState, nextRngFloat, nextRngInt, nextRngUint32, normalizeRngState } from "./rng";

// ---- state model ------------------------------------------------------------
export type {
  AdvanceMode,
  AdvanceReport,
  AdvanceResult,
  ArchPerkId,
  BoardState,
  ComponentKind,
  DamageSource,
  Dir,
  FirmwareId,
  FxEvent,
  FxEventBase,
  GameAction,
  GameState,
  MetaState,
  PacketState,
  RunState,
  SocketComponent,
  SocketState,
  SystemState,
  TaskKind,
  TaskState,
} from "./types";
export {
  ARCH_PERK_IDS,
  COMPONENT_KINDS,
  DAMAGE_SOURCES,
  DIRS,
  FIRMWARE_IDS,
  TASK_KINDS,
} from "./types";

// ---- board geometry ---------------------------------------------------------
export {
  countComponents,
  countUnlockedSockets,
  getPortIndices,
  getPortIndicesFor,
  hasArchPerk,
  countArchPerk,
  isPortIndex,
  neighborIndices,
  packetAt,
  rotateDir,
  stepIndex,
  toIndex,
  toXY,
} from "./board";

// ---- renderer contract ------------------------------------------------------
export type {
  RenderBacklogRow,
  RenderCommand,
  RenderComponent,
  RenderCrash,
  RenderPacket,
  RenderSnapshot,
  RenderSocket,
} from "./renderSnapshot";
export { deriveRenderSnapshot } from "./renderSnapshot";

// ---- core API ---------------------------------------------------------------
export {
  BASE_BOARD_HEIGHT,
  BOARD_WIDTH,
  createEmptyDamageLog,
  createFreshRun,
  createInitialGameState,
  createInitialMetaState,
  DEFAULT_SEED,
  TALL_BOARD_HEIGHT,
} from "./initialState";
export { applyAction } from "./actions";
export {
  advanceGame,
  applyManualWork,
  cloneGameState,
  getNextEventMs,
  isCrashed,
  MAX_ADVANCE_STEP_MS,
  normalizeAdvanceTimeMs,
  OFFLINE_CAP_MS,
  selectPositiveAdvanceStepMs,
} from "./advance";
export {
  DAMAGE_SOURCE_LABELS,
  deriveVisibleState,
  describeOfflineReport,
  getVisibleUnlockedCount,
  TASK_KIND_LABELS,
} from "./selectors";
export type {
  VisibleArchRow,
  VisibleBacklogRow,
  VisibleBuildRow,
  VisibleCrash,
  VisibleCrashRow,
  VisibleHud,
  VisibleOfflineReport,
  VisiblePopover,
  VisibleState,
  VisibleSystemRow,
} from "./selectors";
export {
  createSaveEnvelope,
  deserializeSave,
  normalizeGameState,
  SAVE_VERSION,
  serializeSave,
} from "./save";
export type { LoadedSave, SaveEnvelope } from "./save";
export { formatAmount, formatDurationMs, formatSeconds } from "./format";

// ---- economy / balance ------------------------------------------------------
export {
  archPerkDefinitions,
  BACKLOG_BASE_CAP,
  BASE_TICK_MS,
  componentDefinitions,
  creditAmount,
  firmwareDefinitions,
  getArchCost,
  getArrivalIntervalMs,
  getBacklogCap,
  getCacheMultiplier,
  getCapacitorCost,
  getClockCost,
  getComponentCost,
  getCoreMultiplier,
  getDuty,
  getEffectiveTickMs,
  getGenerationW,
  getGenFromArchitecture,
  getGpuMultiplier,
  getMaxIntegrity,
  getNetWatts,
  getPowerDrawW,
  getRailCost,
  getReserveMaxJ,
  getSellRefund,
  getSiliconPayout,
  getSocketUnlockCost,
  getTaskValue,
  getUpgradeCost,
  hasFirmware,
  LIVE_PACKET_CAP,
  MANUAL_DELIVERY_MULTIPLIER,
  OFFLINE_INTEGRITY_FLOOR,
  PACKET_HOP_LIMIT,
  PRIORITY_DEADLINE_MS,
  rollTaskKind,
  TASK_MIX_BY_GEN,
  TASK_VALUE_MULTIPLIER,
  THROTTLE_HEAT,
  VOLUNTARY_REFLOW_MIN_UPTIME_MS,
} from "./economy";
export type { ArchPerkDefinition, ComponentDefinition, FirmwareDefinition } from "./economy";
