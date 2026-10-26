import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Everything stored about the signed-in user, as JSON (data portability). RLS limits rows to the owner. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const supabase = await createClient();
  const [profile, sealed, cards, watchlist] = await Promise.all([
    supabase.from("profiles").select("display_name, default_currency, preferred_game_id, price_stale_after_hours, created_at").eq("id", user.id).maybeSingle(),
    supabase.from("collection_sealed_positions").select("*, sealed_products(name, slug)").limit(10000),
    supabase.from("collection_card_positions").select("*, cards(name, number, printing, rarity)").limit(10000),
    supabase.from("watchlist_items").select("*, sealed_products(name, slug), cards(name, number, printing)").limit(10000),
  ]);
  const body = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    profile: profile.data,
    collection_sealed_lots: sealed.data ?? [],
    collection_card_lots: cards.data ?? [],
    watchlist: watchlist.data ?? [],
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sealedev-account-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
