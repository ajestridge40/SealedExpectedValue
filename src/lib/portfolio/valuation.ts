import { Decimal, type DecimalInput, ZERO, dec, decOrNull, sum } from "../money";
import type { PricePoint } from "../ev/types";

/*
 * Collection valuation. Every acquisition lot is valued on its own:
 *
 *   cost basis   = quantity x unit price + all recorded fees/shipping
 *   market value = quantity x latest market price (or the owner's manual value)
 *   unrealized   = market value - cost basis
 *
 * Totals add lots of the same currency only; there is no FX conversion. Lots
 * without a usable price are counted in the cost basis but excluded from the
 * gain/loss, and are reported so the UI can flag them.
 */

export type AssetType = "sealed" | "card";

export type PriceStatus =
  | "fresh" // catalog price within the staleness window
  | "stale" // catalog price older than the window (still used, flagged)
  | "manual" // owner's manual valuation
  | "missing" // no price at all
  | "currency_mismatch"; // price exists but in a different currency

export interface LotInput {
  id: string;
  assetType: AssetType;
  /** Groups lots of the same catalog item ("sealed:<id>", "card:<id>", or a custom key). */
  itemKey: string;
  itemName: string;
  quantity: number;
  unitPrice: DecimalInput;
  /** Fees, shipping, grading... added to the cost basis. */
  extraCosts?: (DecimalInput | null | undefined)[];
  currency: string;
  purchaseDate?: string | null;
  marketPrice?: PricePoint | null;
  manualUnitValue?: { amount: DecimalInput; asOf?: string | Date | null } | null;
  /** Graded cards are valued at the ungraded market price unless a manual value is set. */
  isGraded?: boolean;
}

export interface LotValuation {
  lot: LotInput;
  costBasis: Decimal;
  unitCostBasis: Decimal;
  unitValue: Decimal | null;
  marketValue: Decimal | null;
  gain: Decimal | null;
  gainPct: Decimal | null;
  priceStatus: PriceStatus;
  priceAsOf: Date | null;
  warnings: string[];
}

