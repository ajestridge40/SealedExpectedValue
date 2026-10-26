/*
 * Market signals derived from stored price snapshots (no external calls).
 * Display-only indicators, so plain numbers are fine here; money totals still
 * go through decimal.js elsewhere.
 */

export interface PricePoint {
  /** ISO timestamp the price was observed. */
  t: string;
  price: number;
}

const DAY = 86_400_000;

/** Latest price at or before `at`, or null when history does not reach back that far. */
export function priceAt(history: PricePoint[], at: Date): number | null {
  let best: PricePoint | null = null;
  for (const p of history) {
    const t = Date.parse(p.t);
    if (t <= at.getTime() && (!best || t > Date.parse(best.t))) best = p;
  }
  return best?.price ?? null;
}

/**
 * Price change over `days`, as a fraction (0.1 = +10%):
 * (latest price − price `days` ago) / price `days` ago.
 */
export function momentum(history: PricePoint[], days: number, now = new Date()): number | null {
  if (history.length < 2) return null;
  const latest = priceAt(history, now);
  const then = priceAt(history, new Date(now.getTime() - days * DAY));
  if (latest === null || then === null || then <= 0) return null;
  return (latest - then) / then;
}

/**
 * Coefficient of variation (standard deviation / mean) of prices observed in
 * the last `days` days. Needs at least 3 observations.
 */
export function volatility(history: PricePoint[], days = 30, now = new Date()): number | null {
  const cutoff = now.getTime() - days * DAY;
  const prices = history.filter((p) => Date.parse(p.t) >= cutoff).map((p) => p.price);
  if (prices.length < 3) return null;
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (mean <= 0) return null;
  const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / (prices.length - 1);
  return Math.sqrt(variance) / mean;
}

/**
 * Gap between market price and lowest listing, as a fraction of market price.
 * A rough liquidity signal: a small gap means listings sit close to recent sales.
 */
export function listingSpread(market: number | null, low: number | null): number | null {
  if (market === null || low === null || market <= 0 || low <= 0) return null;
  return Math.min(1, Math.max(0, (market - low) / market));
}

/** Top-5 card value ÷ box price: a quick set-strength indicator. Not an EV. */
export function topValueRatio(top5Value: number | null, boxPrice: number | null): number | null {
  if (top5Value === null || boxPrice === null || boxPrice <= 0 || top5Value <= 0) return null;
  return top5Value / boxPrice;
}

export function daysSince(date: string | null | undefined, now = new Date()): number | null {
  if (!date) return null;
  const t = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / DAY);
}
