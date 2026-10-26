/**
 * Refresh prices from TCG API (needs TCGAPI_KEY in .env.local).
 *   npm run prices:refresh          # skips if refreshed in the last 12h
 *   npm run prices:refresh:force
 */
import { runPriceRefresh } from "../src/lib/pricing/refresh.ts";
import { adminClient } from "./lib.mts";

const report = await runPriceRefresh(adminClient(), {
  force: process.argv.includes("--force"),
  minIntervalHours: Number(process.env.PRICE_REFRESH_MIN_INTERVAL_HOURS ?? 12),
});
console.log(JSON.stringify(report, null, 2));
process.exit(report.status === "failed" ? 1 : 0);
