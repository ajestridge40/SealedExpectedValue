-- SealedEV initial schema.
--
-- Public catalog data (games, sets, products, cards, prices, pull models) is
-- readable by everyone and writable only by admins (profiles.is_admin) or the
-- service role used by scheduled jobs. User-owned data (profiles, collection
-- lots, watchlists) is visible and writable only by its owner, enforced with
-- Row Level Security on every table.
--
-- Money is stored as numeric(12,2) with an explicit ISO-4217 currency code.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.product_type as enum (
  'booster_box', 'elite_trainer_box', 'booster_bundle', 'collection_box',
  'booster_pack', 'blister', 'tin', 'other'
);

-- Where a price came from. "provider" = fetched from a pricing provider by the
-- refresh job; "csv_import" = uploaded by an admin; "manual" = typed in.
create type public.price_source_kind as enum ('provider', 'csv_import', 'manual');

-- Provenance of a pull-rate estimate. Never label a community estimate official.
create type public.pull_rate_source_type as enum (
  'official', 'community', 'user_assumption', 'unknown'
);

create type public.confidence_level as enum ('high', 'medium', 'low', 'insufficient');

-- What the stored probability is relative to. The EV engine converts all of
-- these into a per-slot-occurrence probability (see src/lib/ev/model.ts).
create type public.probability_basis as enum ('per_slot', 'per_pack', 'per_box');

create type public.outcome_kind as enum ('card', 'rarity_pool');

create type public.slot_kind as enum ('random', 'guaranteed');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  tcgplayer_category_id integer unique,
  created_at timestamptz not null default now()
);

create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_-]{2,40}$'),
  name text not null,
  kind text not null check (kind in ('pricing_provider', 'metadata_provider', 'pull_rate_source', 'import', 'manual')),
  website_url text check (website_url is null or website_url ~ '^https://'),
  attribution text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  preferred_game_id uuid references public.games (id) on delete set null,
  price_stale_after_hours integer not null default 72 check (price_stale_after_hours between 24 and 720),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile row whenever a Supabase Auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- True when the calling user is an admin. SECURITY DEFINER so policies can use
-- it without granting read access to other users' profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete restrict,
  name text not null,
  code text,
  release_date date,
  -- TCGplayer "group" id (TCGCSV uses the same ids). Filled by the catalog
  -- import when it can match the set name unambiguously, or set by an admin.
  tcgplayer_group_id integer unique,
  image_url text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, name)
);

create trigger sets_updated_at before update on public.sets
  for each row execute function public.set_updated_at();

create table public.sealed_products (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete restrict,
  set_id uuid references public.sets (id) on delete set null,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,120}$'),
  product_type public.product_type not null,
  release_date date,
  image_url text,
  description text,
  pack_count integer check (pack_count is null or pack_count >= 0),
  -- Free-form description of the contents (e.g. "9 booster packs, 1 promo, 65 sleeves").
  pack_configuration text,
  tcgplayer_product_id integer unique,
  msrp numeric(12, 2) check (msrp is null or msrp >= 0),
  -- Latest known price, maintained by the price_snapshots trigger below.
  current_price numeric(12, 2) check (current_price is null or current_price >= 0),
  current_price_currency char(3),
  current_price_source_id uuid references public.data_sources (id) on delete set null,
  current_price_kind public.price_source_kind,
  price_updated_at timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sealed_products_game_idx on public.sealed_products (game_id);
create index sealed_products_set_idx on public.sealed_products (set_id);
create index sealed_products_name_idx on public.sealed_products using gin (to_tsvector('simple', name));

create trigger sealed_products_updated_at before update on public.sealed_products
  for each row execute function public.set_updated_at();

-- One row per printing: "Pikachu ex 238/191 Holofoil" and the same card's
-- "Reverse Holofoil" printing are separate rows because they price separately.
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete restrict,
  set_id uuid references public.sets (id) on delete set null,
  name text not null,
  number text,
  rarity text,
  printing text not null default 'Normal',
  image_url text,
  tcgplayer_product_id integer,
  pokemontcg_id text,
  current_price numeric(12, 2) check (current_price is null or current_price >= 0),
  current_price_currency char(3),
  current_price_source_id uuid references public.data_sources (id) on delete set null,
  current_price_kind public.price_source_kind,
  price_updated_at timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tcgplayer_product_id, printing)
);

