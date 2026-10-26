import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "../data/fetch-all";
import { planSnapshots, type SnapshotRow, type TrackedCard, type TrackedProduct } from "./plan";
import { PokemonTcgProvider } from "./providers/pokemontcg";
import { TcgTrackingProvider } from "./providers/tcgtracking";

/*
 * Scheduled price refresh. Takes a service-role client (no "server-only"
 * import, so the CLI script can use it too).
 *
 * - Holds a job lock (job_runs) so overlapping cron/manual runs do not race.
 * - Skips if a successful run finished recently, unless forced: prices change
 *   about daily, so refreshing more often only adds load on the free API.
 * - Two requests per set to TCGTracking (products + pricing). Provider failures are recorded and the
 *   last known prices are left untouched.
 */

export interface RefreshReport {
  status: "succeeded" | "failed" | "skipped";
  reason?: string;
  setsProcessed: number;
  snapshotsWritten: number;
  unpricedProducts: number;
  unpricedCards: number;
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

const JOB = "refresh-prices";

export async function runPriceRefresh(
  db: SupabaseClient,
  opts: {
    force?: boolean;
    minIntervalHours?: number;
    tcgtracking?: TcgTrackingProvider | null;
    pokemontcg?: PokemonTcgProvider | null;
    now?: () => Date;
  } = {},
): Promise<RefreshReport> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now();
  const report: RefreshReport = {
    status: "succeeded",
    setsProcessed: 0,
    snapshotsWritten: 0,
    unpricedProducts: 0,
    unpricedCards: 0,
    errors: [],
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
  };

  if (!opts.force) {
    const { data: last } = await db
      .from("job_runs")
      .select("finished_at")
      .eq("job", JOB)
      .eq("status", "succeeded")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const minMs = (opts.minIntervalHours ?? 12) * 3_600_000;
    if (last?.finished_at && startedAt.getTime() - new Date(last.finished_at).getTime() < minMs) {
      return { ...report, status: "skipped", reason: `Last successful refresh finished at ${last.finished_at}.` };
    }
  }

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
      const { data: sets, error: setErr } = await db
        .from("sets")
        .select("id, name, tcgplayer_group_id, games!inner(tcgplayer_category_id)")
        .not("tcgplayer_group_id", "is", null);
      if (setErr) throw new Error(setErr.message);

      for (const set of sets ?? []) {
        const game = set.games as unknown as { tcgplayer_category_id: number | null };
        if (!game?.tcgplayer_category_id) continue;
        try {
          const prices = await tcgtracking.setPrices(game.tcgplayer_category_id, set.tcgplayer_group_id as number);
          const products = await fetchAll<TrackedProduct>((f, t) =>
            db
              .from("sealed_products")
              .select("id, tcgplayer_product_id")
              .eq("set_id", set.id)
              .not("tcgplayer_product_id", "is", null)
              .range(f, t),
          );
          const cards = await fetchAll<TrackedCard>((f, t) =>
            db
              .from("cards")
              .select("id, tcgplayer_product_id, printing")
              .eq("set_id", set.id)
              .not("tcgplayer_product_id", "is", null)
              .order("id")
              .range(f, t),
          );
          const plan = planSnapshots({
            products,
            cards,
            prices,
            sourceId: sourceId("tcgtracking")!,
            capturedAt: startedAt,
          });
          report.snapshotsWritten += await writeSnapshots(db, plan.rows);
          report.unpricedProducts += plan.unpricedProducts.length;
          report.unpricedCards += plan.unpricedCards.length;
          report.setsProcessed++;
        } catch (err) {
          report.errors.push(`${set.name}: ${(err as Error).message}`);
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

async function writeSnapshots(db: SupabaseClient, rows: SnapshotRow[]): Promise<number> {
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
