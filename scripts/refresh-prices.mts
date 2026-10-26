/**
 * Refresh prices from TCGTracking (and pokemontcg.io when ENABLE_POKEMONTCG=1).
 *   npm run prices:refresh            # skips if refreshed in the last 12h
 *   npm run prices:refresh -- --force
 */
import { PokemonTcgProvider } from "../src/lib/pricing/providers/pokemontcg.ts";
import { runPriceRefresh } from "../src/lib/pricing/refresh.ts";
import { adminClient } from "./lib.mts";

const report = await runPriceRefresh(adminClient(), {
  force: process.argv.includes("--force"),
  minIntervalHours: Number(process.env.PRICE_REFRESH_MIN_INTERVAL_HOURS ?? 12),
  tcgtracking: process.env.ENABLE_TCGTRACKING === "0" ? null : undefined,
  pokemontcg: process.env.ENABLE_POKEMONTCG === "1" ? new PokemonTcgProvider() : null,
});
console.log(JSON.stringify(report, null, 2));
process.exit(report.status === "failed" ? 1 : 0);
