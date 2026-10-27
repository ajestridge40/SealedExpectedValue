import "server-only";
import { cache } from "react";
import { createClient } from "../supabase/server";
import { sanitizeSearch } from "./products";

/** One row of the set_overview view. */
export interface SetOverview {
  id: string;
  game_id: string;
  name: string;
  code: string | null;
  release_date: string | null;
  image_url: string | null;
  symbol_url: string | null;
  tcgplayer_group_id: number | null;
  prices_synced_at: string | null;
  game_name: string;
  game_slug: string;
  cover_image_url: string | null;
  total_cards: number;
  priced_cards: number;
  chase_cards: number;
  cards_above_50: number;
  top5_value: number;
  top_card_price: number | null;
  sealed_products: number;
  box_price: number | null;
  box_top5_ratio: number | null;
}

export const SET_SORTS = ["release", "top5", "ratio", "name"] as const;
export type SetSort = (typeof SET_SORTS)[number];

export interface SetQuery {
  game?: string;
  q?: string;
  sort?: SetSort;
  page?: number;
  pageSize?: number;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toSet = (r: Record<string, unknown>) =>
  ({
    ...r,
    top5_value: Number(r.top5_value),
    top_card_price: num(r.top_card_price),
    box_price: num(r.box_price),
    box_top5_ratio: num(r.box_top5_ratio),
  }) as SetOverview;

export async function querySets(s: SetQuery): Promise<{ rows: SetOverview[]; total: number }> {
  const supabase = await createClient();
  const pageSize = s.pageSize ?? 48;
  const page = Math.max(1, s.page ?? 1);
  let query = supabase.from("set_overview").select("*", { count: "exact" });
  if (s.game) query = query.eq("game_id", s.game);
  const q = s.q ? sanitizeSearch(s.q) : "";
  if (q) query = query.or(`name.ilike.*${q}*,code.ilike.*${q}*`);
  switch (s.sort ?? "release") {
    case "top5":
      query = query.order("top5_value", { ascending: false });
      break;
    case "ratio":
      query = query.order("box_top5_ratio", { ascending: false, nullsFirst: false });
      break;
    case "name":
      query = query.order("name");
      break;
    default:
      query = query.order("release_date", { ascending: false, nullsFirst: false });
  }
  const { data, error, count } = await query.order("id").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []).map(toSet), total: count ?? 0 };
}

export const getSetOverview = cache(async (id: string): Promise<SetOverview | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("set_overview").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toSet(data) : null;
});
