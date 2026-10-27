import "server-only";
import type { ConfidenceLevel } from "../ev";
import { createClient } from "../supabase/server";
import { getDataSources } from "./catalog";
import { inBatches } from "./fetch-all";
import { overviewToSummary, type OverviewRow, type ProductFilters, type ProductSummary } from "./summaries";

/*
 * Product lists read the product_overview view (prices, set stats and stored
 * EV results joined in the database), so filtering, sorting and pagination
 * happen in SQL and stay fast with the full multi-game catalog.
 */

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { insufficient: 0, low: 1, medium: 2, high: 3 };

/** Letters, digits, spaces and a few safe characters (keeps PostgREST filter syntax intact). */
export function sanitizeSearch(q: string): string {
  return q
    .replace(/[^\p{L}\p{N}\s'&.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function toSummaries(rows: OverviewRow[]): Promise<ProductSummary[]> {
  const sources = await getDataSources();
  return rows.map((r) => overviewToSummary(r, sources));
}

export async function queryProducts(
  f: ProductFilters,
  opts: { page?: number; pageSize?: number } = {},
): Promise<{ rows: ProductSummary[]; total: number }> {
  const supabase = await createClient();
  const pageSize = opts.pageSize ?? 48;
  const page = Math.max(1, opts.page ?? 1);
  let q = supabase.from("product_overview").select("*", { count: "exact" });
  const text = f.q ? sanitizeSearch(f.q) : "";
  if (text) q = q.or(`name.ilike.*${text}*,set_name.ilike.*${text}*`);
  if (f.game) q = q.eq("game_id", f.game);
  if (f.set) q = q.eq("set_id", f.set);
  if (f.type) q = q.eq("product_type", f.type);
  if (f.minPrice !== undefined) q = q.gte("current_price", f.minPrice);
  if (f.maxPrice !== undefined) q = q.lte("current_price", f.maxPrice);
  if (f.minRatio !== undefined) q = q.gte("ev_ratio", f.minRatio);
  if (f.net === "positive") q = q.gt("net_ev", 0);
  if (f.net === "negative") q = q.lt("net_ev", 0);
  if (f.confidence) q = q.gte("confidence_rank", CONFIDENCE_RANK[f.confidence]);

  const desc = { ascending: false, nullsFirst: false };
  const asc = { ascending: true, nullsFirst: false };
  switch (f.sort ?? "ratio") {
    case "ev":
      q = q.order("gross_ev", desc);
      break;
    case "price":
      q = q.order("current_price", asc);
      break;
    case "net":
      q = q.order("net_pct", desc);
      break;
    case "release":
      q = q.order("release_date", desc);
      break;
    case "top5":
      q = q.order("top5_ratio", desc);
      break;
    case "change":
      q = q.order("price_change_7d", asc);
      break;
    default:
      // Best EV ratio first; products without EV follow, strongest sets first.
      q = q.order("ev_ratio", desc).order("top5_ratio", desc);
  }
  const { data, error, count } = await q.order("name").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: await toSummaries((data ?? []) as OverviewRow[]), total: count ?? 0 };
}

/** Specific products (compare, watchlist), in the order given. */
export async function getProductSummaries(productIds: string[]): Promise<ProductSummary[]> {
  if (productIds.length === 0) return [];
  const supabase = await createClient();
  const rows = await inBatches<OverviewRow, string>(productIds, (batch) =>
    supabase.from("product_overview").select("*").in("id", batch),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return toSummaries(productIds.map((id) => byId.get(id)).filter((r): r is OverviewRow => Boolean(r)));
}

/** Small product search for pickers (compare, add to collection). */
export async function searchProductOptions(
  q: string,
  limit = 25,
): Promise<{ id: string; name: string; setName: string | null }[]> {
  const text = sanitizeSearch(q);
  if (!text) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_overview")
    .select("id, name, set_name")
    .or(`name.ilike.*${text}*,set_name.ilike.*${text}*`)
    .order("current_price", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    setName: r.set_name as string | null,
  }));
}

export interface MarketOverview {
  priced: number;
  boxes: number;
  with_ev: number;
  avg_ev_ratio: number | null;
  ev_at_or_above_1: number;
  boxes_with_top5: number;
  avg_box_top5_ratio: number | null;
  box_top5_at_or_above_1: number;
}

/** Everything the dashboard's market section needs, from a handful of small queries. */
export async function getDashboardData() {
  const supabase = await createClient();
  const page = async (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>, limit: number) => {
    const { data, error } = await build(base()).limit(limit);
    if (error) throw new Error(error.message);
    return toSummaries((data ?? []) as OverviewRow[]);
  };
  const base = () => supabase.from("product_overview").select("*");
  const { data: overview, error } = await supabase.rpc("market_overview");
  if (error) throw new Error(error.message);
  const o = overview as MarketOverview;
  const useEv = o.with_ev >= 3;
  const desc = { ascending: false, nullsFirst: false };

  const [shortlist, ranked, drops, strongestSets, recentlyPriced] = await Promise.all([
    page((q) => q.not("ev_ratio", "is", null).order("ev_ratio", desc), 4),
    useEv
      ? page((q) => q.not("ev_ratio", "is", null).order("ev_ratio", desc), 200)
      : page((q) => q.eq("product_type", "booster_box").not("top5_ratio", "is", null).order("top5_ratio", desc), 200),
    page((q) => q.lt("price_change_7d", 0).order("price_change_7d", { ascending: true }), 8),
    page((q) => q.eq("product_type", "booster_box").not("top5_ratio", "is", null).order("top5_ratio", desc), 10),
    page((q) => q.not("price_updated_at", "is", null).order("price_updated_at", { ascending: false }), 6),
  ]);
  return { overview: o, useEv, shortlist, ranked, drops, strongestSets, recentlyPriced };
}
