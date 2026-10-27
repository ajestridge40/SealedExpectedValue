import "server-only";
import { cache } from "react";
import { staleAfterHours } from "../auth";
import { calculateReturns, type EvResult, type ReturnsResult } from "../ev";
import { computeProductEvs, loadProducts, type PullModelMeta } from "../ev/compute";
import { createClient } from "../supabase/server";
import type { ProductRow } from "./types";

export type { PullModelMeta } from "../ev/compute";

export interface ProductEv {
  product: ProductRow;
  model: PullModelMeta | null;
  /** Null when the product has no pull model at all. */
  ev: EvResult | null;
  returns: ReturnsResult;
}

/**
 * Live EV for specific products (product page, compare). Prices come from the
 * stored snapshots, never from a provider call. List pages read the stored
 * results in product_ev instead.
 */
export const getProductEvs = cache(async (productIds: string[]): Promise<Map<string, ProductEv>> => {
  const supabase = await createClient();
  const products = await loadProducts(supabase, productIds);
  const computed = await computeProductEvs(supabase, products, { staleAfterHours: await staleAfterHours() });
  const result = new Map<string, ProductEv>();
  for (const { product, model, ev } of computed.values()) {
    result.set(product.id, {
      product,
      model,
      ev,
      returns: calculateReturns({ grossEv: ev?.grossEv ?? null, purchasePrice: product.current_price }),
    });
  }
  return result;
});
