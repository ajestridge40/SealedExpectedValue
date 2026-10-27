import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, inBatches } from "../data/fetch-all";
import { CARD_COLUMNS, PRODUCT_COLUMNS, type CardCatalogRow, type ProductRow } from "../data/types";
import { calculateEv } from "./engine";
import { buildModelInput, type CardRow, type EstimateRow, type SlotRow } from "./model";
import type { EvResult } from "./types";

/*
 * Load pull models + card prices from the database and run the EV engine.
 * Shared by the product page (live, per request) and the refresh job (which
 * stores results in product_ev for list pages). No "server-only" import so
 * CLI scripts can use it.
 */

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

export interface ComputedEv {
  product: ProductRow;
  model: PullModelMeta | null;
  ev: EvResult | null;
}

export async function loadProducts(db: SupabaseClient, ids: string[]): Promise<ProductRow[]> {
  return inBatches<ProductRow, string>(ids, (batch) =>
    db.from("sealed_products").select(PRODUCT_COLUMNS).in("id", batch),
  );
}

export async function computeProductEvs(
  db: SupabaseClient,
  products: ProductRow[],
  opts: { staleAfterHours?: number; now?: Date } = {},
): Promise<Map<string, ComputedEv>> {
  const result = new Map<string, ComputedEv>();
  if (products.length === 0) return result;

  // Few products have models: load all active ones rather than filtering by a long id list.
  const wanted = new Set(products.map((p) => p.id));
  const { data: allModels, error } = await db
    .from("product_pull_models")
    .select("id, sealed_product_id, name, version, packs_per_product, description, assumptions, updated_at")
    .eq("is_active", true)
    .limit(10000);
  if (error) throw new Error(error.message);
  const models = ((allModels ?? []) as PullModelMeta[]).filter((m) => wanted.has(m.sealed_product_id));

  const slots = await inBatches<SlotRow, string>(
    models.map((m) => m.id),
    (batch) => db.from("pull_model_slots").select("*").in("model_id", batch),
  );
  const estimates = await inBatches<EstimateRow, string>(
    slots.map((s) => s.id),
    (batch) => db.from("pull_rate_estimates").select("*").in("slot_id", batch),
  );

  const setIds = new Set<string>();
  const modelled = new Set(models.map((m) => m.sealed_product_id));
  for (const p of products) if (p.set_id && modelled.has(p.id)) setIds.add(p.set_id);
  for (const e of estimates) if (e.set_id) setIds.add(e.set_id);
  const cards = await inBatches<CardCatalogRow, string>(
    [...setIds],
    async (batch) => ({
      data: await fetchAll<CardCatalogRow>((from, to) =>
        db.from("cards").select(CARD_COLUMNS).in("set_id", batch).order("id").range(from, to),
      ),
      error: null,
    }),
    20,
  );
  const cardsBySet = new Map<string, CardRow[]>();
  for (const c of cards) {
    if (!c.set_id) continue;
    const list = cardsBySet.get(c.set_id) ?? [];
    list.push(c);
    cardsBySet.set(c.set_id, list);
  }
  const cardsById = new Map<string, CardRow>(cards.map((c) => [c.id, c]));

  const now = opts.now ?? new Date();
  for (const product of products) {
    const model = models.find((m) => m.sealed_product_id === product.id) ?? null;
    let ev: EvResult | null = null;
    if (model) {
      const modelSlots = slots.filter((s) => s.model_id === model.id);
      const ids = new Set(modelSlots.map((s) => s.id));
      ev = calculateEv(
        buildModelInput({
          model,
          slots: modelSlots,
          estimates: estimates.filter((e) => ids.has(e.slot_id)),
          cardsBySet,
          cardsById,
          productSetId: product.set_id,
          currency: product.current_price_currency ?? "USD",
        }),
        { now, staleAfterHours: opts.staleAfterHours ?? 72 },
      );
    }
    result.set(product.id, { product, model, ev });
  }
  return result;
}

/**
 * Recompute EV for every product with an active pull model and store the
 * results in product_ev (service-role client). Removes stored results for
 * products that no longer have a model. Returns the number stored.
 */
export async function computeAndStoreEvs(db: SupabaseClient, now = new Date()): Promise<number> {
  const { data: models, error } = await db
    .from("product_pull_models")
    .select("sealed_product_id")
    .eq("is_active", true)
    .limit(10000);
  if (error) throw new Error(error.message);
  const ids = [...new Set((models ?? []).map((m) => m.sealed_product_id as string))];
  const evs = await computeProductEvs(db, await loadProducts(db, ids), { now });
  const rows = [...evs.values()]
    .filter((x) => x.ev)
    .map(({ product, ev }) => ({
      sealed_product_id: product.id,
      status: ev!.status,
      gross_ev: ev!.grossEv ? ev!.grossEv.toFixed(2) : null,
      currency: ev!.currency,
      confidence: ev!.confidence,
      pull_rate_confidence: ev!.pullRateConfidence,
      freshness: ev!.freshness.label,
      probability_coverage: ev!.probabilityCoverage,
      price_coverage: ev!.priceCoverage,
      computed_at: now.toISOString(),
    }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: upErr } = await db
      .from("product_ev")
      .upsert(rows.slice(i, i + 500), { onConflict: "sealed_product_id" });
    if (upErr) throw new Error(`Saving EV results: ${upErr.message}`);
  }
  // Drop results for products whose model was removed.
  const { data: stored } = await db.from("product_ev").select("sealed_product_id").limit(10000);
  const keep = new Set(rows.map((r) => r.sealed_product_id));
  const stale = (stored ?? []).map((r) => r.sealed_product_id as string).filter((id) => !keep.has(id));
  await inBatches(stale, async (batch) => {
    const { error: delErr } = await db.from("product_ev").delete().in("sealed_product_id", batch);
    return { data: [], error: delErr };
  });
  return rows.length;
}
