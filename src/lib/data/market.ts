import "server-only";
import { cache } from "react";
import { createClient } from "../supabase/server";

export interface SetStats {
  set_id: string;
  total_cards: number;
  priced_cards: number;
  cards_above_10: number;
  chase_cards: number;
  cards_above_50: number;
  alt_art_cards: number;
  top5_value: number;
  top_card_price: number | null;
}

export interface PriceChange {
  sealed_product_id: string;
  currency: string;
  price_now: number;
  price_then: number;
  pct_change: number | null;
  as_of: string;
  then_as_of: string;
}

/** Card value profile of one set (materialized view set_stats, refreshed with prices). */
export const getSetStats = cache(async (setId: string | null | undefined): Promise<SetStats | null> => {
  if (!setId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("set_stats").select("*").eq("set_id", setId).maybeSingle();
  if (error) throw new Error(error.message);
  return data && data.total_cards > 0 ? ({ ...data, top5_value: Number(data.top5_value) } as SetStats) : null;
});

/** Sealed product price changes over `days` (database function sealed_price_changes). */
export const getPriceChanges = cache(async (days = 7): Promise<Map<string, PriceChange>> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sealed_price_changes", { p_days: days });
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as PriceChange[]).map((r) => [
      r.sealed_product_id,
      {
        ...r,
        price_now: Number(r.price_now),
        price_then: Number(r.price_then),
        pct_change: r.pct_change === null ? null : Number(r.pct_change),
      },
    ]),
  );
});
