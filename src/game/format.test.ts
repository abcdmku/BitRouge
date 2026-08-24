import { formatAmount, formatDurationMs, formatSeconds } from "./format";

describe("formatAmount (IdleBit stack formatting)", () => {
  it("shows exact digits below 100,000, no separators", () => {
    expect(formatAmount("0")).toBe("0");
    expect(formatAmount("999")).toBe("999");
    expect(formatAmount("12345")).toBe("12345");
    expect(formatAmount("99999")).toBe("99999");
  });

  it("keeps one decimal for small fractional amounts", () => {
    expect(formatAmount("2.4")).toBe("2.4");
    expect(formatAmount("2.0")).toBe("2");
    expect(formatAmount("0.87")).toBe("0.9");
  });

  it("floors into IdleBit's named bands with a space before the suffix", () => {
    expect(formatAmount("100000")).toBe("100 K");
    expect(formatAmount("230500")).toBe("230 K");
    expect(formatAmount("9999999")).toBe("9999 K");
    expect(formatAmount("10000000")).toBe("10 M");
    expect(formatAmount("9999999999")).toBe("9999 M");
    expect(formatAmount("10000000000")).toBe("10 B");
    expect(formatAmount("15000000000000")).toBe("15 T");
    expect(formatAmount("20000000000000000")).toBe("20 Q");
    expect(formatAmount("30000000000000000000")).toBe("30 Qn");
    expect(formatAmount("40000000000000000000000")).toBe("40 S");
    expect(formatAmount("50000000000000000000000000")).toBe("50 Sp");
  });

  it("clamps to Sp beyond the named bands and handles negatives and garbage", () => {
    expect(formatAmount("1" + "0".repeat(30))).toBe("1000000 Sp");
    expect(formatAmount("-230500")).toBe("-230 K");
    expect(formatAmount("garbage")).toBe("0");
  });
});

describe("duration formatting", () => {
  it("formats durations at hour/minute/second granularity", () => {
    expect(formatDurationMs(5_000)).toBe("5s");
    expect(formatDurationMs(65_000)).toBe("1m 5s");
    expect(formatDurationMs(2 * 60 * 60 * 1000)).toBe("2h 0m");
    expect(formatDurationMs(72 * 60 * 60 * 1000)).toBe("3d 0h");
  });

  it("formats seconds with tenths under 10s", () => {
    expect(formatSeconds(0.87)).toBe("0.9s");
    expect(formatSeconds(42)).toBe("42s");
  });
});