export interface ValuationOptions {
  now?: Date;
  staleAfterHours?: number;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function valueLot(lot: LotInput, options: ValuationOptions = {}): LotValuation {
  if (!Number.isInteger(lot.quantity) || lot.quantity <= 0) {
    throw new RangeError(`Lot ${lot.id}: quantity must be a positive integer`);
  }
  const unitPrice = dec(lot.unitPrice);
  if (unitPrice.isNegative()) throw new RangeError(`Lot ${lot.id}: negative unit price`);
  const extras = (lot.extraCosts ?? []).map((c) => decOrNull(c ?? null) ?? ZERO);
  if (extras.some((c) => c.isNegative())) throw new RangeError(`Lot ${lot.id}: negative fee`);

  const qty = new Decimal(lot.quantity);
  const costBasis = unitPrice.times(qty).plus(sum(extras));
  const warnings: string[] = [];
  const now = options.now ?? new Date();
  const staleMs = (options.staleAfterHours ?? 72) * 3_600_000;

  let unitValue: Decimal | null = null;
  let priceStatus: PriceStatus = "missing";
  let priceAsOf: Date | null = null;

  const manual = lot.manualUnitValue ? decOrNull(lot.manualUnitValue.amount) : null;
  const market = lot.marketPrice ? decOrNull(lot.marketPrice.amount) : null;

  if (manual !== null && !manual.isNegative()) {
    unitValue = manual;
    priceStatus = "manual";
    priceAsOf = toDate(lot.manualUnitValue?.asOf);
  } else if (market !== null && lot.marketPrice) {
    if (lot.marketPrice.currency.toUpperCase() !== lot.currency.toUpperCase()) {
      priceStatus = "currency_mismatch";
      warnings.push(
        `Market price is in ${lot.marketPrice.currency}, but this lot was bought in ${lot.currency}; no conversion is applied.`,
      );
    } else {
      unitValue = market;
      priceAsOf = toDate(lot.marketPrice.asOf);
      priceStatus = priceAsOf && now.getTime() - priceAsOf.getTime() <= staleMs ? "fresh" : "stale";
      if (lot.isGraded) warnings.push("Graded card valued at the ungraded market price.");
    }
  }

  const marketValue = unitValue === null ? null : unitValue.times(qty);
  const gain = marketValue === null ? null : marketValue.minus(costBasis);
  const gainPct = gain === null || costBasis.isZero() ? null : gain.div(costBasis).times(100);

  return {
    lot,
    costBasis,
    unitCostBasis: costBasis.div(qty),
    unitValue,
    marketValue,
    gain,
    gainPct,
    priceStatus,
    priceAsOf,
    warnings,
  };
}

export interface PositionSummary {
  itemKey: string;
  itemName: string;
  assetType: AssetType;
  currency: string;
  quantity: number;
  costBasis: Decimal;
  /** Weighted average cost per unit across lots, fees included. */
  averageUnitCost: Decimal;
  marketValue: Decimal | null;
  gain: Decimal | null;
  gainPct: Decimal | null;
  lots: LotValuation[];
  priceStatus: PriceStatus;
}

/** Aggregate lots of the same item and currency into one position. */
export function groupPositions(valuations: LotValuation[]): PositionSummary[] {
  const groups = new Map<string, LotValuation[]>();
  for (const v of valuations) {
    const key = `${v.lot.itemKey}|${v.lot.currency.toUpperCase()}`;
    const list = groups.get(key) ?? [];
    list.push(v);
    groups.set(key, list);
  }
  return [...groups.values()].map((lots) => {
    const first = lots[0].lot;
    const quantity = lots.reduce((n, l) => n + l.lot.quantity, 0);
    const costBasis = sum(lots.map((l) => l.costBasis));
    const allValued = lots.every((l) => l.marketValue !== null);
    const marketValue = allValued ? sum(lots.map((l) => l.marketValue!)) : null;
    const gain = marketValue === null ? null : marketValue.minus(costBasis);
    const statuses = lots.map((l) => l.priceStatus);
    const priceStatus: PriceStatus = statuses.includes("missing")
      ? "missing"
      : statuses.includes("currency_mismatch")
        ? "currency_mismatch"
        : statuses.includes("stale")
          ? "stale"
          : statuses.includes("manual")
            ? "manual"
            : "fresh";
    return {
      itemKey: first.itemKey,
      itemName: first.itemName,
      assetType: first.assetType,
      currency: first.currency.toUpperCase(),
      quantity,
      costBasis,
      averageUnitCost: costBasis.div(quantity),
      marketValue,
      gain,
      gainPct: gain === null || costBasis.isZero() ? null : gain.div(costBasis).times(100),
      lots,
      priceStatus,
    };
  });
}

export interface PortfolioTotals {
  currency: string;
  /** Cost basis of every lot. */
  costBasis: Decimal;
  /** Cost basis of lots that have a market value (the denominator for gain %). */
  valuedCostBasis: Decimal;
  marketValue: Decimal;
  unrealizedGain: Decimal;
  unrealizedGainPct: Decimal | null;
  sealedValue: Decimal;
  cardValue: Decimal;
  sealedQuantity: number;
  cardQuantity: number;
  lotCount: number;
  missingPriceLots: number;
  stalePriceLots: number;
  manualPriceLots: number;
}

/** Portfolio totals per currency. */
export function summarize(valuations: LotValuation[]): PortfolioTotals[] {
  const byCurrency = new Map<string, LotValuation[]>();
  for (const v of valuations) {
    const c = v.lot.currency.toUpperCase();
    byCurrency.set(c, [...(byCurrency.get(c) ?? []), v]);
  }
  return [...byCurrency.entries()].map(([currency, lots]) => {
    const valued = lots.filter((l) => l.marketValue !== null);
    const marketValue = sum(valued.map((l) => l.marketValue!));
    const valuedCostBasis = sum(valued.map((l) => l.costBasis));
    const unrealizedGain = marketValue.minus(valuedCostBasis);
    return {
      currency,
      costBasis: sum(lots.map((l) => l.costBasis)),
      valuedCostBasis,
      marketValue,
      unrealizedGain,
      unrealizedGainPct: valuedCostBasis.isZero() ? null : unrealizedGain.div(valuedCostBasis).times(100),
      sealedValue: sum(valued.filter((l) => l.lot.assetType === "sealed").map((l) => l.marketValue!)),
      cardValue: sum(valued.filter((l) => l.lot.assetType === "card").map((l) => l.marketValue!)),
      sealedQuantity: lots.filter((l) => l.lot.assetType === "sealed").reduce((n, l) => n + l.lot.quantity, 0),
      cardQuantity: lots.filter((l) => l.lot.assetType === "card").reduce((n, l) => n + l.lot.quantity, 0),
      lotCount: lots.length,
      missingPriceLots: lots.filter((l) => l.priceStatus === "missing" || l.priceStatus === "currency_mismatch")
        .length,
      stalePriceLots: lots.filter((l) => l.priceStatus === "stale").length,
      manualPriceLots: lots.filter((l) => l.priceStatus === "manual").length,
    };
  });
}