create unique index cards_identity_idx on public.cards (set_id, coalesce(number, ''), name, printing);
create index cards_set_rarity_idx on public.cards (set_id, rarity);
create index cards_game_idx on public.cards (game_id);
create index cards_name_idx on public.cards using gin (to_tsvector('simple', name));

create trigger cards_updated_at before update on public.cards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Prices
-- ---------------------------------------------------------------------------

create table public.price_snapshots (
  id bigint generated always as identity primary key,
  sealed_product_id uuid references public.sealed_products (id) on delete cascade,
  card_id uuid references public.cards (id) on delete cascade,
  source_id uuid not null references public.data_sources (id) on delete restrict,
  source_kind public.price_source_kind not null,
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  market_price numeric(12, 2) check (market_price is null or market_price >= 0),
  low_price numeric(12, 2) check (low_price is null or low_price >= 0),
  mid_price numeric(12, 2) check (mid_price is null or mid_price >= 0),
  high_price numeric(12, 2) check (high_price is null or high_price >= 0),
  -- When we stored it, and when the provider says the price was computed.
  captured_at timestamptz not null default now(),
  provider_as_of timestamptz,
  snapshot_date date not null default (now() at time zone 'utc')::date,
  note text check (char_length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  check (num_nonnulls(sealed_product_id, card_id) = 1)
);

-- One snapshot per item, source and day: re-running a refresh updates rather
-- than duplicates.
create unique index price_snapshots_product_day_idx
  on public.price_snapshots (sealed_product_id, source_id, snapshot_date) where sealed_product_id is not null;
create unique index price_snapshots_card_day_idx
  on public.price_snapshots (card_id, source_id, snapshot_date) where card_id is not null;
create index price_snapshots_product_time_idx on public.price_snapshots (sealed_product_id, captured_at desc);
create index price_snapshots_card_time_idx on public.price_snapshots (card_id, captured_at desc);

-- Keep products.current_price / cards.current_price pointing at the newest
-- snapshot that actually carries a market price.
create or replace function public.apply_price_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  as_of timestamptz := coalesce(new.provider_as_of, new.captured_at);
begin
  if new.market_price is null then
    return new;
  end if;
  if new.sealed_product_id is not null then
    update public.sealed_products
       set current_price = new.market_price,
           current_price_currency = new.currency,
           current_price_source_id = new.source_id,
           current_price_kind = new.source_kind,
           price_updated_at = as_of
     where id = new.sealed_product_id
       and (price_updated_at is null or price_updated_at <= as_of);
  else
    update public.cards
       set current_price = new.market_price,
           current_price_currency = new.currency,
           current_price_source_id = new.source_id,
           current_price_kind = new.source_kind,
           price_updated_at = as_of
     where id = new.card_id
       and (price_updated_at is null or price_updated_at <= as_of);
  end if;
  return new;
end;
$$;

create trigger price_snapshots_apply after insert or update on public.price_snapshots
  for each row execute function public.apply_price_snapshot();

-- ---------------------------------------------------------------------------
-- Pull-rate models
--
-- product_pull_models  one active model per product
--   pull_model_slots   independent slots; "occurrences" = times the slot
--                      appears in one product (e.g. 36 packs x 1 rare slot)
--     pull_rate_estimates  mutually exclusive outcomes within one slot
-- ---------------------------------------------------------------------------

create table public.product_pull_models (
  id uuid primary key default gen_random_uuid(),
  sealed_product_id uuid not null references public.sealed_products (id) on delete cascade,
  name text not null,
  version integer not null default 1,
  is_active boolean not null default true,
  packs_per_product integer not null check (packs_per_product >= 0),
  description text,
  assumptions text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sealed_product_id, version)
);

create unique index product_pull_models_active_idx
  on public.product_pull_models (sealed_product_id) where is_active;

create trigger product_pull_models_updated_at before update on public.product_pull_models
  for each row execute function public.set_updated_at();

