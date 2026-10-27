/**
 * Refresh prices from TCGTracking (and pokemontcg.io when ENABLE_POKEMONTCG=1)
 * for every linked set. Resumable: only sets not refreshed in the last
 * PRICE_REFRESH_MIN_INTERVAL_HOURS (default 12) are processed.
 *   npm run prices:refresh
 *   npm run prices:refresh force      # every set, now
 */
import { PokemonTcgProvider } from "../src/lib/pricing/providers/pokemontcg.ts";
import { runPriceRefresh } from "../src/lib/pricing/refresh.ts";
import { adminClient } from "./lib.mts";

const report = await runPriceRefresh(adminClient(), {
  force: process.argv.includes("--force") || process.argv.includes("force"),
  minIntervalHours: Number(process.env.PRICE_REFRESH_MIN_INTERVAL_HOURS ?? 12),
  tcgtracking: process.env.ENABLE_TCGTRACKING === "0" ? null : undefined,
  pokemontcg: process.env.ENABLE_POKEMONTCG === "1" ? new PokemonTcgProvider() : null,
  log: (m) => console.log(`  ${m}`),
});
const { errors, ...summary } = report;
console.log(JSON.stringify({ ...summary, errors: errors.slice(0, 30), errorCount: errors.length }, null, 2));
process.exit(report.status === "failed" ? 1 : 0);
