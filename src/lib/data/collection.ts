import "server-only";
import { getProfile, requireUser, staleAfterHours } from "../auth";
import { summarize, valueLot, type LotInput, type LotValuation, type PortfolioTotals } from "../portfolio/valuation";
import { createClient } from "../supabase/server";
import { getSetsByIds } from "./catalog";
import type { PriceKind } from "./types";

interface PricedItem {
  id: string;
  name: string;
  image_url: string | null;
  set_id: string | null;
  current_price: number | null;
  current_price_currency: string | null;
  current_price_kind: PriceKind | null;
  price_updated_at: string | null;
}

export interface SealedLotRow {
  id: string;
  sealed_product_id: string | null;
  custom_name: string | null;
  custom_set_name: string | null;
  quantity: number;
  purchase_price_per_unit: number;
  currency: string;
  purchase_date: string | null;
  fees: number;
  shipping: number;
  condition: string | null;
  storage_location: string | null;
  notes: string | null;
  manual_unit_value: number | null;
  manual_value_as_of: string | null;
  created_at: string;
  sealed_products: (PricedItem & { slug: string }) | null;
}

export interface CardLotRow {
  id: string;
  card_id: string | null;
  custom_name: string | null;
  custom_set_name: string | null;
  quantity: number;
  purchase_price_per_unit: number;
  currency: string;
  purchase_date: string | null;
  condition: string | null;
  language: string;
  grading_company: string | null;
  grade: string | null;
  grading_fees: number;
  acquisition_fees: number;
  notes: string | null;
  manual_unit_value: number | null;
  manual_value_as_of: string | null;
  created_at: string;
  cards: (PricedItem & { number: string | null; rarity: string | null; printing: string }) | null;
}

export interface CollectionEntry {
  id: string;
  type: "sealed" | "card";
  name: string;
  detail: string | null;
  setName: string | null;
  href: string | null;
  imageUrl: string | null;
  priceKind: PriceKind | null;
  createdAt: string;
  sealed?: SealedLotRow;
  card?: CardLotRow;
  valuation: LotValuation;
}

const SEALED_SELECT =
  "*, sealed_products(id, name, slug, image_url, set_id, current_price, current_price_currency, current_price_kind, price_updated_at)";
const CARD_SELECT =
  "*, cards(id, name, number, rarity, printing, image_url, set_id, current_price, current_price_currency, current_price_kind, price_updated_at)";

function price(item: PricedItem | null) {
  return item && item.current_price !== null
    ? {
        amount: String(item.current_price),
        currency: item.current_price_currency ?? "USD",
        asOf: item.price_updated_at,
      }
    : null;
}

function manual(v: number | null, asOf: string | null) {
  return v === null ? null : { amount: String(v), asOf };
}

/** The signed-in user's lots (RLS restricts rows to the owner), valued lot by lot. */
export async function getCollection(): Promise<{
  entries: CollectionEntry[];
  totals: PortfolioTotals[];
  currency: string;
}> {
  await requireUser("/collection");
  const supabase = await createClient();
  const [sealed, cards, stale, profile] = await Promise.all([
    supabase
      .from("collection_sealed_positions")
      .select(SEALED_SELECT)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("collection_card_positions")
      .select(CARD_SELECT)
      .order("created_at", { ascending: false })
      .limit(5000),
    staleAfterHours(),
    getProfile(),
  ]);
  if (sealed.error) throw new Error(sealed.error.message);
  if (cards.error) throw new Error(cards.error.message);
  const sets = await getSetsByIds(
    [
      ...(sealed.data as SealedLotRow[]).map((r) => r.sealed_products?.set_id),
      ...(cards.data as CardLotRow[]).map((r) => r.cards?.set_id),
    ].filter((id): id is string => Boolean(id)),
  );
  const setName = (id: string | null | undefined) => sets.find((s) => s.id === id)?.name ?? null;
  const now = new Date();

  const entries: CollectionEntry[] = [
    ...(sealed.data as SealedLotRow[]).map((r) => {
      const p = r.sealed_products;
      const lot: LotInput = {
        id: r.id,
        assetType: "sealed",
        itemKey: p ? `sealed:${p.id}` : `custom-sealed:${(r.custom_name ?? "").toLowerCase()}`,
        itemName: p?.name ?? r.custom_name ?? "Custom item",
        quantity: r.quantity,
        unitPrice: String(r.purchase_price_per_unit),
        extraCosts: [String(r.fees), String(r.shipping)],
        currency: r.currency,
        purchaseDate: r.purchase_date,
        marketPrice: price(p),
        manualUnitValue: manual(r.manual_unit_value, r.manual_value_as_of),
      };
      return {
        id: r.id,
        type: "sealed" as const,
        name: lot.itemName,
        detail: r.condition,
        setName: p ? setName(p.set_id) : r.custom_set_name,
        href: p ? `/products/${p.slug}` : null,
        imageUrl: p?.image_url ?? null,
        priceKind: r.manual_unit_value !== null ? ("manual" as const) : (p?.current_price_kind ?? null),
        createdAt: r.created_at,
        sealed: r,
        valuation: valueLot(lot, { now, staleAfterHours: stale }),
      };
    }),
    ...(cards.data as CardLotRow[]).map((r) => {
      const c = r.cards;
      const graded = Boolean(r.grading_company && r.grading_company !== "None");
      const lot: LotInput = {
        id: r.id,
        assetType: "card",
        itemKey: c
          ? `card:${c.id}:${graded ? `${r.grading_company}-${r.grade}` : (r.condition ?? "")}`
          : `custom-card:${(r.custom_name ?? "").toLowerCase()}`,
        itemName: c ? `${c.name}${c.number ? ` ${c.number}` : ""}` : (r.custom_name ?? "Custom card"),
        quantity: r.quantity,
        unitPrice: String(r.purchase_price_per_unit),
        extraCosts: [String(r.grading_fees), String(r.acquisition_fees)],
        currency: r.currency,
        purchaseDate: r.purchase_date,
        marketPrice: price(c),
        manualUnitValue: manual(r.manual_unit_value, r.manual_value_as_of),
        isGraded: graded,
      };
      return {
        id: r.id,
        type: "card" as const,
        name: lot.itemName,
        detail: [
          c?.printing,
          graded ? `${r.grading_company} ${r.grade ?? ""}`.trim() : r.condition,
          r.language !== "English" ? r.language : null,
        ]
          .filter(Boolean)
          .join(" · "),
        setName: c ? setName(c.set_id) : r.custom_set_name,
        href: c ? `/cards/${c.id}` : null,
        imageUrl: c?.image_url ?? null,
        priceKind: r.manual_unit_value !== null ? ("manual" as const) : (c?.current_price_kind ?? null),
        createdAt: r.created_at,
        card: r,
        valuation: valueLot(lot, { now, staleAfterHours: stale }),
      };
    }),
  ];

  return { entries, totals: summarize(entries.map((e) => e.valuation)), currency: profile?.default_currency ?? "USD" };
}

export async function getLot(type: "sealed" | "card", id: string): Promise<SealedLotRow | CardLotRow | null> {
  await requireUser("/collection");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data } =
    type === "sealed"
      ? await supabase.from("collection_sealed_positions").select(SEALED_SELECT).eq("id", id).maybeSingle()
      : await supabase.from("collection_card_positions").select(CARD_SELECT).eq("id", id).maybeSingle();
  return data as SealedLotRow | CardLotRow | null;
}
