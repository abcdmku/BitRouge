import { amount, amountAbs, amountCompare, amountFloor, amountToSafeNumber, type Amount } from "./amount";

const SUFFIXES = ["K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No"] as const;

const withCommas = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * RuneScape-style: full number below 100,000; then floor to K (below 10M),
 * M (below 10B), B, T, ... Small fractional amounts keep one decimal.
 */
export const formatAmount = (value: Amount | string): string => {
  let normalized: Amount;
  try {
    normalized = amount(value);
  } catch {
    return "0";
  }
  const negative = amountCompare(normalized, 0) < 0;
  const abs = amountAbs(normalized);
  const integer = amountFloor(abs) as string;
  const sign = negative ? "-" : "";
  if (integer.length <= 5) {
    const asNumber = amountToSafeNumber(abs);
    if (asNumber < 1000 && !Number.isInteger(asNumber)) {
      const fixed = asNumber.toFixed(1);
      return `${sign}${fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed}`;
    }
    return `${sign}${withCommas(integer)}`;
  }
  // 100,000 .. 9,999,999 → K ; 10,000,000 .. → M ; etc. Each suffix covers 3 digits, offset so
  // the K tier starts at 6 digits and the M tier at 8 digits (RuneScape thresholds).
  const tier = Math.min(SUFFIXES.length - 1, Math.floor((integer.length - 6) / 3) + (integer.length >= 8 ? 1 : 0));
  const cut = 3 * (tier + 1);
  if (integer.length <= cut) return `${sign}${withCommas(integer)}`;
  const head = integer.slice(0, integer.length - cut);
  return `${sign}${withCommas(head)}${SUFFIXES[tier]}`;
};

export const formatDurationMs = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours >= 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export const formatSeconds = (seconds: number) =>
  seconds >= 10 ? `${Math.round(seconds)}s` : `${Math.max(0, seconds).toFixed(1)}s`;
