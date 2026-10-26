/**
 * Add the latest sets (sealed products, cards, images) for one or more games
 * from TCGTracking, then refresh prices. Free, no API key.
 *   npm run catalog:sync                       # Pokémon, latest 10 sets
 *   npm run catalog:sync pokemon,lorcana 15    # games (comma-separated), sets per game
 * Games: pokemon, one-piece, lorcana, star-wars-unlimited, riftbound, mtg, yugioh
 */
import { runSetSync } from "../src/lib/catalog/sync.ts";
import { TcgTrackingProvider } from "../src/lib/pricing/providers/tcgtracking.ts";
import { runPriceRefresh } from "../src/lib/pricing/refresh.ts";
import { adminClient } from "./lib.mts";

const args = process.argv.slice(2).filter((a) => a !== "--");
const games = (args.find((a) => /[a-z]/i.test(a)) ?? "pokemon").split(",").map((g) => g.trim().toLowerCase());
const maxSets = Number(args.find((a) => /^\d+$/.test(a)) ?? 10);

const db = adminClient();
const provider = new TcgTrackingProvider();
console.log(`Syncing the latest ${maxSets} set(s) for: ${games.join(", ")} …`);
const sync = await runSetSync(db, { games, maxSetsPerGame: maxSets, provider });
console.log(
  `  ${sync.setsCreated.length} set(s) added, ${sync.setsLinked.length} linked, ${sync.productsCreated} sealed product(s) added, ` +
    `${sync.import?.cardsUpserted ?? 0} card printings`,
);
for (const e of [...sync.errors, ...(sync.import?.needsAttention ?? []), ...(sync.import?.errors ?? [])])
  console.log(`  ! ${e}`);
console.log("Refreshing prices…");
const ref = await runPriceRefresh(db, { force: true, tcgtracking: provider });
console.log(`  ${ref.status}: ${ref.snapshotsWritten} prices from ${ref.setsProcessed} set(s)`);
for (const e of ref.errors.slice(0, 10)) console.log(`  ! ${e}`);
process.exit(ref.status === "failed" ? 1 : 0);
