import DecimalBase from "decimal.js";

/**
 * Decimal arithmetic for money. Never add, multiply or compare monetary values
 * with plain JS numbers: 0.1 + 0.2 !== 0.3. Values are rounded half-up to the
 * currency's minor unit only when displayed or stored.
 */
export const Decimal = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;

export type DecimalInput = Decimal | string | number;

export const ZERO = new Decimal(0);

/** Parse a decimal, throwing on NaN, Infinity, or empty input. */
export function dec(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`Not a finite number: ${value}`);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new RangeError("Empty decimal string");
  }
  const d = new Decimal(typeof value === "number" ? String(value) : value.trim());
  if (!d.isFinite()) throw new RangeError(`Not a finite number: ${value}`);
  return d;
}

/** Like dec() but returns null for null/undefined/empty or unparsable input. */
export function decOrNull(value: DecimalInput | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  try {
    return dec(value);
  } catch {
    return null;
  }
}

export function sum(values: Iterable<Decimal>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
}

/** Number of minor-unit digits for a currency (JPY 0, USD 2, ...). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function roundMoney(value: Decimal, currency = "USD"): Decimal {
  return value.toDecimalPlaces(currencyDigits(currency), Decimal.ROUND_HALF_UP);
}

/** Fixed-point string suitable for a numeric(12,2) column or CSV. */
export function toMoneyString(value: Decimal, currency = "USD"): string {
  return roundMoney(value, currency).toFixed(currencyDigits(currency));
}

export function formatMoney(
  value: DecimalInput | null | undefined,
  currency = "USD",
  opts: { signed?: boolean; compact?: boolean } = {},
): string {
  const d = decOrNull(value);
  if (d === null) return "—";
  const digits = currencyDigits(currency);
  const rounded = roundMoney(d, currency);
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: opts.compact ? 0 : digits,
    maximumFractionDigits: opts.compact && rounded.abs().gte(1000) ? 0 : digits,
    signDisplay: opts.signed ? "exceptZero" : "auto",
  });
  // toNumber is safe here: the value is already rounded to the minor unit and
  // only used for display.
  return formatter.format(rounded.toNumber());
}

export function formatPercent(value: DecimalInput | null | undefined, opts: { signed?: boolean } = {}): string {
  const d = decOrNull(value);
  if (d === null) return "—";
  const rounded = d.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  const sign = opts.signed && rounded.gt(0) ? "+" : "";
  return `${sign}${rounded.toFixed(1)}%`;
}

export function formatRatio(value: DecimalInput | null | undefined): string {
  const d = decOrNull(value);
  if (d === null) return "—";
  return `${d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)}×`;
}
