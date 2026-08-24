import { amount, amountMultiply, amountPow, amountRound, type Amount } from "./amount";
import { normalizeAdvanceTimeMs } from "./timeGrid";
import type { HardwareKind, HubState } from "./types";

export interface HardwareDefinition {
  kind: HardwareKind;
  name: string;
  baseCost: number;
  growth: string;
  dataBase: number | null;
  dataGrowth: string | null;
  describe: (level: number) => string;
}

export const HARDWARE_MAX_LEVEL = 60;

export const getClockHz = (level: number) => 2 * Math.pow(1.15, level);
export const getAttack = (level: number) => 1 + level;
export const getMaxHp = (level: number) => 8 + 6 * level;
export const getPowerBudget = (level: number) => 10 * Math.pow(1.7, level - 1);
export const getHeatDissipation = (level: number) => 1 + level;
export const getDaemonSlots = (level: number) => 1 + level;

/** Auto-turn cadence: deeper floors carry more work per turn; faster clocks resolve it sooner. */
export const getMsPerTurn = (clockHz: number, depth: number) =>
  normalizeAdvanceTimeMs((1000 * (2 * Math.pow(1.35, Math.max(1, depth) - 1))) / clockHz);

const fmt = (value: number, digits = 2) =>
  Number.isInteger(value) ? String(value) : value.toFixed(digits);

export const hardwareDefinitions: Record<HardwareKind, HardwareDefinition> = {
  clock: {
    kind: "clock",
    name: "Clock",
    baseCost: 25,
    growth: "1.6",
    dataBase: null,
    dataGrowth: null,
    describe: (level) => `${fmt(getClockHz(level))} Hz`,
  },
  cores: {
    kind: "cores",
    name: "Cores",
    baseCost: 140,
    growth: "2.05",
    dataBase: 2,
    dataGrowth: "1.3",
    describe: (level) => {
      const slots = getDaemonSlots(level);
      return `${slots} daemon slot${slots === 1 ? "" : "s"}`;
    },
  },
  cache: {
    kind: "cache",
    name: "Cache",
    baseCost: 30,
    growth: "1.8",
    dataBase: null,
    dataGrowth: null,
    describe: (level) => `${getAttack(level)} attack`,
  },
  ram: {
    kind: "ram",
    name: "RAM",
    baseCost: 40,
    growth: "1.7",
    dataBase: null,
    dataGrowth: null,
    describe: (level) => `${getMaxHp(level)} HP`,
  },
  psu: {
    kind: "psu",
    name: "PSU",
    baseCost: 60,
    growth: "1.7",
    dataBase: null,
    dataGrowth: null,
    describe: (level) => `${fmt(getPowerBudget(level), 1)} W budget`,
  },
  cooling: {
    kind: "cooling",
    name: "Cooling",
    baseCost: 50,
    growth: "1.75",
    dataBase: null,
    dataGrowth: null,
    describe: (level) => `-${getHeatDissipation(level)} heat/turn`,
  },
  scheduler: {
    kind: "scheduler",
    name: "Scheduler",
    baseCost: 80,
    growth: "2",
    dataBase: null,
    dataGrowth: null,
    describe: (level) => `AI level ${level}`,
  },
};

export interface HardwareCost {
  credits: Amount;
  data: Amount;
}

/** Cost of buying level `level + 1` when currently at `level`. */
export const getHardwareCost = (kind: HardwareKind, level: number): HardwareCost => {
  const definition = hardwareDefinitions[kind];
  const n = Math.max(0, Math.trunc(level));
  const credits = amountRound(amountMultiply(definition.baseCost, amountPow(definition.growth, n)));
  const data =
    definition.dataBase !== null && definition.dataGrowth !== null
      ? amountRound(amountMultiply(definition.dataBase, amountPow(definition.dataGrowth, n)))
      : amount(0);
  return { credits, data };
};

export const getHardwareLevel = (hub: HubState, kind: HardwareKind) => hub.hardware[kind] ?? 0;
