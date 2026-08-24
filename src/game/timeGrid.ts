/**
 * Adapted from IdleBit `advance.ts`. Event times are projected to numbers at the
 * engine boundary; every remainder is put back on a fixed microsecond grid so
 * 100 + 100 ms integrates exactly like 200 ms. Values on the grid are canonical
 * floats (k / 1000), so grid sums are exact and associative up to ~2^53 µs
 * (about 285 years), well beyond any offline session.
 *
 * IdleBit used a nanosecond grid plus an integer snap; the snap broke delta
 * invariance when turn boundaries left sub-snap residue, and the ns grid
 * overflowed 2^53 after ~2.5 h. Neither is kept.
 */
export const MAX_ADVANCE_STEP_MS = 15 * 60 * 1000;
export const MIN_ADVANCE_STEP_MS = 1;
export const ADVANCE_TIME_QUANTUM_PER_MS = 1000;

export const normalizeAdvanceTimeMs = (value: number) => {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  return Math.round(safe * ADVANCE_TIME_QUANTUM_PER_MS) / ADVANCE_TIME_QUANTUM_PER_MS;
};

export const selectPositiveAdvanceStepMs = (remainingMs: number, eventMs: number) => {
  const normalized = normalizeAdvanceTimeMs(
    Math.min(remainingMs, eventMs > 0 ? eventMs : MIN_ADVANCE_STEP_MS),
  );
  return normalized > 0 ? normalized : Math.min(remainingMs, MIN_ADVANCE_STEP_MS);
};

export const nonNegativeElapsed = (elapsedMs: number) =>
  Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
