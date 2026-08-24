export interface Xoshiro128State {
  algorithm: "xoshiro128**";
  state: [number, number, number, number];
  draws: number;
}

export interface RngResult<T> {
  state: Xoshiro128State;
  value: T;
}

const UINT32_RANGE = 0x1_0000_0000;

const toUint32 = (value: number) => value >>> 0;

const rotateLeft = (value: number, shift: number) =>
  toUint32((value << shift) | (value >>> (32 - shift)));

const splitMix32 = (seed: number) => {
  let value = toUint32(seed + 0x9e3779b9);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return toUint32(value ^ (value >>> 15));
};

export const createRngState = (seed = 0x1d1eb17): Xoshiro128State => {
  const state: [number, number, number, number] = [
    splitMix32(seed),
    splitMix32(seed + 1),
    splitMix32(seed + 2),
    splitMix32(seed + 3),
  ];
  if (state.every((word) => word === 0)) state[0] = 1;
  return { algorithm: "xoshiro128**", state, draws: 0 };
};

export const normalizeRngState = (
  candidate: Partial<Xoshiro128State> | null | undefined,
  fallbackSeed = 0x1d1eb17,
): Xoshiro128State => {
  if (
    candidate?.algorithm !== "xoshiro128**" ||
    !Array.isArray(candidate.state) ||
    candidate.state.length !== 4 ||
    candidate.state.some((word) => !Number.isFinite(word))
  ) {
    return createRngState(fallbackSeed);
  }

  const state = candidate.state.map((word) => toUint32(word)) as Xoshiro128State["state"];
  if (state.every((word) => word === 0)) return createRngState(fallbackSeed);
  return {
    algorithm: "xoshiro128**",
    state,
    draws: Math.max(0, Math.trunc(candidate.draws ?? 0)),
  };
};

export const nextRngUint32 = (rng: Xoshiro128State): RngResult<number> => {
  const [s0, s1, s2, s3] = rng.state;
  const value = toUint32(Math.imul(rotateLeft(Math.imul(s1, 5), 7), 9));
  const temporary = toUint32(s1 << 9);
  const nextS2 = toUint32(s2 ^ s0);
  const nextS3 = toUint32(s3 ^ s1);
  const nextS1 = toUint32(s1 ^ nextS2);
  const nextS0 = toUint32(s0 ^ nextS3);

  return {
    value,
    state: {
      algorithm: "xoshiro128**",
      state: [nextS0, nextS1, toUint32(nextS2 ^ temporary), rotateLeft(nextS3, 11)],
      draws: rng.draws + 1,
    },
  };
};

export const nextRngFloat = (rng: Xoshiro128State): RngResult<number> => {
  const next = nextRngUint32(rng);
  return { state: next.state, value: next.value / UINT32_RANGE };
};

export const nextRngInt = (
  rng: Xoshiro128State,
  minimum: number,
  maximumExclusive: number,
): RngResult<number> => {
  const min = Math.ceil(minimum);
  const max = Math.floor(maximumExclusive);
  if (max <= min) throw new Error("RNG integer range must be non-empty");
  const next = nextRngUint32(rng);
  return {
    state: next.state,
    value: min + Math.floor((next.value / UINT32_RANGE) * (max - min)),
  };
};

