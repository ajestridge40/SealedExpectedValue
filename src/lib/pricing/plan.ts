import type { ProviderPrice } from "./types";

/*
 * Pure planning step of the price refresh: turn provider prices into
 * price_snapshots rows for the catalog items we track. Kept free of database
 * code so it can be tested with mocked provider responses.
 */

export interface TrackedProduct {
  id: string;
  tcgplayer_product_id: number | null;
}

export interface TrackedCard extends TrackedProduct {
  printing: string;
  /** Current stored price; when given, unchanged prices are not written again. */
  current_price?: number | string | null;
  current_price_currency?: string | null;
  current_price_kind?: string | null;
}

export interface SnapshotRow {
  sealed_product_id: string | null;
  card_id: string | null;
  source_id: string;
  source_kind: "provider";
  currency: string;
  market_price: string | null;
  low_price: string | null;
  mid_price: string | null;
  high_price: string | null;
  captured_at: string;
  provider_as_of: string | null;
  snapshot_date: string;
}

const money = (n: number | null) => (n === null ? null : n.toFixed(2));

export function planSnapshots(args: {
  products: TrackedProduct[];
  cards: TrackedCard[];
  prices: ProviderPrice[];
  sourceId: string;
  capturedAt: Date;
}): { rows: SnapshotRow[]; unchangedCards: string[]; unpricedProducts: string[]; unpricedCards: string[] } {
  const byProductId = new Map<number, ProviderPrice[]>();
  for (const p of args.prices) {
    const productId = Number(p.externalId.split(":").pop());
    byProductId.set(productId, [...(byProductId.get(productId) ?? []), p]);
  }
  const base = (p: ProviderPrice) => ({
    source_id: args.sourceId,
    source_kind: "provider" as const,
    currency: p.currency,
    market_price: money(p.market),
    low_price: money(p.low),
    mid_price: money(p.mid),
    high_price: money(p.high),
    captured_at: args.capturedAt.toISOString(),
    provider_as_of: p.asOf ? p.asOf.toISOString() : null,
    snapshot_date: args.capturedAt.toISOString().slice(0, 10),
  });

  const rows: SnapshotRow[] = [];
  const unpricedProducts: string[] = [];
  const unpricedCards: string[] = [];
  // Cards get a history row only when their market price changes; unchanged
  // cards are just marked current (keeps the database small for ~1M cards).
  // Sealed products always get a daily row: their history drives the charts.
  const unchangedCards: string[] = [];

  for (const product of args.products) {
    if (product.tcgplayer_product_id === null) continue;
    const candidates = byProductId.get(product.tcgplayer_product_id) ?? [];
    const price = candidates.find((c) => c.market !== null) ?? candidates[0];
    if (!price || price.market === null) {
      unpricedProducts.push(product.id);
      if (!price) continue;
    }
    rows.push({ sealed_product_id: product.id, card_id: null, ...base(price) });
  }

  for (const card of args.cards) {
    if (card.tcgplayer_product_id === null) continue;
    const price = (byProductId.get(card.tcgplayer_product_id) ?? []).find(
      (c) => (c.printing ?? "Normal").toLowerCase() === card.printing.toLowerCase(),
    );
    if (!price || price.market === null) {
      unpricedCards.push(card.id);
      if (!price) continue;
    }
    const current = card.current_price === null || card.current_price === undefined ? null : Number(card.current_price);
    if (
      price.market !== null &&
      current !== null &&
      card.current_price_kind === "provider" &&
      (card.current_price_currency ?? "USD") === price.currency &&
      Math.round(current * 100) === Math.round(price.market * 100)
    ) {
      unchangedCards.push(card.id);
      continue;
    }
    rows.push({ sealed_product_id: null, card_id: card.id, ...base(price) });
  }

  return { rows, unchangedCards, unpricedProducts, unpricedCards };
}
