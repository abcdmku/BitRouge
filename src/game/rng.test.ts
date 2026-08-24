import {
  createRngState,
  nextRngFloat,
  nextRngInt,
  nextRngUint32,
  normalizeRngState,
} from "./rng";

const drawMany = (seed: number, count: number) => {
  let rng = createRngState(seed);
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = nextRngUint32(rng);
    rng = next.state;
    values.push(next.value);
  }
  return { rng, values };
};

describe("rng", () => {
  it("is deterministic for the same seed and differs across seeds", () => {
    expect(drawMany(42, 16).values).toEqual(drawMany(42, 16).values);
    expect(drawMany(42, 16).values).not.toEqual(drawMany(43, 16).values);
  });

  it("counts draws and stays within integer ranges", () => {
    let rng = createRngState(7);
    for (let index = 0; index < 1000; index += 1) {
      const next = nextRngInt(rng, 0, 10);
      expect(next.value).toBeGreaterThanOrEqual(0);
      expect(next.value).toBeLessThan(10);
      expect(Number.isInteger(next.value)).toBe(true);
      rng = next.state;
    }
    expect(rng.draws).toBe(1000);
  });

  it("produces floats in [0, 1)", () => {
    const next = nextRngFloat(createRngState(1));
    expect(next.value).toBeGreaterThanOrEqual(0);
    expect(next.value).toBeLessThan(1);
  });

  it("normalizes bad state to the default seed and rejects empty ranges", () => {
    expect(normalizeRngState(null)).toEqual(createRngState());
    expect(normalizeRngState({ algorithm: "xoshiro128**", state: [0, 0, 0, 0], draws: 3 })).toEqual(
      createRngState(),
    );
    expect(() => nextRngInt(createRngState(), 5, 5)).toThrow();
  });
});
