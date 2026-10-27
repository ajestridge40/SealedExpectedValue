import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, inBatches } from "../data/fetch-all";
import { finalizePrices, refreshSetPrices } from "../pricing/refresh";
import { TcgTrackingProvider, isCardProduct, type TcgGroup } from "../pricing/providers/tcgtracking";
import { safeImageUrl } from "../pricing/types";
import { runCatalogImport, type ImportReport } from "./import";
import { matchGroup } from "./match";
import { classifySealed, slugify } from "./product-type";

/*
 * Load sets of the selected games (or every game) from TCGTracking into the
 * catalog, one set at a time: the set with its logo and symbol, its sealed
 * products, every card printing with images, and its prices. Existing sets and
 * products are linked, never duplicated. Resumable: sets loaded in the last
 * 7 days are skipped unless forced, and each set is saved as soon as it is done.
 *
 * Discovered products have no pull-rate model, so they show market prices,
 * set stats and the top-5 value ratio, and “No pull-rate model” instead of EV
 * until one is added.
 */

/**
 * Newest sets first: by release date when known, otherwise by id (TCGplayer
 * set ids grow over time, so a higher id is a newer set).
 */
export function newestFirst(
  a: { publishedOn: string | null; groupId: number },
  b: { publishedOn: string | null; groupId: number },
) {
  const ta = a.publishedOn ? Date.parse(a.publishedOn) : NaN;
  const tb = b.publishedOn ? Date.parse(b.publishedOn) : NaN;
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta;
  if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1;
  return b.groupId - a.groupId;
}

export interface SyncReport {
  games: string[];
  setsCreated: string[];
  setsLinked: string[];
  /** Sets whose catalog was (re)loaded this run. */
  setsProcessed: number;
  /** Sets skipped because they were synced recently (use force to redo). */
  setsSkipped: number;
  /** Booster-boxes-only runs: sets without a booster box, not added. */
  setsWithoutBoxes: number;
  /** Sets not reached before the time budget ran out (run again to continue). */
  setsRemaining: number;
  productsCreated: number;
  pricesWritten: number;
  evResultsStored: number;
  import: ImportReport;
  errors: string[];
}

export interface SyncOptions {
  /** Game slugs, or "all" for every game TCGTracking covers. */
  games: string[] | "all";
  /** Newest N sets per game; 0 = every set. */
  maxSetsPerGame: number;
  provider?: TcgTrackingProvider;
  now?: Date;
  /** Reload sets even if they were synced in the last 7 days. */
  force?: boolean;
  /** Also store each set's prices while syncing (default true). */
  withPrices?: boolean;
  /**
   * Only add booster boxes: skip other sealed products and single cards, and
   * don't add sets that have no booster box. Much faster than a full load.
   */
  boosterBoxesOnly?: boolean;
  /** Stop starting new sets after this long; run again to continue. */
  timeBudgetMs?: number;
  log?: (message: string) => void;
}

const RESYNC_AFTER_MS = 7 * 86_400_000;