create table public.pull_model_slots (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.product_pull_models (id) on delete cascade,
  name text not null,
  kind public.slot_kind not null default 'random',
  -- Slots per pack (multiplied by packs_per_product) or per product.
  occurrences_per_pack numeric(10, 4) check (occurrences_per_pack is null or occurrences_per_pack >= 0),
  occurrences_per_product numeric(10, 4) check (occurrences_per_product is null or occurrences_per_product >= 0),
  position integer not null default 0,
  notes text,
  check (num_nonnulls(occurrences_per_pack, occurrences_per_product) = 1),
  unique (model_id, name)
);

create index pull_model_slots_model_idx on public.pull_model_slots (model_id);

create table public.pull_rate_estimates (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.pull_model_slots (id) on delete cascade,
  -- Set whose cards make up a rarity pool. Defaults to the product's set.
  set_id uuid references public.sets (id) on delete set null,
  label text not null,
  outcome_kind public.outcome_kind not null,
  card_id uuid references public.cards (id) on delete cascade,
  rarities text[],
  -- Restrict a pool to one printing (e.g. 'Reverse Holofoil'). When null the
  -- engine uses one printing per card (see docs/EV_METHODOLOGY.md).
  printing text,
  -- Null = unknown. is_remainder = "whatever probability the other outcomes
  -- in this slot leave over" (only valid when all of them are known).
  probability numeric(16, 12) check (probability is null or probability >= 0),
  is_remainder boolean not null default false,
  probability_basis public.probability_basis not null default 'per_pack',
  source_type public.pull_rate_source_type not null,
  source_id uuid references public.data_sources (id) on delete set null,
  source_name text,
  source_url text check (source_url is null or source_url ~ '^https://'),
  sample_size integer check (sample_size is null or sample_size > 0),
  last_verified_at date,
  confidence public.confidence_level not null default 'low',
  notes text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (outcome_kind = 'card' and card_id is not null and rarities is null)
    or (outcome_kind = 'rarity_pool' and card_id is null and rarities is not null and cardinality(rarities) > 0)
  ),
  check (not (is_remainder and probability is not null)),
  -- An "official" rate must cite where it was published.
  check (source_type <> 'official' or source_url is not null)
);

create index pull_rate_estimates_slot_idx on public.pull_rate_estimates (slot_id);

create trigger pull_rate_estimates_updated_at before update on public.pull_rate_estimates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- User data: collection lots and watchlists
--
-- Each row is one acquisition lot, so several purchases of the same product at
-- different prices/dates are tracked separately and valued lot by lot.
-- ---------------------------------------------------------------------------

create table public.collection_sealed_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sealed_product_id uuid references public.sealed_products (id) on delete restrict,
  custom_name text check (char_length(custom_name) <= 200),
  custom_set_name text check (char_length(custom_set_name) <= 200),
  quantity integer not null check (quantity > 0 and quantity <= 100000),
  purchase_price_per_unit numeric(12, 2) not null check (purchase_price_per_unit >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  purchase_date date,
  fees numeric(12, 2) not null default 0 check (fees >= 0),
  shipping numeric(12, 2) not null default 0 check (shipping >= 0),
  condition text check (char_length(condition) <= 60),
  storage_location text check (char_length(storage_location) <= 200),
  notes text check (char_length(notes) <= 2000),
  -- Owner-entered valuation for custom items (or to override a missing price).
  manual_unit_value numeric(12, 2) check (manual_unit_value is null or manual_unit_value >= 0),
  manual_value_as_of timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sealed_product_id is not null or custom_name is not null)
);

create index collection_sealed_user_idx on public.collection_sealed_positions (user_id);
create index collection_sealed_product_idx on public.collection_sealed_positions (sealed_product_id);

create trigger collection_sealed_updated_at before update on public.collection_sealed_positions
  for each row execute function public.set_updated_at();

