import "server-only";
import { cache } from "react";
import { createClient } from "../supabase/server";
import { fetchAll, inBatches } from "./fetch-all";
import {
  CARD_COLUMNS,
  PRODUCT_COLUMNS,
  type CardCatalogRow,
  type DataSource,
  type Game,
  type ProductRow,
  type SetRow,
  type SnapshotPoint,
} from "./types";

export const getGames = cache(async (): Promise<Game[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("games").select("id, slug, name").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getSets = cache(async (): Promise<SetRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sets")
    .select("id, game_id, name, code, release_date, tcgplayer_group_id")
    .order("release_date", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getDataSources = cache(async (): Promise<Map<string, DataSource>> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("data_sources").select("id, slug, name, kind, website_url, attribution");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((d) => [d.id, d as DataSource]));
});

export const getAllProducts = cache(async (): Promise<ProductRow[]> => {
  const supabase = await createClient();
  return fetchAll<ProductRow>((from, to) =>
    supabase.from("sealed_products").select(PRODUCT_COLUMNS).order("name").range(from, to),
  );
});

export async function getProductBySlug(slug: string): Promise<ProductRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("sealed_products").select(PRODUCT_COLUMNS).eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data as ProductRow | null;
}

export async function getCardById(id: string): Promise<CardCatalogRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cards").select(CARD_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as CardCatalogRow | null;
}

export async function getCardsForSets(setIds: string[]): Promise<CardCatalogRow[]> {
  if (setIds.length === 0) return [];
  const supabase = await createClient();
  // A few sets per batch (each set can have hundreds of cards), paged within each batch.
  return inBatches<CardCatalogRow, string>(
    setIds,
    async (batch) => ({
      data: await fetchAll<CardCatalogRow>((from, to) =>
        supabase.from("cards").select(CARD_COLUMNS).in("set_id", batch).order("id").range(from, to),
      ),
      error: null,
    }),
    20,
  );
}

export interface CardSearch {
  q?: string;
  gameId?: string;
  setId?: string;
  rarity?: string;
  sort?: "price_desc" | "price_asc" | "name" | "number";
  page?: number;
  pageSize?: number;
}

export async function searchCards(s: CardSearch): Promise<{ rows: CardCatalogRow[]; total: number }> {
  const supabase = await createClient();
  const pageSize = s.pageSize ?? 48;
  const page = Math.max(1, s.page ?? 1);
  let query = supabase.from("cards").select(CARD_COLUMNS, { count: "exact" });
  if (s.q) query = query.ilike("name", `%${s.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (s.gameId) query = query.eq("game_id", s.gameId);
  if (s.setId) query = query.eq("set_id", s.setId);
  if (s.rarity) query = query.eq("rarity", s.rarity);
  switch (s.sort ?? "price_desc") {
    case "price_asc":
      query = query.order("current_price", { ascending: true, nullsFirst: false });
      break;
    case "name":
      query = query.order("name");
      break;
    case "number":
      query = query.order("number");
      break;
    default:
      query = query.order("current_price", { ascending: false, nullsFirst: false });
  }
  const { data, error, count } = await query.order("id").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as CardCatalogRow[], total: count ?? 0 };
}

export async function getRarities(setId?: string): Promise<string[]> {
  const supabase = await createClient();
  let q = supabase.from("cards").select("rarity").not("rarity", "is", null).limit(5000);
  if (setId) q = q.eq("set_id", setId);
  const { data } = await q;
  return [...new Set((data ?? []).map((r) => r.rarity as string))].sort();
}

export async function getPriceHistory(
  item: { productId: string } | { cardId: string },
  days = 365,
): Promise<SnapshotPoint[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let q = supabase
    .from("price_snapshots")
    .select("captured_at, provider_as_of, market_price, low_price, currency, source_kind, source_id")
    .gte("captured_at", since)
    .not("market_price", "is", null)
    .order("captured_at");
  q = "productId" in item ? q.eq("sealed_product_id", item.productId) : q.eq("card_id", item.cardId);
  const { data, error } = await q.limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as SnapshotPoint[];
}

export async function getRecentlyUpdatedProducts(limit = 6): Promise<ProductRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sealed_products")
    .select(PRODUCT_COLUMNS)
    .not("price_updated_at", "is", null)
    .order("price_updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductRow[];
}

export async function getLastRefresh(): Promise<{ finished_at: string | null; status: string } | null> {
  // job_runs is admin-only under RLS; fall back to the newest provider price.
  const supabase = await createClient();
  const { data } = await supabase
    .from("price_snapshots")
    .select("captured_at")
    .eq("source_kind", "provider")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { finished_at: data.captured_at as string, status: "succeeded" } : null;
}