/** Make sure every TCGTracking game exists in the games table; returns the selected ones. */
async function resolveGames(db: SupabaseClient, provider: TcgTrackingProvider, games: SyncOptions["games"]) {
  if (games === "all") {
    const categories = await provider.categories();
    if (categories) {
      const { data: existing } = await db.from("games").select("slug, tcgplayer_category_id");
      const known = new Set((existing ?? []).map((g) => g.tcgplayer_category_id));
      const slugs = new Set((existing ?? []).map((g) => g.slug));
      const rows = categories
        .filter((c) => !known.has(c.categoryId))
        .map((c) => {
          let slug = slugify(c.name).slice(0, 40) || `game-${c.categoryId}`;
          if (slug.length < 2 || slugs.has(slug)) slug = `${slug.slice(0, 30)}-${c.categoryId}`;
          slugs.add(slug);
          return { slug, name: c.name, tcgplayer_category_id: c.categoryId };
        });
      if (rows.length) {
        const { error } = await db
          .from("games")
          .upsert(rows, { onConflict: "tcgplayer_category_id", ignoreDuplicates: true });
        if (error) throw new Error(`Adding games: ${error.message}`);
      }
    }
  }
  let q = db
    .from("games")
    .select("id, slug, name, tcgplayer_category_id")
    .not("tcgplayer_category_id", "is", null)
    .order("display_order")
    .order("name");
  if (games !== "all") q = q.in("slug", games);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

const emptyImport = (): ImportReport => ({
  setsLinked: [],
  productsLinked: [],
  cardsUpserted: 0,
  needsAttention: [],
  errors: [],
});

export async function runSetSync(db: SupabaseClient, opts: SyncOptions): Promise<SyncReport> {
  const provider = opts.provider ?? new TcgTrackingProvider();
  const max = opts.maxSetsPerGame > 0 ? opts.maxSetsPerGame : Infinity;
  const now = opts.now ?? new Date();
  const clockStart = Date.now();
  const withPrices = opts.withPrices ?? true;
  const report: SyncReport = {
    games: [],
    setsCreated: [],
    setsLinked: [],
    setsProcessed: 0,
    setsSkipped: 0,
    setsWithoutBoxes: 0,
    setsRemaining: 0,
    productsCreated: 0,
    pricesWritten: 0,
    evResultsStored: 0,
    import: emptyImport(),
    errors: [],
  };

  let sourceId: string | undefined;
  if (withPrices) {
    const { data: src } = await db.from("data_sources").select("id").eq("slug", "tcgtracking").maybeSingle();
    sourceId = src?.id as string | undefined;
    if (!sourceId)
      report.errors.push("The 'tcgtracking' data source is missing; prices were not stored. Run `npm run db:setup`.");
  }

  const games = await resolveGames(db, provider, opts.games);
  let outOfTime = false;

  for (const game of games) {
    if (outOfTime) break;
    const categoryId = game.tcgplayer_category_id as number;
    report.games.push(game.name);
    let groups: TcgGroup[];
    try {
      // Newest first; skip sets announced for the future (presales have no market yet).
      groups = (await provider.groups(categoryId))
        .filter((g) => !g.publishedOn || Date.parse(g.publishedOn) <= now.getTime() + 7 * 86_400_000)
        .sort(newestFirst)
        .slice(0, max);
    } catch (err) {
      report.errors.push(`${game.name}: ${(err as Error).message}`);
      continue;
    }

    const sets = await fetchAll<{
      id: string;
      name: string;
      tcgplayer_group_id: number | null;
      catalog_synced_at: string | null;
    }>((f, t) =>
      db
        .from("sets")
        .select("id, name, tcgplayer_group_id, catalog_synced_at")
        .eq("game_id", game.id)
        .order("id")
        .range(f, t),
    );

    for (const [i, g] of groups.entries()) {
      if (opts.timeBudgetMs && Date.now() - clockStart > opts.timeBudgetMs) {
        report.setsRemaining += groups.length - i;
        outOfTime = true;
        break;
      }
      try {
        // 1. The set itself: link or create, and keep its images current.
        let set = sets.find((s) => s.tcgplayer_group_id === g.groupId);
        if (
          set?.catalog_synced_at &&
          now.getTime() - Date.parse(set.catalog_synced_at) < RESYNC_AFTER_MS &&
          !opts.force
        ) {
          report.setsSkipped++;
          continue;
        }
        const products = (await provider.products(categoryId, g.groupId)).filter((p) => !isCardProduct(p));
        const wanted = (p: { name: string }) => {
          const kind = classifySealed(p.name);
          return kind && (!opts.boosterBoxesOnly || kind.type === "booster_box") ? kind : null;
        };
        if (!set && opts.boosterBoxesOnly && !products.some(wanted)) {
          report.setsWithoutBoxes++;
          provider.forgetSet(categoryId, g.groupId);
          continue;
        }
        if (!set) {
          const unlinked = sets.filter((s) => !s.tcgplayer_group_id);
          const m = matchGroup(
            g.name,
            unlinked.map((s) => ({ groupId: 0, name: s.name, abbreviation: null, publishedOn: null, categoryId: 0 })),
          );
          const target = m.match ? unlinked.find((s) => s.name === m.match!.name) : undefined;
          if (target) {
            await db.from("sets").update({ tcgplayer_group_id: g.groupId }).eq("id", target.id);
            target.tcgplayer_group_id = g.groupId;
            set = target;
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
              .select("id, name, tcgplayer_group_id, catalog_synced_at")
              .single();
            if (insErr) {
              report.errors.push(`${g.name}: ${insErr.message}`);
              continue;
            }
            set = created as (typeof sets)[number];
            sets.push(set);
            report.setsCreated.push(`${game.name}: ${g.name}`);
          }
        }
        const images = { image_url: safeImageUrl(g.imageUrl), symbol_url: safeImageUrl(g.symbolUrl) };
        if (images.image_url || images.symbol_url) {
          await db
            .from("sets")
            .update(Object.fromEntries(Object.entries(images).filter(([, v]) => v)))
            .eq("id", set.id);
        }

        // 2. Sealed products not yet in the catalog (and images for those that are).
        const known = await inBatches(
          products.map((p) => p.productId),
          (batch) =>
            db.from("sealed_products").select("id, tcgplayer_product_id, image_url").in("tcgplayer_product_id", batch),
        );
        const knownById = new Map(known.map((k) => [k.tcgplayer_product_id as number, k]));
        for (const p of products) {
          const k = knownById.get(p.productId);
          const img = safeImageUrl(p.imageUrl);
          if (k && !k.image_url && img) await db.from("sealed_products").update({ image_url: img }).eq("id", k.id);
        }
        const rows = products.flatMap((p) => {
          if (knownById.has(p.productId)) return [];
          const kind = wanted(p);
          if (!kind) return [];
          return [
            {
              game_id: game.id,
              set_id: set!.id,
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

        // 3. Every card (one row per printing) with images (skipped for booster boxes only).
        const imp = opts.boosterBoxesOnly ? emptyImport() : await runCatalogImport(db, { provider, setIds: [set.id] });
        report.import.cardsUpserted += imp.cardsUpserted;
        report.import.productsLinked.push(...imp.productsLinked);
        report.import.needsAttention.push(...imp.needsAttention);
        report.import.errors.push(...imp.errors);

        // 4. Prices (reuses the responses fetched above).
        if (withPrices && sourceId) {
          const r = await refreshSetPrices(
            db,
            provider,
            { id: set.id, name: g.name, tcgplayer_group_id: g.groupId, categoryId },
            sourceId,
            now,
          );
          report.pricesWritten += r.snapshots;
        } else {
          provider.forgetSet(categoryId, g.groupId);
        }

        await db.from("sets").update({ catalog_synced_at: now.toISOString() }).eq("id", set.id);
        set.catalog_synced_at = now.toISOString();
        report.setsProcessed++;
        opts.log?.(
          `${game.name} [${i + 1}/${groups.length}] ${g.name}: ` +
            (opts.boosterBoxesOnly ? `${rows.length} new booster box(es)` : `${imp.cardsUpserted} card printings`),
        );
      } catch (err) {
        report.errors.push(`${g.name}: ${(err as Error).message}`);
        provider.forgetSet(categoryId, g.groupId);
      }
    }
  }

  if (withPrices && report.setsProcessed > 0) {
    opts.log?.("Updating price changes, set stats and EV results…");
    const fin = await finalizePrices(db, now);
    report.evResultsStored = fin.evResults;
    report.errors.push(...fin.errors);
  }
  return report;
}
