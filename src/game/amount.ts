import Decimal from "decimal.js";

/** A canonical base-10 amount. Runtime and save values never use exponent notation. */
export type Amount = string & { readonly __amountBrand: unique symbol };

export interface ExactResourceBag {
  credits: Amount;
  data: Amount;
}

export interface ExactCost {
  resource: keyof ExactResourceBag;
  amount: Amount;
}

export type AmountInput = Amount | string | number | Decimal;

const AmountDecimal = Decimal.clone({
  // Keep enough significant digits for exact economy operations well beyond the
  // current campaign scale. In particular, a small bill or reward must remain
  // observable beside a 1e309 balance.
  precision: 1024,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -1_000_000_000,
  toExpPos: 1_000_000_000,
});

const decimal = (value: AmountInput) => {
  const parsed = new AmountDecimal(value as Decimal.Value);
  if (!parsed.isFinite()) throw new Error(`Invalid amount: ${String(value)}`);
  return parsed;
};

export const amount = (value: AmountInput): Amount => {
  const parsed = decimal(value);
  return (parsed.isZero() ? "0" : parsed.toFixed()) as Amount;
};

export const ZERO_AMOUNT = amount(0);

export const amountAdd = (left: AmountInput, right: AmountInput) =>
  amount(decimal(left).plus(decimal(right)));

export const amountSubtract = (left: AmountInput, right: AmountInput) =>
  amount(decimal(left).minus(decimal(right)));

export const amountMultiply = (left: AmountInput, right: AmountInput) =>
  amount(decimal(left).times(decimal(right)));

/** Exact integer exponentiation for economy curves. */
export const amountPow = (value: AmountInput, exponent: number) => {
  if (!Number.isSafeInteger(exponent)) {
    throw new Error(`Amount exponent must be a safe integer: ${String(exponent)}`);
  }
  return amount(decimal(value).pow(exponent));
};

export const amountRound = (value: AmountInput) =>
  amount(decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));

export const amountFloor = (value: AmountInput) =>
  amount(decimal(value).toDecimalPlaces(0, Decimal.ROUND_FLOOR));

export const amountDivide = (left: AmountInput, right: AmountInput) => {
  const divisor = decimal(right);
  if (divisor.isZero()) throw new Error("Cannot divide an Amount by zero");
  return amount(decimal(left).dividedBy(divisor));
};

export const amountCompare = (left: AmountInput, right: AmountInput) =>
  decimal(left).comparedTo(decimal(right));

export const amountMin = (left: AmountInput, right: AmountInput) =>
  amountCompare(left, right) <= 0 ? amount(left) : amount(right);

export const amountMax = (left: AmountInput, right: AmountInput) =>
  amountCompare(left, right) >= 0 ? amount(left) : amount(right);

export const amountAbs = (value: AmountInput) => amount(decimal(value).abs());

export const amountClampMin = (value: AmountInput, minimum: AmountInput = 0) =>
  amountMax(value, minimum);

export const amountToNumber = (value: AmountInput) => decimal(value).toNumber();

/** Temporary projection for legacy UI/math surfaces; exact state remains authoritative. */
export const amountToSafeNumber = (value: AmountInput) => {
  const parsed = decimal(value);
  if (parsed.greaterThan(Number.MAX_VALUE)) return Number.MAX_VALUE;
  if (parsed.lessThan(-Number.MAX_VALUE)) return -Number.MAX_VALUE;
  return parsed.toNumber();
};

export const sumAmounts = (values: readonly AmountInput[]) =>
  values.reduce<Amount>((total, value) => amountAdd(total, value), ZERO_AMOUNT);

export const exactResourceBag = (
  credits: AmountInput = 0,
  data: AmountInput = 0,
): ExactResourceBag => ({
  credits: amount(credits),
  data: amount(data),
});

export const exactCost = (
  resource: ExactCost["resource"],
  value: AmountInput,
): ExactCost => ({ resource, amount: amount(value) });
