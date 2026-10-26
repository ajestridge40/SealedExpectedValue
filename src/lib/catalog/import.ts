import type { SupabaseClient } from "@supabase/supabase-js";
import { TcgApiProvider } from "../pricing/providers/tcgapi";
import { safeImageUrl } from "../pricing/types";
import { cardRowsFromSet, matchSealedProduct, matchSet } from "./match";

/*
 * Catalog import from TCG API: link our sets and sealed products to TCG API /
 * TCGplayer ids (strict matching), copy product images, and upsert every
 * single card (one row per printing) in linked sets. Ambiguous matches are
 * reported, never guessed. Takes a service-role client.
 *
 * Request cost per run: the game's set list (1–2 requests per game), then per
 * set 2–3 requests (cards, sealed products, and all-printing prices on plans
 * that include them). Responses are cached per provider instance, so a price
 * refresh run with the same instance right afterwards costs nothing extra.
 */

export interface ImportReport {
  setsLinked: string[];
  productsLinked: string[];
  cardsUpserted: number;
  allPrintings: boolean;
  needsAttention: string[];
  errors: string[];
}

export async function runCatalogImport(
  db: SupabaseClient,
  opts: { provider?: TcgApiProvider; setIds?: string[] } = {},
): Promise<ImportReport> {
  const provider = opts.provider ?? new TcgApiProvider();
  const report: ImportReport = {
    setsLinked: [],
    productsLinked: [],
    cardsUpserted: 0,
    allPrintings: true,
    needsAttention: [],
    errors: [],
  };
  if (!provider.configured) {
    report.errors.push(
      "TCGAPI_KEY is not set. Get a free key at https://tcgapi.dev/dashboard and add it to .env.local.",
    );
    return report;
  }

  let q = db
    .from("sets")
    .select("id, name, game_id, tcgplayer_group_id, tcgapi_set_id, games!inner(tcgplayer_category_id)");
  if (opts.setIds?.length) q = q.in("id", opts.setIds);
  const { data: sets, error } = await q;
  if (error) throw new Error(error.message);

  for (const set of sets ?? []) {
    const categoryId = (set.games as unknown as { tcgplayer_category_id: number | null }).tcgplayer_category_id;
    if (!categoryId) continue;
    try {
      let apiSetId = set.tcgapi_set_id as number | null;
      if (!apiSetId) {
        const m = matchSet(
          { name: set.name, tcgplayerGroupId: set.tcgplayer_group_id },
          await provider.gameSets(categoryId),
        );
        if (!m.match) {
          report.needsAttention.push(
            `Set "${set.name}": no unambiguous TCG API set. Candidates: ${m.candidates.map((c) => `${c.name} (id ${c.id})`).join(", ") || "none"}. Set sets.tcgapi_set_id by hand.`,
          );
          continue;
        }
        apiSetId = m.match.id;
        const { error: uErr } = await db
          .from("sets")
          .update({
            tcgapi_set_id: apiSetId,
            tcgplayer_group_id: set.tcgplayer_group_id ?? m.match.tcgplayer_id ?? null,
          })
          .eq("id", set.id);
        if (uErr) throw new Error(uErr.message);
        report.setsLinked.push(`${set.name} → ${m.match.name} (TCG API set ${apiSetId})`);
      }

      const [cards, sealed, priceRows] = await Promise.all([
        provider.setCards(apiSetId, "Cards"),
        provider.setCards(apiSetId, "Sealed Products"),
        provider.setPriceRows(apiSetId),
      ]);
      if (!priceRows) report.allPrintings = false;

      // Sealed products
      const { data: ours } = await db
        .from("sealed_products")
        .select("id, name, tcgplayer_product_id, tcgapi_id, image_url")
        .eq("set_id", set.id);
      for (const p of ours ?? []) {
        const linked = p.tcgplayer_product_id
          ? sealed.find((x) => x.tcgplayer_id === p.tcgplayer_product_id)
          : p.tcgapi_id
            ? sealed.find((x) => x.id === p.tcgapi_id)
            : undefined;
        if (linked) {
          await db
            .from("sealed_products")
            .update({
              tcgapi_id: linked.id,
              tcgplayer_product_id: linked.tcgplayer_id ?? p.tcgplayer_product_id,
              image_url: p.image_url ?? safeImageUrl(linked.image_url),
            })
            .eq("id", p.id);
          continue;
        }
        if (p.tcgplayer_product_id) continue; // linked by hand to something not in this set's list
        const m = matchSealedProduct(p.name, sealed);
        if (!m.match) {
          report.needsAttention.push(
            `Product "${p.name}": no exact match. Candidates: ${m.candidates.map((c) => `${c.name} (TCGplayer #${c.tcgplayer_id})`).join(", ") || "none"}. Set sealed_products.tcgplayer_product_id by hand.`,
          );
          continue;
        }
        const { error: pErr } = await db
          .from("sealed_products")
          .update({
            tcgapi_id: m.match.id,
            tcgplayer_product_id: m.match.tcgplayer_id,
            image_url: p.image_url ?? safeImageUrl(m.match.image_url),
          })
          .eq("id", p.id);
        if (pErr) report.errors.push(`Product "${p.name}": ${pErr.message}`);
        else report.productsLinked.push(`${p.name} → TCGplayer #${m.match.tcgplayer_id}`);
      }

      // Single cards
      const rows = cardRowsFromSet(cards, priceRows).map((r) => ({ ...r, game_id: set.game_id, set_id: set.id }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error: cErr } = await db
          .from("cards")
          .upsert(rows.slice(i, i + 500), { onConflict: "tcgplayer_product_id,printing" });
        if (cErr) throw new Error(`Saving cards: ${cErr.message}`);
      }
      report.cardsUpserted += rows.length;
    } catch (err) {
      report.errors.push(`${set.name}: ${(err as Error).message}`);
      if (/429|daily request limit/.test((err as Error).message)) break;
    }
  }
  return report;
}
