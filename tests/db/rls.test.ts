import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Applies the real migration + seed to a scratch PostgreSQL database (with a
 * small Supabase shim for auth.uid() and the anon/authenticated roles) and
 * checks the Row Level Security boundaries.
 *
 * Runs only when DATABASE_TEST_URL points at a server where the user can
 * create databases, e.g.
 *   DATABASE_TEST_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
 */

const ADMIN_URL = process.env.DATABASE_TEST_URL;
const DB_NAME = "sealedev_rls_test";
const root = join(__dirname, "..", "..");

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-000000000b0b";
const ADMIN = "00000000-0000-4000-8000-0000000ad111";

let db: Client;

/** Run fn as a Supabase role with the given user's JWT claims, in a rolled-back transaction. */
async function as<T>(role: "anon" | "authenticated", userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId } : {})]);
    await db.query(`set local role ${role}`);
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

describe.skipIf(!ADMIN_URL)("database security (RLS)", () => {
  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${DB_NAME}`);
    await admin.query(`create database ${DB_NAME}`);
    await admin.end();

    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB_NAME}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    for (const f of ["tests/db/supabase-shim.sql", "supabase/migrations/20261026000000_init.sql", "supabase/seed.sql"]) {
      await db.query(readFileSync(join(root, f), "utf8"));
    }
    await db.query(`insert into auth.users (id, email) values ($1, 'alice@test'), ($2, 'bob@test'), ($3, 'admin@test')`, [
      ALICE,
      BOB,
      ADMIN,
    ]);
    await db.query(`update public.profiles set is_admin = true where id = $1`, [ADMIN]);
    const { rows } = await db.query(`select id from public.sealed_products where slug = 'pokemon-surging-sparks-booster-box'`);
    await db.query(
      `insert into public.collection_sealed_positions (user_id, sealed_product_id, quantity, purchase_price_per_unit)
       values ($1, $2, 1, 150), ($3, $2, 2, 140)`,
      [ALICE, rows[0].id, BOB],
    );
    await db.query(
      `insert into public.collection_card_positions (user_id, custom_name, quantity, purchase_price_per_unit) values ($1, 'Alice card', 1, 10)`,
      [ALICE],
    );
  }, 60_000);

  afterAll(async () => {
    await db?.end();
  });

  it("creates a profile for each new auth user", async () => {
    const { rows } = await db.query(`select count(*)::int as n from public.profiles`);
    expect(rows[0].n).toBe(3);
  });

  it("lets a user see only their own collection", async () => {
    const rows = await as("authenticated", ALICE, async () =>
      (await db.query(`select user_id from public.collection_sealed_positions`)).rows,
    );
    expect(rows).toEqual([{ user_id: ALICE }]);
    const cards = await as("authenticated", BOB, async () =>
      (await db.query(`select * from public.collection_card_positions`)).rows,
    );
    expect(cards).toHaveLength(0);
  });

  it("prevents updating or deleting another user's lots", async () => {
    const updated = await as("authenticated", ALICE, async () =>
      (await db.query(`update public.collection_sealed_positions set quantity = 99 where user_id = $1`, [BOB])).rowCount,
    );
    expect(updated).toBe(0);
    const deleted = await as("authenticated", ALICE, async () =>
      (await db.query(`delete from public.collection_sealed_positions where user_id = $1`, [BOB])).rowCount,
    );
    expect(deleted).toBe(0);
    const { rows } = await db.query(`select quantity from public.collection_sealed_positions where user_id = $1`, [BOB]);
    expect(rows[0].quantity).toBe(2);
  });

  it("prevents inserting lots or watchlist items for another user", async () => {
    await expect(
      as("authenticated", ALICE, () =>
        db.query(
          `insert into public.collection_card_positions (user_id, custom_name, quantity, purchase_price_per_unit) values ($1, 'x', 1, 1)`,
          [BOB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as("authenticated", ALICE, () =>
        db.query(`update public.collection_sealed_positions set user_id = $1 where user_id = $2`, [BOB, ALICE]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("hides private data from anonymous visitors but shows the catalog", async () => {
    await expect(as("anon", null, () => db.query(`select * from public.collection_sealed_positions`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(as("anon", null, () => db.query(`select * from public.profiles`))).rejects.toThrow(/permission denied/);
    const products = await as("anon", null, async () => (await db.query(`select id from public.sealed_products`)).rows);
    expect(products.length).toBe(5);
  });

  it("only lets a user read their own profile and not grant themselves admin", async () => {
    const profiles = await as("authenticated", ALICE, async () => (await db.query(`select id from public.profiles`)).rows);
    expect(profiles).toEqual([{ id: ALICE }]);
    await expect(
      as("authenticated", ALICE, () => db.query(`update public.profiles set is_admin = true where id = $1`, [ALICE])),
    ).rejects.toThrow(/permission denied/);
    const ok = await as("authenticated", ALICE, async () =>
      (await db.query(`update public.profiles set default_currency = 'EUR' where id = $1`, [ALICE])).rowCount,
    );
    expect(ok).toBe(1);
  });

  it("restricts catalog and price writes to admins", async () => {
    await expect(
      as("authenticated", ALICE, () => db.query(`update public.sealed_products set current_price = 1`)),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      as("authenticated", ALICE, () =>
        db.query(
          `insert into public.price_snapshots (sealed_product_id, source_id, source_kind, market_price)
           select p.id, s.id, 'manual', 1 from public.sealed_products p, public.data_sources s where s.slug = 'manual' limit 1`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const price = await as("authenticated", ADMIN, async () => {
      await db.query(
        `insert into public.price_snapshots (sealed_product_id, source_id, source_kind, market_price, provider_as_of)
         select p.id, s.id, 'manual', 123.45, now() from public.sealed_products p, public.data_sources s
         where s.slug = 'manual' and p.slug = 'pokemon-surging-sparks-booster-box'`,
      );
      return (
        await db.query(
          `select current_price, current_price_kind from public.sealed_products where slug = 'pokemon-surging-sparks-booster-box'`,
        )
      ).rows[0];
    });
    // The snapshot trigger keeps the denormalized current price in sync.
    expect(price).toEqual({ current_price: "123.45", current_price_kind: "manual" });
  });

  it("keeps job bookkeeping away from regular users and blocks concurrent runs", async () => {
    await expect(as("authenticated", ALICE, () => db.query(`select public.start_job('x')`))).rejects.toThrow(
      /permission denied/,
    );
    const first = await db.query(`select public.start_job('refresh-prices') as id`);
    const second = await db.query(`select public.start_job('refresh-prices') as id`);
    expect(first.rows[0].id).not.toBeNull();
    expect(second.rows[0].id).toBeNull();
  });

  it("deletes a user's data when the account is deleted", async () => {
    await db.query(`delete from auth.users where id = $1`, [ALICE]);
    const { rows } = await db.query(
      `select (select count(*) from public.collection_sealed_positions where user_id = $1)::int as lots,
              (select count(*) from public.collection_card_positions where user_id = $1)::int as cards,
              (select count(*) from public.profiles where id = $1)::int as profiles`,
      [ALICE],
    );
    expect(rows[0]).toEqual({ lots: 0, cards: 0, profiles: 0 });
  });
});
