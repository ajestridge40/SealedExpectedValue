import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, inBatches } from "../data/fetch-all";
import { computeAndStoreEvs } from "../ev/compute";
import { planSnapshots, type SnapshotRow, type TrackedCard, type TrackedProduct } from "./plan";
import { PokemonTcgProvider } from "./providers/pokemontcg";
import { TcgTrackingProvider } from "./providers/tcgtracking";

/*
 * Price refresh: one shared copy of every price in the database, read by all
 * users, so pages never call the provider. Takes a service-role client (no
 * "server-only" import, so CLI scripts and GitHub Actions can use it too).
 *
 * - Holds a job lock (job_runs) so overlapping runs do not race.
 * - Resumable: refreshes sets whose prices are older than minIntervalHours,
 *   oldest first, until the time budget runs out; the next run continues.
 * - Two requests per set (products + pricing). Sealed products get a daily
 *   history row; cards only when their price changes.
 * - Afterwards: 7/30-day price changes, set stats and stored EV results are
 *   recomputed in the database.
 * - Provider failures are recorded and the last known prices are kept.
 */

export interface RefreshReport {
  status: "succeeded" | "failed" | "skipped";
  reason?: string;
  setsProcessed: number;
  /** Sets still due when the time budget ran out (the next run continues). */
  setsRemaining: number;
  snapshotsWritten: number;
  cardsUnchanged: number;
  unpricedProducts: number;
  unpricedCards: number;
  evResultsStored: number;
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

export interface DueSet {
  id: string;
  name: string;
  tcgplayer_group_id: number;
  categoryId: number;
}

const JOB = "refresh-prices";

/** Fetch and store the prices of one set. */
export async function refreshSetPrices(
  db: SupabaseClient,
  provider: TcgTrackingProvider,
  set: DueSet,
  sourceId: string,
  capturedAt: Date,
): Promise<{ snapshots: number; unchanged: number; unpricedProducts: number; unpricedCards: number }> {
  const prices = await provider.setPrices(set.categoryId, set.tcgplayer_group_id);
  const products = await fetchAll<TrackedProduct>((f, t) =>
    db
      .from("sealed_products")
      .select("id, tcgplayer_product_id")
      .eq("set_id", set.id)
      .not("tcgplayer_product_id", "is", null)
      .order("id")
      .range(f, t),
  );
  const cards = await fetchAll<TrackedCard>((f, t) =>
    db
      .from("cards")
      .select("id, tcgplayer_product_id, printing, current_price, current_price_currency, current_price_kind")
      .eq("set_id", set.id)
      .not("tcgplayer_product_id", "is", null)
      .order("id")
      .range(f, t),
  );
  const plan = planSnapshots({ products, cards, prices, sourceId, capturedAt });
  const snapshots = await writeSnapshots(db, plan.rows);
  await inBatches(
    plan.unchangedCards,
    async (batch) => {
      const { error } = await db.rpc("touch_card_prices", { card_ids: batch, as_of: capturedAt.toISOString() });
      return { data: [], error };
    },
    500,
  );
  await db.from("sets").update({ prices_synced_at: capturedAt.toISOString() }).eq("id", set.id);
  provider.forgetSet(set.categoryId, set.tcgplayer_group_id);
  return {
    snapshots,
    unchanged: plan.unchangedCards.length,
    unpricedProducts: plan.unpricedProducts.length,
    unpricedCards: plan.unpricedCards.length,
  };
}

/** Recompute derived data after prices changed: price changes, set stats, stored EVs. */
export async function finalizePrices(
  db: SupabaseClient,
  now = new Date(),
): Promise<{ evResults: number; errors: string[] }> {
  const errors: string[] = [];
  for (const fn of ["update_price_changes", "refresh_set_stats"]) {
    const { error } = await db.rpc(fn);
    if (error) errors.push(`${fn}: ${error.message}`);
  }
  let evResults = 0;
  try {
    evResults = await computeAndStoreEvs(db, now);
  } catch (err) {
    errors.push(`EV results: ${(err as Error).message}`);
  }
  return { evResults, errors };
}

/** Sets with a TCGplayer group id whose prices are due, oldest first. */
export async function dueSets(db: SupabaseClient, olderThan: Date | null): Promise<DueSet[]> {
  const rows = await fetchAll<{
    id: string;
    name: string;
    tcgplayer_group_id: number;
    prices_synced_at: string | null;
    games: unknown;
  }>((f, t) => {
    let q = db
      .from("sets")
      .select("id, name, tcgplayer_group_id, prices_synced_at, games!inner(tcgplayer_category_id)")
      .not("tcgplayer_group_id", "is", null);
    if (olderThan) q = q.or(`prices_synced_at.is.null,prices_synced_at.lt.${olderThan.toISOString()}`);
    return q.order("prices_synced_at", { ascending: true, nullsFirst: true }).order("id").range(f, t);
  });
  // The embedded game comes back as an object (or a one-element array, depending on the client version).
  const category = (g: unknown) =>
    ((Array.isArray(g) ? g[0] : g) as { tcgplayer_category_id: number | null } | undefined)?.tcgplayer_category_id ??
    null;
  return rows
    .filter((r) => category(r.games))
    .map((r) => ({ id: r.id, name: r.name, tcgplayer_group_id: r.tcgplayer_group_id, categoryId: category(r.games)! }));
}

export async function runPriceRefresh(
  db: SupabaseClient,
  opts: {
    /** Refresh every set, however recently it was refreshed. */
    force?: boolean;
    minIntervalHours?: number;
    /** Stop starting new sets after this long (the next run continues). Default: no limit. */
    timeBudgetMs?: number;
    tcgtracking?: TcgTrackingProvider | null;
    pokemontcg?: PokemonTcgProvider | null;
    now?: () => Date;
    log?: (message: string) => void;
  } = {},
): Promise<RefreshReport> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now();
  const clockStart = Date.now();
  const report: RefreshReport = {
    status: "succeeded",
    setsProcessed: 0,
    setsRemaining: 0,
    snapshotsWritten: 0,
    cardsUnchanged: 0,
    unpricedProducts: 0,
    unpricedCards: 0,
    evResultsStored: 0,
    errors: [],
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
  };

