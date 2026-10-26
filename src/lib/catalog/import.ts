import type { SupabaseClient } from "@supabase/supabase-js";
import { TcgTrackingProvider } from "../pricing/providers/tcgtracking";
import { safeImageUrl } from "../pricing/types";
import { cardRowsFromGroup, matchGroup, matchSealedProduct } from "./match";

/*
 * Catalog import from TCGTracking: link our sets and sealed products to TCGplayer
 * ids by strict name matching, copy product images, and upsert every single
 * card (one row per printing) in linked sets. Ambiguous matches are reported,
 * never guessed. Takes a service-role client.
 */

export interface ImportReport {
  setsLinked: string[];
  productsLinked: string[];
  cardsUpserted: number;
  needsAttention: string[];
  errors: string[];
}

export async function runCatalogImport(
  db: SupabaseClient,
  opts: { provider?: TcgTrackingProvider; setIds?: string[] } = {},
): Promise<ImportReport> {
  const provider = opts.provider ?? new TcgTrackingProvider();
  const report: ImportReport = { setsLinked: [], productsLinked: [], cardsUpserted: 0, needsAttention: [], errors: [] };

  let q = db.from("sets").select("id, name, game_id, tcgplayer_group_id, games!inner(tcgplayer_category_id)");
  if (opts.setIds?.length) q = q.in("id", opts.setIds);
  const { data: sets, error } = await q;
  if (error) throw new Error(error.message);

  for (const set of sets ?? []) {
    const categoryId = (set.games as unknown as { tcgplayer_category_id: number | null }).tcgplayer_category_id;
    if (!categoryId) continue;
    try {
      let groupId = set.tcgplayer_group_id as number | null;
      if (!groupId) {
        const m = matchGroup(set.name, await provider.groups(categoryId));
        if (!m.match) {
          report.needsAttention.push(
            `Set "${set.name}": no unambiguous TCGplayer group. Candidates: ${m.candidates.map((c) => `${c.name} (#${c.groupId})`).join(", ") || "none"}`,
          );
          continue;
        }
        groupId = m.match.groupId;
        const { error: uErr } = await db.from("sets").update({ tcgplayer_group_id: groupId }).eq("id", set.id);
        if (uErr) throw new Error(uErr.message);
        report.setsLinked.push(`${set.name} → ${m.match.name} (#${groupId})`);
      }

      const [products, prices] = await Promise.all([
        provider.products(categoryId, groupId),
        provider.prices(categoryId, groupId),
      ]);

      // Sealed products
      const { data: ours } = await db
        .from("sealed_products")
        .select("id, name, tcgplayer_product_id, image_url")
        .eq("set_id", set.id);
      for (const p of ours ?? []) {
        if (p.tcgplayer_product_id) {
          if (!p.image_url) {
            const tp = products.find((x) => x.productId === p.tcgplayer_product_id);
            const img = safeImageUrl(tp?.imageUrl);
            if (img) await db.from("sealed_products").update({ image_url: img }).eq("id", p.id);
          }
          continue;
        }
        const m = matchSealedProduct(p.name, products);
        if (!m.match) {
          report.needsAttention.push(
            `Product "${p.name}": no exact TCGplayer match. Candidates: ${m.candidates.map((c) => `${c.name} (#${c.productId})`).join(", ") || "none"}`,
          );
          continue;
        }
        const { error: pErr } = await db
          .from("sealed_products")
          .update({ tcgplayer_product_id: m.match.productId, image_url: p.image_url ?? safeImageUrl(m.match.imageUrl) })
          .eq("id", p.id);
        if (pErr) report.errors.push(`Product "${p.name}": ${pErr.message}`);
        else report.productsLinked.push(`${p.name} → #${m.match.productId}`);
      }

      // Single cards
      const rows = cardRowsFromGroup(products, prices).map((r) => ({ ...r, game_id: set.game_id, set_id: set.id }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error: cErr } = await db
          .from("cards")
          .upsert(rows.slice(i, i + 500), { onConflict: "tcgplayer_product_id,printing" });
        if (cErr) throw new Error(`Saving cards: ${cErr.message}`);
      }
      report.cardsUpserted += rows.length;
    } catch (err) {
      report.errors.push(`${set.name}: ${(err as Error).message}`);
    }
  }
  return report;
}
