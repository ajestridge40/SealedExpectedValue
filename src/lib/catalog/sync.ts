import type { SupabaseClient } from "@supabase/supabase-js";
import { TcgTrackingProvider, isCardProduct } from "../pricing/providers/tcgtracking";
import { safeImageUrl } from "../pricing/types";
import { runCatalogImport, type ImportReport } from "./import";
import { matchGroup } from "./match";
import { classifySealed, slugify } from "./product-type";

/*
 * Discover the most recent sets of each selected game on TCGTracking and add
 * them (and their sealed products) to the catalog, then import their cards.
 * Existing sets and products are linked, never duplicated. Prices come from
 * the price refresh, which the caller runs afterwards.
 *
 * Discovered products have no pull-rate model, so they show market prices,
 * set stats and the top-5 value ratio, and “No pull-rate model” instead of EV
 * until one is added.
 */

export interface SyncReport {
  games: string[];
  setsCreated: string[];
  setsLinked: string[];
  productsCreated: number;
  import: ImportReport | null;
  errors: string[];
}

export async function runSetSync(
  db: SupabaseClient,
  opts: { games: string[]; maxSetsPerGame: number; provider?: TcgTrackingProvider; now?: Date },
): Promise<SyncReport> {
  const provider = opts.provider ?? new TcgTrackingProvider();
  const max = Math.max(1, Math.min(opts.maxSetsPerGame, 200));
  const now = opts.now ?? new Date();
  const report: SyncReport = {
    games: [],
    setsCreated: [],
    setsLinked: [],
    productsCreated: 0,
    import: null,
    errors: [],
  };
  const touchedSetIds: string[] = [];

  const { data: games, error } = await db
    .from("games")
    .select("id, slug, name, tcgplayer_category_id")
    .in("slug", opts.games);
  if (error) throw new Error(error.message);

  for (const game of games ?? []) {
    if (!game.tcgplayer_category_id) continue;
    report.games.push(game.name);
    try {
      // Newest first; skip sets announced for the future (presales have no market yet).
      const groups = (await provider.groups(game.tcgplayer_category_id))
        .filter((g) => !g.publishedOn || Date.parse(g.publishedOn) <= now.getTime() + 7 * 86_400_000)
        .sort((a, b) => (b.publishedOn ?? "").localeCompare(a.publishedOn ?? ""))
        .slice(0, max);

      const { data: existing } = await db.from("sets").select("id, name, tcgplayer_group_id").eq("game_id", game.id);
      const sets = existing ?? [];

      for (const g of groups) {
        let setId = sets.find((s) => s.tcgplayer_group_id === g.groupId)?.id as string | undefined;
        if (!setId) {
          // An unlinked set of ours with the same name (e.g. from the seed): link it.
          const unlinked = sets.filter((s) => !s.tcgplayer_group_id);
          const m = matchGroup(
            g.name,
            unlinked.map((s) => ({ groupId: 0, name: s.name, abbreviation: null, publishedOn: null, categoryId: 0 })),
          );
          const target = m.match ? unlinked.find((s) => s.name === m.match!.name) : undefined;
          if (target) {
            await db.from("sets").update({ tcgplayer_group_id: g.groupId }).eq("id", target.id);
            target.tcgplayer_group_id = g.groupId;
            setId = target.id;
            report.setsLinked.push(`${target.name} → ${g.name}`);
          } else {
            const { data: created, error: insErr } = await db
              .from("sets")
              .insert({
                game_id: game.id,
                name: g.name,
                code: g.abbreviation,
                release_date: g.publishedOn ? g.publishedOn.slice(0, 10) : null,
                tcgplayer_group_id: g.groupId,
              })
              .select("id")
              .single();
            if (insErr) {
              report.errors.push(`${g.name}: ${insErr.message}`);
              continue;
            }
            setId = created.id as string;
            sets.push({ id: setId, name: g.name, tcgplayer_group_id: g.groupId });
            report.setsCreated.push(`${game.name}: ${g.name}`);
          }
        }
        if (!setId) continue;
        touchedSetIds.push(setId);

        // Sealed products not yet in the catalog.
        const products = (await provider.products(game.tcgplayer_category_id, g.groupId)).filter(
          (p) => !isCardProduct(p),
        );
        const { data: known } = await db
          .from("sealed_products")
          .select("tcgplayer_product_id")
          .in(
            "tcgplayer_product_id",
            products.map((p) => p.productId),
          );
        const knownIds = new Set((known ?? []).map((k) => k.tcgplayer_product_id));
        const rows = products.flatMap((p) => {
          if (knownIds.has(p.productId)) return [];
          const kind = classifySealed(p.name);
          if (!kind) return [];
          return [
            {
              game_id: game.id,
              set_id: setId,
              name: p.name,
              slug: `${slugify(`${game.slug}-${p.name}`)}-${p.productId}`,
              product_type: kind.type,
              release_date: g.publishedOn ? g.publishedOn.slice(0, 10) : null,
              image_url: safeImageUrl(p.imageUrl),
              pack_count: kind.packs,
              tcgplayer_product_id: p.productId,
            },
          ];
        });
        if (rows.length) {
          const { error: pErr } = await db
            .from("sealed_products")
            .upsert(rows, { onConflict: "tcgplayer_product_id", ignoreDuplicates: true });
          if (pErr) report.errors.push(`${g.name} products: ${pErr.message}`);
          else report.productsCreated += rows.length;
        }
      }
    } catch (err) {
      report.errors.push(`${game.name}: ${(err as Error).message}`);
    }
  }

  // Cards (one row per printing) and images for every touched set; reuses cached responses.
  if (touchedSetIds.length) report.import = await runCatalogImport(db, { provider, setIds: touchedSetIds });
  return report;
}
