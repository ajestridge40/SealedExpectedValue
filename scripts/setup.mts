/**
 * One-command local setup (works in PowerShell, cmd, bash):
 *   npm run setup
 *
 * 1. Asks for your Supabase keys and writes .env.local (skipped if it exists).
 * 2. Creates the database schema and seed data (or re-runs the idempotent seed).
 * 3. Imports the catalog and the first prices from TCGCSV.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { runCatalogImport } from "../src/lib/catalog/import.ts";
import { runPriceRefresh } from "../src/lib/pricing/refresh.ts";
import { SEED_FILE, applyFiles, connect, migrationFiles, schemaExists } from "./db.mts";

const ENV_FILE = join(import.meta.dirname, "..", ".env.local");

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

type Lines = AsyncIterator<string>;

async function ask(lines: Lines, question: string, check: (v: string) => string | null) {
  for (;;) {
    output.write(question);
    const next = await lines.next();
    if (next.done) {
      console.error("\nInput ended before setup was complete.");
      process.exit(1);
    }
    const answer = next.value.trim();
    const problem = check(answer);
    if (!problem) return answer;
    console.log(`  ✗ ${problem}`);
  }
}

console.log("\nSealedEV setup\n==============\n");

let env: Record<string, string>;
if (existsSync(ENV_FILE)) {
  console.log("Using existing .env.local (delete it to re-enter your keys).\n");
  env = parseEnv(readFileSync(ENV_FILE, "utf8"));
} else {
  console.log(
    "You need a Supabase project (free): https://supabase.com/dashboard → New project.\n" +
      "Then open your project and click “Connect” (top bar) and Project Settings → API Keys.\n",
  );
  const rl = createInterface({ input, terminal: false });
  const lines: Lines = rl[Symbol.asyncIterator]();
  const url = await ask(lines, "Project URL (https://<ref>.supabase.co): ", (v) =>
    /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v) || /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(v)
      ? null
      : "Expected something like https://abcdefgh.supabase.co",
  );
  const anon = await ask(lines, "Publishable key (sb_publishable_…) or legacy anon key: ", (v) =>
    v.length >= 20 ? null : "That looks too short.",
  );
  const secret = await ask(lines, "Secret key (sb_secret_…) or legacy service_role key: ", (v) =>
    v.length >= 20 ? null : "That looks too short.",
  );
  const db = await ask(
    lines,
    "Database connection string — use “Session pooler” (postgresql://postgres.<ref>:<password>@…pooler.supabase.com:5432/postgres)\n" +
      "  (replace [YOUR-PASSWORD] with your database password): ",
    (v) =>
      !/^postgres(ql)?:\/\//.test(v)
        ? "Must start with postgresql://"
        : v.includes("[YOUR-PASSWORD]")
          ? "Replace [YOUR-PASSWORD] with your database password."
          : null,
  );
  rl.close();
  env = {
    NEXT_PUBLIC_SUPABASE_URL: url.replace(/\/$/, ""),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    NEXT_PUBLIC_ENABLE_GOOGLE_AUTH: "0",
    SUPABASE_SERVICE_ROLE_KEY: secret,
    CRON_SECRET: randomBytes(24).toString("hex"),
    DATABASE_URL: db,
  };
  writeFileSync(
    ENV_FILE,
    "# Written by `npm run setup`. Keep this file private; it is git-ignored.\n" +
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") +
      "\n",
  );
  console.log("\n✓ Wrote .env.local\n");
}

// --- Database --------------------------------------------------------------
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is missing from .env.local. Add the Session pooler connection string and re-run.");
  process.exit(1);
}
console.log("Database:");
let client;
try {
  client = await connect(env.DATABASE_URL);
} catch (err) {
  console.error(`\n✗ Could not connect to the database: ${(err as Error).message}`);
  console.error(
    "  Check the password in DATABASE_URL, and use the “Session pooler” string (the “Direct connection”\n" +
      "  host is IPv6-only and fails on many home networks).",
  );
  process.exit(1);
}
try {
  if (await schemaExists(client)) {
    console.log("  schema already exists; re-running the seed (safe to repeat)");
    await applyFiles(client, [SEED_FILE]);
  } else {
    await applyFiles(client, [...migrationFiles(), SEED_FILE]);
  }
} finally {
  await client.end();
}
console.log("✓ Database ready\n");

// --- Catalog and prices ---------------------------------------------------
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
console.log("Importing catalog from TCGCSV (sets, products, cards, images)…");
const imp = await runCatalogImport(admin);
console.log(
  `  ${imp.setsLinked.length} set(s) linked, ${imp.productsLinked.length} product(s) linked, ${imp.cardsUpserted} card printings`,
);
for (const n of [...imp.needsAttention, ...imp.errors]) console.log(`  ! ${n}`);

console.log("Refreshing prices…");
const ref = await runPriceRefresh(admin, { force: true });
console.log(`  ${ref.status}: ${ref.snapshotsWritten} prices from ${ref.setsProcessed} set(s)`);
for (const e of ref.errors) console.log(`  ! ${e}`);

console.log(`
Done. Next:
  npm run dev                      then open http://localhost:3000
  Sign up in the app, then make yourself an admin:
  npm run user:make-admin you@example.com

Tip: in Supabase → Authentication → URL Configuration, set Site URL to http://localhost:3000 and add
http://localhost:3000/auth/callback to Redirect URLs (or turn off “Confirm email” under Sign In / Providers → Email
while testing locally).
`);
