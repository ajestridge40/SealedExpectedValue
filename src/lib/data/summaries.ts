import type { ConfidenceLevel } from "../ev";
import type { DataSource, PriceKind, ProductType } from "./types";

/** Plain, serializable view of a product + its EV, for lists and client components. */
export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  setName: string | null;
  gameId: string;
  gameName: string | null;
  setId: string | null;
  setImageUrl: string | null;
  productType: ProductType;
  releaseDate: string | null;
  imageUrl: string | null;
  packCount: number | null;
  price: string | null;
  currency: string;
  priceKind: PriceKind | null;
  priceSourceName: string | null;
  priceUpdatedAt: string | null;
  ev: string | null;
  evStatus: "complete" | "partial" | "insufficient" | "no_model";
  confidence: ConfidenceLevel;
  pullRateConfidence: ConfidenceLevel;
  freshness: "fresh" | "aging" | "stale" | "unknown";
  probabilityCoverage: number;
  priceCoverage: number;
  ratio: string | null;
  net: string | null;
  netPct: string | null;
  isSample: boolean;
  /** Sum of the set's five most valuable cards (market prices). */
  top5Value: number | null;
  /** top5Value ÷ market price: a quick set-strength indicator, not an EV. */
  top5Ratio: number | null;
  chaseCards: number | null;
  cardsAbove50: number | null;
  /** Price change over 7 days, in percent. */
  change7d: number | null;
}

/** A row of the product_overview database view. */
export interface OverviewRow {
  id: string;
  game_id: string;
  set_id: string | null;
  name: string;
  slug: string;
  product_type: ProductType;
  release_date: string | null;
  image_url: string | null;
  pack_count: number | null;
  current_price: number | string | null;
  current_price_currency: string | null;
  current_price_kind: PriceKind | null;
  current_price_source_id: string | null;
  price_updated_at: string | null;
  is_sample: boolean;
  price_change_7d: number | string | null;
  set_name: string | null;
  set_image_url: string | null;
  set_symbol_url: string | null;
  game_name: string | null;
  top5_value: number | string | null;
  chase_cards: number | null;
  cards_above_50: number | null;
  top5_ratio: number | string | null;
  ev_status: ProductSummary["evStatus"];
  gross_ev: number | string | null;
  confidence: ConfidenceLevel;
  pull_rate_confidence: ConfidenceLevel;
  freshness: ProductSummary["freshness"];
  probability_coverage: number;
  price_coverage: number;
  ev_ratio: number | string | null;
  net_ev: number | string | null;
  net_pct: number | string | null;
}

const str = (v: number | string | null) => (v === null || v === undefined ? null : String(v));
const num = (v: number | string | null) => (v === null || v === undefined ? null : Number(v));

export function overviewToSummary(r: OverviewRow, sources: Map<string, DataSource>): ProductSummary {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    setName: r.set_name,
    setId: r.set_id,
    setImageUrl: r.set_image_url ?? r.set_symbol_url,
    gameId: r.game_id,
    gameName: r.game_name,
    productType: r.product_type,
    releaseDate: r.release_date,
    imageUrl: r.image_url,
    packCount: r.pack_count,
    price: str(r.current_price),
    currency: r.current_price_currency ?? "USD",
    priceKind: r.current_price_kind,
    priceSourceName: r.current_price_source_id ? (sources.get(r.current_price_source_id)?.name ?? null) : null,
    priceUpdatedAt: r.price_updated_at,
    ev: r.gross_ev === null ? null : Number(r.gross_ev).toFixed(2),
    evStatus: r.ev_status,
    confidence: r.confidence,
    pullRateConfidence: r.pull_rate_confidence,
    freshness: r.freshness,
    probabilityCoverage: Number(r.probability_coverage),
    priceCoverage: Number(r.price_coverage),
    ratio: str(r.ev_ratio),
    net: r.net_ev === null ? null : Number(r.net_ev).toFixed(2),
    netPct: str(r.net_pct),
    isSample: r.is_sample,
    top5Value: num(r.top5_value) || null,
    top5Ratio: num(r.top5_ratio),
    chaseCards: r.chase_cards,
    cardsAbove50: r.cards_above_50,
    change7d: num(r.price_change_7d),
  };
}

export interface ProductFilters {
  q?: string;
  game?: string;
  set?: string;
  type?: string;
  minPrice?: number;
  maxPrice?: number;
  minRatio?: number;
  net?: "positive" | "negative";
  confidence?: ConfidenceLevel;
  sort?: "ratio" | "ev" | "price" | "net" | "release" | "top5" | "change";
}
