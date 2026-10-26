import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
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

/**
 * Apply pending migrations in order, each in a transaction, recording them in
 * supabase_migrations.schema_migrations (the table the Supabase CLI uses, so
 * `supabase db push` and this script agree on what has been applied).
 * Returns the versions applied.
 */
export async function migrate(client: pg.Client): Promise<string[]> {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text
    )`);
  const files = migrationFiles().map((file) => {
    const [version, ...rest] = basename(file, ".sql").split("_");
    return { file, version, name: rest.join("_") };
  });
  const { rows } = await client.query("select version from supabase_migrations.schema_migrations");
  const applied = new Set(rows.map((r) => String(r.version)));

  // Databases created before migrations were tracked here: the schema exists
  // but nothing is recorded. Treat the initial migration as applied.
  if (applied.size === 0 && (await schemaExists(client))) {
    await client.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [
      files[0].version,
      files[0].name,
    ]);
    applied.add(files[0].version);
  }

  const done: string[] = [];
  for (const m of files) {
    if (applied.has(m.version)) continue;
    process.stdout.write(`  applying migrations/${basename(m.file)} ... `);
    await client.query("begin");
    try {
      await client.query(readFileSync(m.file, "utf8"));
      await client.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [
        m.version,
        m.name,
      ]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
    console.log("ok");
    done.push(m.version);
  }
  if (done.length === 0) console.log("  migrations: up to date");
  return done;
}

/**
 * Ask Supabase's REST API (PostgREST) to reload its schema cache, so tables
 * created just now are visible to the API immediately. Harmless elsewhere.
 */
export async function reloadApiSchema(client: pg.Client): Promise<void> {
  await client.query("notify pgrst, 'reload schema'");
}
