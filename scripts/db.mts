import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export const SUPABASE_DIR = join(import.meta.dirname, "..", "supabase");

export function migrationFiles(): string[] {
  return readdirSync(join(SUPABASE_DIR, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(SUPABASE_DIR, "migrations", f));
}

export const SEED_FILE = join(SUPABASE_DIR, "seed.sql");

/** Postgres client for a Supabase connection string (TLS for anything but localhost). */
export async function connect(url: string): Promise<pg.Client> {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

export async function schemaExists(client: pg.Client): Promise<boolean> {
  const { rows } = await client.query("select to_regclass('public.games') as t");
  return rows[0].t !== null;
}

export async function applyFiles(client: pg.Client, files: string[]): Promise<void> {
  for (const file of files) {
    process.stdout.write(`  applying ${file.slice(SUPABASE_DIR.length + 1)} ... `);
    await client.query(readFileSync(file, "utf8"));
    console.log("ok");
  }
}
