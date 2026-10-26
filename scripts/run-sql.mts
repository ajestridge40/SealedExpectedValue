/**
 * Database helpers that need no psql (work the same in PowerShell, cmd, bash):
 *   npm run db:setup    # apply pending migrations, then the seed (safe to repeat)
 *   npm run db:seed     # seed only (idempotent)
 */
import { SEED_FILE, applyFiles, connect, migrate } from "./db.mts";

const mode = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL in .env.local (Supabase: Connect → Session pooler connection string).");
  process.exit(1);
}

const client = await connect(url);
try {
  if (mode === "setup") await migrate(client);
  await applyFiles(client, [SEED_FILE]);
} finally {
  await client.end();
}
