import { amount, amountAbs, amountCompare, amountFloor, amountToSafeNumber, type Amount } from "./amount";

/** IdleBit's named stack bands: K M B T Q Qn S Sp (Sp clamps for larger values). */
const SUFFIXES = ["K", "M", "B", "T", "Q", "Qn", "S", "Sp"] as const;

/**
 * IdleBit stack formatting: exact digits below 100,000; then floor to `N K`
 * (below 10M), `N M` (below 10B), B, T, Q, Qn, S, Sp — coefficient and suffix
 * separated by a space, no thousands separators. Small fractional amounts keep
 * one decimal (tenths), matching IdleBit's resource display clamp.
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
    return `${sign}${integer}`;
  }
  // Bands (IdleBit thresholds): K covers 1e5..<1e7, then every band spans 3
  // digits: M 1e7..<1e10, B 1e10..<1e13, T, Q, Qn, S, Sp (Sp clamps upward).
  const tier =
    integer.length <= 7
      ? 0
      : Math.min(SUFFIXES.length - 1, Math.ceil((integer.length - 7) / 3));
  const cut = 3 * (tier + 1);
  const head = integer.slice(0, integer.length - cut);
  return `${sign}${head} ${SUFFIXES[tier]}`;
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
