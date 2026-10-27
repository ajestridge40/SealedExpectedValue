/**
 * Add sets (sealed products, every card printing, images and prices) from
 * TCGTracking to the database. Free, no API key. Resumable: sets loaded in the
 * last 7 days are skipped, so re-running after a stop continues where it left off.
 *   npm run catalog:sync                       # Pokémon, latest 10 sets
 *   npm run catalog:sync pokemon,lorcana 15    # games (comma-separated), sets per game
 *   npm run catalog:sync:all                   # every game, every set: booster boxes + top 25 cards (fast)
 *   npm run catalog:sync all 0 boxes           # same
 *   npm run catalog:sync all 0                 # every game, every set, every product and card (hours)
 *   npm run catalog:sync all 0 force           # reload sets even if loaded recently
 * Games: all, pokemon, mtg, yugioh, one-piece, lorcana, star-wars-unlimited, riftbound, …
 */
import { runSetSync } from "../src/lib/catalog/sync.ts";
import { TcgTrackingProvider } from "../src/lib/pricing/providers/tcgtracking.ts";
import { adminClient } from "./lib.mts";

const flags = new Set(["--", "force", "--force", "boxes", "--boxes"]);
const args = process.argv.slice(2).filter((a) => !flags.has(a));
const force = process.argv.includes("force") || process.argv.includes("--force");
const boosterBoxesOnly = process.argv.includes("boxes") || process.argv.includes("--boxes");
const gameArg = (args.find((a) => /[a-z]/i.test(a)) ?? "pokemon").toLowerCase();
const games = gameArg === "all" ? ("all" as const) : gameArg.split(",").map((g) => g.trim());
const maxSets = Number(args.find((a) => /^\d+$/.test(a)) ?? 10);

console.log(
  `Syncing ${maxSets > 0 ? `the latest ${maxSets} set(s)` : "every set"} for ${games === "all" ? "every game" : games.join(", ")}` +
    `${boosterBoxesOnly ? ", booster boxes and top 25 cards only" : ""}${force ? " (force)" : ""} …`,
);
const started = Date.now();
const sync = await runSetSync(adminClient(), {
  games,
  maxSetsPerGame: maxSets,
  provider: new TcgTrackingProvider(),
  force,
  boosterBoxesOnly,
  log: (m) => console.log(`  ${m}`),
});
const minutes = ((Date.now() - started) / 60_000).toFixed(1);
console.log(
  `\nDone in ${minutes} min: ${sync.setsProcessed} set(s) loaded, ${sync.setsSkipped} skipped (loaded in the last 7 days), ` +
    `${sync.setsCreated.length} new, ` +
    (boosterBoxesOnly ? `${sync.setsWithoutBoxes} without a booster box, ` : "") +
    `${sync.productsCreated} sealed product(s) added, ` +
    `${sync.import.cardsUpserted} card printings, ${sync.pricesWritten} new prices, ${sync.evResultsStored} EV results.`,
);
const problems = [...sync.errors, ...sync.import.errors];
for (const e of problems.slice(0, 30)) console.log(`  ! ${e}`);
if (problems.length > 30) console.log(`  … and ${problems.length - 30} more`);
process.exit(sync.setsProcessed === 0 && problems.length ? 1 : 0);
