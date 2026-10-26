import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "../data/fetch-all";
import { planSnapshots, type SnapshotRow, type TrackedCard, type TrackedProduct } from "./plan";
import { TcgApiProvider } from "./providers/tcgapi";

/*
 * Scheduled price refresh from TCG API. Takes a service-role client (no
 * "server-only" import, so the CLI script can use it too).
 *
 * - Holds a job lock (job_runs) so overlapping cron/manual runs do not race.
 * - Skips if a successful run finished recently, unless forced: TCG API prices
 *   update about once a day and plans are metered per day.
 * - Per set: one request on plans with /sets/{id}/prices (every printing),
 *   otherwise two or three (primary printing of cards + sealed products).
 * - Provider failures are recorded and the last known prices are left
 *   untouched. Hitting the daily limit stops the run early.
 */

export interface RefreshReport {
  status: "succeeded" | "failed" | "skipped";
  reason?: string;
  setsProcessed: number;
  snapshotsWritten: number;
  unpricedProducts: number;
  unpricedCards: number;
  /** False when the plan only exposes each card's primary printing (other printings stay unpriced). */
  allPrintings?: boolean;
  requestsRemainingToday?: number | null;
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
    provider?: TcgApiProvider;
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

  const provider = opts.provider ?? new TcgApiProvider();
  if (!provider.configured) {
    return {
      ...report,
      status: "failed",
      errors: ["TCGAPI_KEY is not set. Get a free key at https://tcgapi.dev/dashboard and add it to .env.local."],
    };
  }

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
    const { data: source, error } = await db.from("data_sources").select("id").eq("slug", "tcgapi").maybeSingle();
    if (error) throw new Error(error.message);
    if (!source) throw new Error("The 'tcgapi' data source is missing. Run `npm run db:seed`.");

    const { data: sets, error: setErr } = await db
      .from("sets")
      .select("id, name, tcgapi_set_id")
      .not("tcgapi_set_id", "is", null);
    if (setErr) throw new Error(setErr.message);
    if (!sets?.length) report.errors.push("No sets are linked to TCG API yet. Run the catalog import first.");

    for (const set of sets ?? []) {
      try {
        const { prices, allPrintings } = await provider.setPrices(set.tcgapi_set_id as number);
        report.allPrintings = (report.allPrintings ?? true) && allPrintings;
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
        const plan = planSnapshots({ products, cards, prices, sourceId: source.id, capturedAt: startedAt });
        report.snapshotsWritten += await writeSnapshots(db, plan.rows);
        report.unpricedProducts += plan.unpricedProducts.length;
        report.unpricedCards += plan.unpricedCards.length;
        report.setsProcessed++;
      } catch (err) {
        report.errors.push(`${set.name}: ${(err as Error).message}`);
        if (/429|daily request limit|401/.test((err as Error).message)) break;
      }
    }
    report.requestsRemainingToday = provider.rateLimit?.daily_remaining ?? null;

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
