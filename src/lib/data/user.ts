import "server-only";
import { getUser } from "../auth";
import { createClient } from "../supabase/server";

export async function isWatching(kind: "sealed" | "card", id: string): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("watchlist_items")
    .select("id")
    .eq(kind === "sealed" ? "sealed_product_id" : "card_id", id)
    .maybeSingle();
  return Boolean(data);
}