  const { data: runId, error: lockErr } = await db.rpc("start_job", { job_name: JOB });
  if (lockErr) throw new Error(`Could not start job: ${lockErr.message}`);
  if (runId === null) return { ...report, status: "skipped", reason: "Another refresh is already running." };

  try {
    const { data: sources, error } = await db.from("data_sources").select("id, slug");
    if (error) throw new Error(error.message);
    const sourceId = (slug: string) => sources?.find((s) => s.slug === slug)?.id as string | undefined;

    const tcgtracking = opts.tcgtracking === undefined ? new TcgTrackingProvider() : opts.tcgtracking;
    if (tcgtracking && !sourceId("tcgtracking")) {
      report.errors.push("The 'tcgtracking' data source is missing. Run `npm run db:setup`.");
    }
    if (tcgtracking && sourceId("tcgtracking")) {
      const minMs = (opts.minIntervalHours ?? 12) * 3_600_000;
      const due = await dueSets(db, opts.force ? null : new Date(startedAt.getTime() - minMs));
      if (due.length === 0) {
        report.status = "skipped";
        report.reason = `Every set was refreshed in the last ${opts.minIntervalHours ?? 12} hours.`;
      }
      for (const [i, set] of due.entries()) {
        if (opts.timeBudgetMs && Date.now() - clockStart > opts.timeBudgetMs) {
          report.setsRemaining = due.length - i;
          break;
        }
        try {
          const r = await refreshSetPrices(db, tcgtracking, set, sourceId("tcgtracking")!, startedAt);
          report.snapshotsWritten += r.snapshots;
          report.cardsUnchanged += r.unchanged;
          report.unpricedProducts += r.unpricedProducts;
          report.unpricedCards += r.unpricedCards;
          report.setsProcessed++;
          opts.log?.(`[${i + 1}/${due.length}] ${set.name}: ${r.snapshots} new prices, ${r.unchanged} unchanged`);
        } catch (err) {
          report.errors.push(`${set.name}: ${(err as Error).message}`);
          opts.log?.(`[${i + 1}/${due.length}] ${set.name}: ${(err as Error).message}`);
        }
      }
    }

    // Secondary: Pokémon cards linked only to pokemontcg.io.
    const ptcg = opts.pokemontcg ?? null;
    if (ptcg && sourceId("pokemontcg_io")) {
      const { data: cards } = await db
        .from("cards")
        .select("id, pokemontcg_id, printing")
        .is("tcgplayer_product_id", null)
        .not("pokemontcg_id", "is", null)
        .limit(200);
      const rows: SnapshotRow[] = [];
      for (const card of cards ?? []) {
        try {
          const prices = await ptcg.getCurrentCardPrice(card.pokemontcg_id as string);
          const p = prices.find((x) => x.printing?.toLowerCase() === String(card.printing).toLowerCase());
          if (!p) continue;
          rows.push({
            sealed_product_id: null,
            card_id: card.id,
            source_id: sourceId("pokemontcg_io")!,
            source_kind: "provider",
            currency: p.currency,
            market_price: p.market === null ? null : p.market.toFixed(2),
            low_price: p.low === null ? null : p.low.toFixed(2),
            mid_price: p.mid === null ? null : p.mid.toFixed(2),
            high_price: p.high === null ? null : p.high.toFixed(2),
            captured_at: startedAt.toISOString(),
            provider_as_of: p.asOf?.toISOString() ?? null,
            snapshot_date: startedAt.toISOString().slice(0, 10),
          });
        } catch (err) {
          report.errors.push(`pokemontcg.io ${card.pokemontcg_id}: ${(err as Error).message}`);
        }
      }
      report.snapshotsWritten += await writeSnapshots(db, rows);
    }

    if (report.setsProcessed > 0) {
      opts.log?.("Updating price changes, set stats and EV results…");
      const fin = await finalizePrices(db, startedAt);
      report.evResultsStored = fin.evResults;
      report.errors.push(...fin.errors);
    }
    if (report.setsProcessed === 0 && report.errors.length > 0) report.status = "failed";
  } catch (err) {
    report.status = "failed";
    report.errors.push((err as Error).message);
  }

  report.finishedAt = now().toISOString();
  await db
    .from("job_runs")
    .update({ status: report.status, finished_at: report.finishedAt, details: report })
    .eq("id", runId);
  return report;
}

export async function writeSnapshots(db: SupabaseClient, rows: SnapshotRow[]): Promise<number> {
  let written = 0;
  const productRows = rows.filter((r) => r.sealed_product_id);
  const cardRows = rows.filter((r) => r.card_id);
  for (const [batch, conflict] of [
    [productRows, "sealed_product_id,source_id,snapshot_date"],
    [cardRows, "card_id,source_id,snapshot_date"],
  ] as const) {
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      const { error } = await db.from("price_snapshots").upsert(chunk, { onConflict: conflict });
      if (error) throw new Error(`Saving snapshots: ${error.message}`);
      written += chunk.length;
    }
  }
  return written;
}