create table public.collection_card_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id uuid references public.cards (id) on delete restrict,
  custom_name text check (char_length(custom_name) <= 200),
  custom_set_name text check (char_length(custom_set_name) <= 200),
  quantity integer not null check (quantity > 0 and quantity <= 100000),
  purchase_price_per_unit numeric(12, 2) not null check (purchase_price_per_unit >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  purchase_date date,
  condition text check (char_length(condition) <= 60),
  language text not null default 'English' check (char_length(language) <= 40),
  grading_company text check (char_length(grading_company) <= 40),
  grade text check (char_length(grade) <= 20),
  grading_fees numeric(12, 2) not null default 0 check (grading_fees >= 0),
  acquisition_fees numeric(12, 2) not null default 0 check (acquisition_fees >= 0),
  notes text check (char_length(notes) <= 2000),
  manual_unit_value numeric(12, 2) check (manual_unit_value is null or manual_unit_value >= 0),
  manual_value_as_of timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (card_id is not null or custom_name is not null)
);

create index collection_card_user_idx on public.collection_card_positions (user_id);
create index collection_card_card_idx on public.collection_card_positions (card_id);

create trigger collection_card_updated_at before update on public.collection_card_positions
  for each row execute function public.set_updated_at();

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sealed_product_id uuid references public.sealed_products (id) on delete cascade,
  card_id uuid references public.cards (id) on delete cascade,
  target_price numeric(12, 2) check (target_price is null or target_price >= 0),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  check (num_nonnulls(sealed_product_id, card_id) = 1),
  unique (user_id, sealed_product_id),
  unique (user_id, card_id)
);

create index watchlist_user_idx on public.watchlist_items (user_id);

-- ---------------------------------------------------------------------------
-- Job bookkeeping (scheduled price refresh). Service role only.
-- ---------------------------------------------------------------------------

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  details jsonb
);

-- At most one running instance of each job: a concurrent start fails the insert.
create unique index job_runs_one_running_idx on public.job_runs (job) where status = 'running';
create index job_runs_job_time_idx on public.job_runs (job, started_at desc);

-- Claim a job, clearing a lock older than stale_after (a crashed run).
create or replace function public.start_job(job_name text, stale_after interval default interval '30 minutes')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_id bigint;
begin
  update public.job_runs
     set status = 'failed', finished_at = now(), details = jsonb_build_object('error', 'lock expired')
   where job = job_name and status = 'running' and started_at < now() - stale_after;
  insert into public.job_runs (job, status) values (job_name, 'running')
    on conflict do nothing
    returning id into run_id;
  return run_id; -- null when another run holds the lock
end;
$$;

revoke all on function public.start_job(text, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.games enable row level security;
alter table public.data_sources enable row level security;
alter table public.profiles enable row level security;
alter table public.sets enable row level security;
alter table public.sealed_products enable row level security;
alter table public.cards enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.product_pull_models enable row level security;
alter table public.pull_model_slots enable row level security;
alter table public.pull_rate_estimates enable row level security;
alter table public.collection_sealed_positions enable row level security;
alter table public.collection_card_positions enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.job_runs enable row level security;

-- Public catalog: anyone can read; only admins can write.
do $$
declare
  t text;
begin
  foreach t in array array[
    'games', 'data_sources', 'sets', 'sealed_products', 'cards', 'price_snapshots',
    'product_pull_models', 'pull_model_slots', 'pull_rate_estimates'
  ] loop
    execute format('create policy "%s readable by everyone" on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('create policy "%s insert by admins" on public.%I for insert to authenticated with check ((select public.is_admin()))', t, t);
    execute format('create policy "%s update by admins" on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t, t);
    execute format('create policy "%s delete by admins" on public.%I for delete to authenticated using ((select public.is_admin()))', t, t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Profiles: owner can read and update a whitelist of columns. is_admin can
-- only be changed with the service role (SQL editor / CLI).
create policy "profiles readable by owner" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles updatable by owner" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, default_currency, preferred_game_id, price_stale_after_hours)
  on public.profiles to authenticated;

-- Owner-only tables.
do $$
declare
  t text;
begin
  foreach t in array array['collection_sealed_positions', 'collection_card_positions', 'watchlist_items'] loop
    execute format('create policy "%s select own" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s insert own" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s update own" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s delete own" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Admins may see job history; nobody but the service role may write it.
create policy "job_runs readable by admins" on public.job_runs
  for select to authenticated using ((select public.is_admin()));
revoke all on public.job_runs from anon, authenticated;
grant select on public.job_runs to authenticated;
