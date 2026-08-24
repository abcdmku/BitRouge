import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountCompare,
  amountDivide,
  amountFloor,
  amountMultiply,
  amountPow,
  sumAmounts,
} from "./amount";

describe("amount", () => {
  it("canonicalizes zero and plain decimals", () => {
    expect(amount(0)).toBe("0");
    expect(amount("0.0")).toBe(ZERO_AMOUNT);
    expect(amount("12.50")).toBe("12.5");
  });

  it("adds and multiplies exactly", () => {
    expect(amountAdd("1.5", "2.5")).toBe("4");
    expect(amountMultiply("0.1", 3)).toBe("0.3");
    expect(sumAmounts([1, "2", "3.5"])).toBe("6.5");
  });

  it("supports integer powers and floor", () => {
    expect(amountPow(2, 10)).toBe("1024");
    expect(amountPow("1.6", 3)).toBe("4.096");
    expect(amountFloor("9.99")).toBe("9");
    expect(() => amountPow(2, 1.5)).toThrow();
  });

  it("never emits exponent notation for huge values", () => {
    const huge = amountMultiply("1e309", 10);
    expect(huge).not.toContain("e");
    expect(huge.length).toBe(311);
  });

  it("compares and rejects division by zero", () => {
    expect(amountCompare("2", "10")).toBe(-1);
    expect(amountCompare("10", "10")).toBe(0);
    expect(() => amountDivide(1, 0)).toThrow();
    expect(amountDivide(1, 4)).toBe("0.25");
  });
});
