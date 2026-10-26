import type { ConfidenceLevel } from "../ev";
import type { ProductEv } from "./ev";
import type { DataSource, Game, PriceKind, ProductType, SetRow } from "./types";

/** Plain, serializable view of a product + its EV, for lists and client components. */
export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  setName: string | null;
  gameId: string;
  gameName: string | null;
  setId: string | null;
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
}

export function toSummary(
  pe: ProductEv,
  ctx: { sets: SetRow[]; games: Game[]; sources: Map<string, DataSource> },
): ProductSummary {
  const p = pe.product;
  const set = ctx.sets.find((s) => s.id === p.set_id);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    setName: set?.name ?? null,
    setId: p.set_id,
    gameId: p.game_id,
    gameName: ctx.games.find((g) => g.id === p.game_id)?.name ?? null,
    productType: p.product_type,
    releaseDate: p.release_date,
    imageUrl: p.image_url,
    packCount: p.pack_count,
    price: p.current_price === null ? null : String(p.current_price),
    currency: p.current_price_currency ?? "USD",
    priceKind: p.current_price_kind,
    priceSourceName: p.current_price_source_id ? (ctx.sources.get(p.current_price_source_id)?.name ?? null) : null,
    priceUpdatedAt: p.price_updated_at,
    ev: pe.ev?.grossEv?.toFixed(2) ?? null,
    evStatus: pe.ev ? pe.ev.status : "no_model",
    confidence: pe.ev?.confidence ?? "insufficient",
    pullRateConfidence: pe.ev?.pullRateConfidence ?? "insufficient",
    freshness: pe.ev?.freshness.label ?? "unknown",
    probabilityCoverage: pe.ev?.probabilityCoverage ?? 0,
    priceCoverage: pe.ev?.priceCoverage ?? 0,
    ratio: pe.returns.evToPrice?.toFixed(4) ?? null,
    net: pe.returns.netEv?.toFixed(2) ?? null,
    netPct: pe.returns.netReturnPct?.toFixed(2) ?? null,
    isSample: p.is_sample,
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
  sort?: "ratio" | "ev" | "price" | "net" | "release";
}

const CONF_RANK: Record<ConfidenceLevel, number> = { insufficient: 0, low: 1, medium: 2, high: 3 };

/** Filter and sort in memory (the catalog is small; EV is computed per request anyway). */
export function filterProducts(items: ProductSummary[], f: ProductFilters): ProductSummary[] {
  const q = f.q?.toLowerCase();
  const out = items.filter((p) => {
    if (q && !`${p.name} ${p.setName ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.game && p.gameId !== f.game) return false;
    if (f.set && p.setId !== f.set) return false;
    if (f.type && p.productType !== f.type) return false;
    const price = p.price === null ? null : Number(p.price);
    if (f.minPrice !== undefined && (price === null || price < f.minPrice)) return false;
    if (f.maxPrice !== undefined && (price === null || price > f.maxPrice)) return false;
    if (f.minRatio !== undefined && (p.ratio === null || Number(p.ratio) < f.minRatio)) return false;
    if (f.net === "positive" && (p.net === null || Number(p.net) <= 0)) return false;
    if (f.net === "negative" && (p.net === null || Number(p.net) >= 0)) return false;
    if (f.confidence && CONF_RANK[p.confidence] < CONF_RANK[f.confidence]) return false;
    return true;
  });
  // Items without the sort value go last regardless of direction.
  const num = (v: string | null) => (v === null ? null : Number(v));
  const by = (get: (p: ProductSummary) => number | null, dir: 1 | -1) => (a: ProductSummary, b: ProductSummary) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * dir || a.name.localeCompare(b.name);
  };
  switch (f.sort ?? "ratio") {
    case "ev":
      return out.sort(by((p) => num(p.ev), -1));
    case "price":
      return out.sort(by((p) => num(p.price), 1));
    case "net":
      return out.sort(by((p) => num(p.netPct), -1));
    case "release":
      return out.sort(by((p) => (p.releaseDate ? Date.parse(p.releaseDate) : null), -1));
    default:
      return out.sort(by((p) => num(p.ratio), -1));
  }
}
