import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/env";
import { PokemonTcgProvider } from "@/lib/pricing/providers/pokemontcg";
import { runPriceRefresh } from "@/lib/pricing/refresh";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = config.cronSecret();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled price refresh. Vercel Cron calls it with "Authorization: Bearer
 * $CRON_SECRET"; other schedulers (AWS EventBridge, GitHub Actions, cron-job.org)
 * can do the same. ?force=1 ignores the minimum interval.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const report = await runPriceRefresh(createAdminClient(), {
      force: request.nextUrl.searchParams.get("force") === "1",
      minIntervalHours: config.refreshMinIntervalHours(),
      tcgtracking: config.enableTcgtracking() ? undefined : null,
      pokemontcg: config.enablePokemonTcg() ? new PokemonTcgProvider() : null,
    });
    return NextResponse.json(report, { status: report.status === "failed" ? 502 : 200 });
  } catch (err) {
    return NextResponse.json({ status: "failed", error: (err as Error).message }, { status: 500 });
  }
}
