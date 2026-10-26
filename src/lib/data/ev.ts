import "server-only";
import { cache } from "react";
import { staleAfterHours } from "../auth";
import { calculateEv, calculateReturns, type EvResult, type ReturnsResult } from "../ev";
import { buildModelInput, type CardRow, type EstimateRow, type SlotRow } from "../ev/model";
import { createClient } from "../supabase/server";
import { getAllProducts, getCardsForSets } from "./catalog";
import { inBatches } from "./fetch-all";
import type { ProductRow } from "./types";

export interface PullModelMeta {
  id: string;
  sealed_product_id: string;
  name: string;
  version: number;
  packs_per_product: number;
  description: string | null;
  assumptions: string | null;
  updated_at: string;
}

export interface ProductEv {
  product: ProductRow;
  model: PullModelMeta | null;
  /** Null when the product has no pull model at all. */
  ev: EvResult | null;
  returns: ReturnsResult;
}

/**
 * Compute EV for every product (or a subset) from the database. Runs on the
 * server per request; prices come from the stored snapshots, never from a
 * provider call.
 */
export const getProductEvs = cache(async (productIds?: string[]): Promise<Map<string, ProductEv>> => {
  const supabase = await createClient();
  const all = await getAllProducts();
  const products = productIds ? all.filter((p) => productIds.includes(p.id)) : all;
  if (products.length === 0) return new Map();

  // Only a few products have pull models, so load all active models and keep
  // the ones needed, instead of sending every product id in the request URL.
  const wanted = new Set(products.map((p) => p.id));
  const { data: allModels, error: mErr } = await supabase
    .from("product_pull_models")
    .select("id, sealed_product_id, name, version, packs_per_product, description, assumptions, updated_at")
    .eq("is_active", true)
    .limit(5000);
  if (mErr) throw new Error(mErr.message);
  const models = (allModels ?? []).filter((m) => wanted.has(m.sealed_product_id));
  const modelIds = models.map((m) => m.id);

  const slots = await inBatches<SlotRow, string>(modelIds, (batch) =>
    supabase.from("pull_model_slots").select("*").in("model_id", batch),
  );
  const slotIds = slots.map((s) => s.id);

  const estimates = await inBatches<EstimateRow, string>(slotIds, (batch) =>
    supabase.from("pull_rate_estimates").select("*").in("slot_id", batch),
  );

  const setIds = new Set<string>();
  for (const p of products) if (p.set_id && models.some((m) => m.sealed_product_id === p.id)) setIds.add(p.set_id);
  for (const e of estimates ?? []) if (e.set_id) setIds.add(e.set_id);
  const cards = await getCardsForSets([...setIds]);
  const cardsBySet = new Map<string, CardRow[]>();
  for (const c of cards) {
    if (!c.set_id) continue;
    cardsBySet.set(c.set_id, [...(cardsBySet.get(c.set_id) ?? []), c]);
  }
  const cardsById = new Map<string, CardRow>(cards.map((c) => [c.id, c]));

  const stale = await staleAfterHours();
  const now = new Date();
  const result = new Map<string, ProductEv>();
  for (const product of products) {
    const model = models.find((m) => m.sealed_product_id === product.id) as PullModelMeta | undefined;
    let ev: EvResult | null = null;
    if (model) {
      const modelSlots = slots.filter((s) => s.model_id === model.id) as SlotRow[];
      const ids = new Set(modelSlots.map((s) => s.id));
      ev = calculateEv(
        buildModelInput({
          model,
          slots: modelSlots,
          estimates: estimates.filter((e) => ids.has(e.slot_id)) as EstimateRow[],
          cardsBySet,
          cardsById,
          productSetId: product.set_id,
          currency: product.current_price_currency ?? "USD",
        }),
        { now, staleAfterHours: stale },
      );
    }
    result.set(product.id, {
      product,
      model: model ?? null,
      ev,
      returns: calculateReturns({ grossEv: ev?.grossEv ?? null, purchasePrice: product.current_price }),
    });
  }
  return result;
});
