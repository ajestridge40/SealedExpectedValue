/**
 * Apply SQL files to DATABASE_URL with node-postgres (no psql needed; works the
 * same in PowerShell, cmd and bash).
 *   npm run db:seed     # supabase/seed.sql (idempotent)
 *   npm run db:setup    # migrations + seed, for a brand-new database only
 */
import { SEED_FILE, applyFiles, connect, migrationFiles, schemaExists } from "./db.mts";

const mode = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL in .env.local (Supabase: Connect → Session pooler connection string).");
  process.exit(1);
}

const client = await connect(url);
try {
  if (mode === "setup") {
    if (await schemaExists(client)) {
      console.error("The schema already exists. Use `npm run db:seed` to re-run the seed only.");
      process.exit(1);
    }
    await applyFiles(client, [...migrationFiles(), SEED_FILE]);
  } else {
    await applyFiles(client, [SEED_FILE]);
  }
} finally {
  await client.end();
}
