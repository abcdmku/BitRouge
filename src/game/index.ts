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
  Biome,
  CampaignLogEntry,
  CampaignState,
  Dir,
  Enemy,
  EnemyKind,
  Facing,
  FloorHazard,
  FloorItem,
  FloorState,
  GameAction,
  GameState,
  HardwareKind,
  HazardKind,
  HeroAction,
  HeroBuff,
  HeroState,
  HeroStats,
  HubState,
  HubStats,
  ItemKind,
  Point,
  ResearchId,
  RunEvent,
  RunState,
  RunStatus,
  RunSummary,
  TileKindValue,
  TimeState,
  WatchdogLevelId,
  WatchdogState,
} from "./types";
export { HARDWARE_KINDS, RESEARCH_IDS, WATCHDOG_LEVEL_IDS } from "./types";

// ---- renderer contract ------------------------------------------------------
export type {
  EntityAnim,
  RenderCommand,
  RenderEntity,
  RenderHero,
  RenderItem,
  RenderSnapshot,
} from "./renderSnapshot";
export { TileKind, deriveRenderSnapshot, getBiome } from "./renderSnapshot";

// ---- core API ---------------------------------------------------------------
export { createInitialGameState, createInitialHubState, DEFAULT_SEED, STARTING_CREDITS } from "./initialState";
export { applyAction } from "./actions";
export {
  advanceGame,
  getNextEventMs,
  getRunMsPerTurn,
  isRebooting,
  isRunTicking,
  MAX_ADVANCE_STEP_MS,
  normalizeAdvanceTimeMs,
  OFFLINE_MAX_SIMULATED_RUNS,
  OFFLINE_MAX_TURNS,
  selectPositiveAdvanceStepMs,
  stepRunTurn,
} from "./advance";
export { deriveVisibleState } from "./selectors";
export {
  CAMPAIGN_LOG_SIZE,
  campaignChapterDefinitions,
  campaignObjectiveDefinitions,
  createCampaignState,
  getCampaignChapterDefinition,
  getCampaignObjectiveDefinition,
  getVisibleCampaign,
  normalizeCampaignState,
  updateCampaignProgress,
} from "./campaign";
export type {
  CampaignChapterDefinition,
  CampaignChapterId,
  CampaignObjectiveDefinition,
  VisibleCampaign,
  VisibleCampaignChapter,
  VisibleCampaignObjective,
} from "./campaign";
export type {
  VisibleHardwareRow,
  VisibleItemSlot,
  VisibleReboot,
  VisibleResearchRow,
  VisibleResources,
  VisibleRun,
  VisibleState,
  VisibleWatchdog,
  VisibleWatchdogRow,
} from "./selectors";
export { SAVE_VERSION, createSaveEnvelope, deserializeSave, normalizeGameState, serializeSave } from "./save";
export type { LoadedSave, SaveEnvelope } from "./save";
export { formatAmount, formatDurationMs, formatSeconds } from "./format";

// ---- content / derived stats -----------------------------------------------
export {
  HARDWARE_MAX_LEVEL,
  getAttack,
  getClockHz,
  getDaemonSlots,
  getHardwareCost,
  getHeatDissipation,
  getMaxHp,
  getMsPerTurn,
  getPowerBudget,
  hardwareDefinitions,
} from "./hardware";
export type { HardwareCost, HardwareDefinition } from "./hardware";
export { getResearchDefinition, hasResearch, isResearchId, researchDefinitions } from "./research";
export type { ResearchDefinition } from "./research";
export {
  getNextWatchdogDefinition,
  getWatchdogBlockedReason,
  getWatchdogCapacityMs,
  getWatchdogDefinition,
  getWatchdogLevel,
  hasWatchdog,
  isWatchdogLevelId,
  recordDeparture,
  recordSave,
  watchdogLevelDefinitions,
} from "./watchdog";
export type { WatchdogLevelDefinition } from "./watchdog";
export {
  ATTACK_HEAT,
  BASE_FOV_RADIUS,
  DEADLOCK_LOCK_TURNS,
  MAX_ITEM_SLOTS,
  THROTTLE_OFF_HEAT,
  THROTTLE_ON_HEAT,
  deriveHeroStats,
  getHeroAttack,
  getHeroPowerDraw,
} from "./hero";
export {
  bankIntoHub,
  buyHardware,
  buyResearch,
  canAfford,
  computeBankedData,
  getHardwareBlockedReason,
  getKillCredits,
  getResearchBlockedReason,
} from "./economy";
export { REBOOT_BITS, createRunSummary, endRun, getRebootDurationMs, getStartDepth, startRun } from "./run";

// ---- dungeon (for debug views / tests) -------------------------------------
export { FLOOR_HEIGHT, FLOOR_WIDTH, toIndex, toPoint } from "./dungeon/grid";
export { generateFloor, isBossDepth } from "./dungeon/generate";
export {
  enemyDefinitions,
  KERNEL_PANIC_BOUNTY_MULTIPLIER,
  KERNEL_PANIC_SPLIT_COUNT,
} from "./dungeon/enemies";
export { BIOME_ENEMY_WEIGHTS, BIOME_HAZARD_WEIGHTS } from "./dungeon/biomes";
export { itemDefinitions } from "./dungeon/items";
export { hazardNames } from "./dungeon/hazards";
export { resolveTurn } from "./dungeon/turn";
export { chooseAutoAction } from "./dungeon/autoExplore";
