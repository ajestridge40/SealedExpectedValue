/**
 * Link sets/products to TCG API / TCGplayer ids and import all cards (needs TCGAPI_KEY).
 *   npm run catalog:import
 */
import { runCatalogImport } from "../src/lib/catalog/import.ts";
import { adminClient } from "./lib.mts";

const report = await runCatalogImport(adminClient());
console.log(JSON.stringify(report, null, 2));
process.exit(report.errors.length ? 1 : 0);
