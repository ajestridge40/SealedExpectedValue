import { Decimal, type DecimalInput, ZERO, decOrNull } from "../money";

export interface ReturnsInput {
  /** Gross expected card value per product (null when EV is unavailable). */
  grossEv: Decimal | null;
  purchasePrice: DecimalInput | null;
  /** Shipping, tax, fees or other costs of buying/opening, per product. */
  openingCosts?: DecimalInput | null;
}

export interface ReturnsResult {
  status: "ok" | "no_ev" | "invalid_price";
  purchasePrice: Decimal | null;
  totalCost: Decimal | null;
  /** EV - purchase price - opening costs. */
  netEv: Decimal | null;
  /** netEv / purchase price x 100. */
  netReturnPct: Decimal | null;
  /** grossEv / purchase price. */
  evToPrice: Decimal | null;
}

/**
 * Net expected return of buying one product at a given price. Gross EV is kept
 * separate: this never changes it. A purchase price must be > 0.
 */
export function calculateReturns(input: ReturnsInput): ReturnsResult {
  const price = decOrNull(input.purchasePrice);
  const costs = decOrNull(input.openingCosts ?? 0) ?? ZERO;

  if (price === null || price.lte(0) || costs.isNegative()) {
    return {
      status: "invalid_price",
      purchasePrice: price,
      totalCost: null,
      netEv: null,
      netReturnPct: null,
      evToPrice: null,
    };
  }
  const totalCost = price.plus(costs);
  if (input.grossEv === null) {
    return { status: "no_ev", purchasePrice: price, totalCost, netEv: null, netReturnPct: null, evToPrice: null };
  }
  const netEv = input.grossEv.minus(totalCost);
  return {
    status: "ok",
    purchasePrice: price,
    totalCost,
    netEv,
    netReturnPct: netEv.div(price).times(100),
    evToPrice: input.grossEv.div(price),
  };
}

/** Compare the same EV at several hypothetical purchase prices. */
export function compareScenarios(
  grossEv: Decimal | null,
  prices: DecimalInput[],
  openingCosts: DecimalInput = 0,
): (ReturnsResult & { input: DecimalInput })[] {
  return prices.map((p) => ({ input: p, ...calculateReturns({ grossEv, purchasePrice: p, openingCosts }) }));
}

/** Purchase price at which net EV is zero (EV - costs). Null if not positive. */
export function breakEvenPrice(grossEv: Decimal | null, openingCosts: DecimalInput = 0): Decimal | null {
  if (grossEv === null) return null;
  const be = grossEv.minus(decOrNull(openingCosts) ?? ZERO);
  return be.gt(0) ? be : null;
}
