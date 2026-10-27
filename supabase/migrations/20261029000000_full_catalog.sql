-- Full-catalog support: every set and product of every game, stored once and
-- read by all users. Built to stay fast and small with ~1M card printings:
--   * set images and sync bookkeeping on sets
--   * set_stats becomes a materialized view, refreshed after each price refresh
--   * 7/30-day price changes stored on sealed products
--   * EV results stored per product (computed by the refresh job)
--   * product_overview view so lists filter, sort and paginate in the database
--   * card prices only get a new history row when they change

-- ---------------------------------------------------------------------------
-- Sets: images and sync bookkeeping
-- ---------------------------------------------------------------------------

alter table public.sets
  add column if not exists symbol_url text,
  add column if not exists catalog_synced_at timestamptz,
  add column if not exists prices_synced_at timestamptz;

create index if not exists sets_prices_synced_idx on public.sets (prices_synced_at nulls first);
create index if not exists sets_game_idx on public.sets (game_id);
create index if not exists sealed_products_price_updated_idx on public.sealed_products (price_updated_at desc);

alter table public.games add column if not exists display_order integer not null default 100;
update public.games set display_order = case slug
  when 'pokemon' then 1 when 'mtg' then 2 when 'yugioh' then 3 when 'one-piece' then 4
  when 'lorcana' then 5 when 'star-wars-unlimited' then 6 when 'riftbound' then 7 else 100 end;

-- ---------------------------------------------------------------------------
-- Stored price changes on sealed products
-- ---------------------------------------------------------------------------

alter table public.sealed_products
  add column if not exists price_change_7d numeric(9, 2),
  add column if not exists price_change_30d numeric(9, 2);

create or replace function public.update_price_changes()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sealed_products p
     set price_change_7d = c7.pct_change, price_change_30d = c30.pct_change
    from public.sealed_products base
    left join public.sealed_price_changes(7) c7 on c7.sealed_product_id = base.id
    left join public.sealed_price_changes(30) c30 on c30.sealed_product_id = base.id
   where p.id = base.id
     and (p.price_change_7d is distinct from c7.pct_change or p.price_change_30d is distinct from c30.pct_change);
$$;

revoke all on function public.update_price_changes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_stats: materialized (aggregating ~1M cards on every page view is too slow)
-- ---------------------------------------------------------------------------

drop view if exists public.set_stats;

-- One row per set (sets without cards get zero counts), plus a cover image:
-- the set logo when TCGTracking has one, else the booster box, else the top card.
create materialized view public.set_stats as
with per_card as (
  select
    c.set_id,
    coalesce(c.tcgplayer_product_id::text, c.set_id::text || '|' || coalesce(c.number, '') || '|' || c.name) as card_key,
    max(c.current_price) as best_price,
    max(c.image_url) as image_url,
    bool_or(c.rarity in (
      'Special Illustration Rare', 'Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare', 'Ultra Rare',
      'Enchanted', 'Legendary', 'Iconic',
      'SEC', 'SP', 'AA', 'MR', 'TR', 'Secret Rare', 'Special Card', 'Manga Rare', 'Treasure Rare',
      'Special', 'Showcase'
    )) as is_alt_art
  from public.cards c
  where c.set_id is not null
  group by 1, 2
),
ranked as (
  select per_card.*, row_number() over (partition by set_id order by best_price desc nulls last) as rank
  from per_card
),
card_stats as (
  select
    set_id,
    count(*)::int as total_cards,
    count(best_price)::int as priced_cards,
    (count(*) filter (where best_price >= 10))::int as cards_above_10,
    (count(*) filter (where best_price >= 25))::int as chase_cards,
    (count(*) filter (where best_price >= 50))::int as cards_above_50,
    (count(*) filter (where is_alt_art))::int as alt_art_cards,
    coalesce(sum(best_price) filter (where rank <= 5 and best_price is not null), 0)::numeric(12, 2) as top5_value,
    max(best_price) as top_card_price,
    (array_agg(image_url order by best_price desc nulls last) filter (where image_url is not null))[1] as top_card_image
  from ranked
  group by set_id
),
sealed as (
  select
    set_id,
    count(*)::int as sealed_products,
    (array_agg(image_url order by (product_type = 'booster_box') desc, current_price desc nulls last)
      filter (where image_url is not null))[1] as sealed_image,
    min(current_price) filter (where product_type = 'booster_box' and current_price > 0) as box_price
  from public.sealed_products
  where set_id is not null
  group by set_id
)
select
  s.id as set_id,
  coalesce(cs.total_cards, 0) as total_cards,
  coalesce(cs.priced_cards, 0) as priced_cards,
  coalesce(cs.cards_above_10, 0) as cards_above_10,
  coalesce(cs.chase_cards, 0) as chase_cards,
  coalesce(cs.cards_above_50, 0) as cards_above_50,
  coalesce(cs.alt_art_cards, 0) as alt_art_cards,
  coalesce(cs.top5_value, 0)::numeric(12, 2) as top5_value,
  cs.top_card_price,
  coalesce(sd.sealed_products, 0) as sealed_products,
  sd.box_price,
  coalesce(s.image_url, sd.sealed_image, cs.top_card_image) as cover_image_url
from public.sets s
left join card_stats cs on cs.set_id = s.id
left join sealed sd on sd.set_id = s.id;

create unique index set_stats_set_idx on public.set_stats (set_id);
grant select on public.set_stats to anon, authenticated;

create or replace function public.refresh_set_stats()
returns void
language sql
security definer
set search_path = ''
as $$
  refresh materialized view concurrently public.set_stats;
$$;

revoke all on function public.refresh_set_stats() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Stored EV results (computed by the refresh job from the pull models)
-- ---------------------------------------------------------------------------

create table if not exists public.product_ev (
  sealed_product_id uuid primary key references public.sealed_products (id) on delete cascade,
  status text not null check (status in ('complete', 'partial', 'insufficient')),
  gross_ev numeric(12, 2),
  currency char(3) not null default 'USD',
  confidence public.confidence_level not null,
  pull_rate_confidence public.confidence_level not null,
  freshness text not null,
  probability_coverage real not null,
  price_coverage real not null,
  computed_at timestamptz not null default now()
);

alter table public.product_ev enable row level security;
create policy "product_ev readable by everyone" on public.product_ev for select to anon, authenticated using (true);
grant select on public.product_ev to anon, authenticated;

-- ---------------------------------------------------------------------------
-- product_overview: one row per sealed product with everything list pages need
-- ---------------------------------------------------------------------------

create or replace view public.product_overview with (security_invoker = true) as
select
  p.id, p.game_id, p.set_id, p.name, p.slug, p.product_type, p.release_date, p.image_url, p.pack_count,
  p.current_price, p.current_price_currency, p.current_price_kind, p.current_price_source_id, p.price_updated_at,
  p.is_sample, p.price_change_7d, p.price_change_30d, p.tcgplayer_product_id,
  s.name as set_name, s.image_url as set_image_url, s.symbol_url as set_symbol_url,
  g.name as game_name, g.slug as game_slug,
  st.top5_value, st.chase_cards, st.cards_above_50,
  case when p.current_price > 0 and st.top5_value > 0 then round(st.top5_value / p.current_price, 4) end as top5_ratio,
  coalesce(e.status, 'no_model') as ev_status,
  case when e.status in ('complete', 'partial') then e.gross_ev end as gross_ev,
  coalesce(e.confidence, 'insufficient') as confidence,
  coalesce(e.pull_rate_confidence, 'insufficient') as pull_rate_confidence,
  case coalesce(e.confidence, 'insufficient') when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end as confidence_rank,
  coalesce(e.freshness, 'unknown') as freshness,
  coalesce(e.probability_coverage, 0) as probability_coverage,
  coalesce(e.price_coverage, 0) as price_coverage,
  case when e.status in ('complete', 'partial') and p.current_price > 0
       then round(e.gross_ev / p.current_price, 4) end as ev_ratio,
  case when e.status in ('complete', 'partial') and p.current_price > 0
       then e.gross_ev - p.current_price end as net_ev,
  case when e.status in ('complete', 'partial') and p.current_price > 0
       then round((e.gross_ev - p.current_price) / p.current_price * 100, 2) end as net_pct
from public.sealed_products p
left join public.sets s on s.id = p.set_id
left join public.games g on g.id = p.game_id
left join public.set_stats st on st.set_id = p.set_id
left join public.product_ev e on e.sealed_product_id = p.id;

grant select on public.product_overview to anon, authenticated;

-- set_overview: one row per set for the Sets pages.
create index if not exists sets_release_idx on public.sets (release_date desc nulls last);

create or replace view public.set_overview with (security_invoker = true) as
select
  s.id, s.game_id, s.name, s.code, s.release_date, s.image_url, s.symbol_url, s.tcgplayer_group_id,
  s.prices_synced_at,
  g.name as game_name, g.slug as game_slug,
  coalesce(st.cover_image_url, s.image_url) as cover_image_url,
  coalesce(st.total_cards, 0) as total_cards,
  coalesce(st.priced_cards, 0) as priced_cards,
  coalesce(st.chase_cards, 0) as chase_cards,
  coalesce(st.cards_above_50, 0) as cards_above_50,
  coalesce(st.top5_value, 0) as top5_value,
  st.top_card_price,
  coalesce(st.sealed_products, 0) as sealed_products,
  st.box_price,
  case when st.box_price > 0 and st.top5_value > 0 then round(st.top5_value / st.box_price, 4) end as box_top5_ratio
from public.sets s
join public.games g on g.id = s.game_id
left join public.set_stats st on st.set_id = s.id;

grant select on public.set_overview to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Card prices: mark unchanged prices as current without a new history row
-- ---------------------------------------------------------------------------

create or replace function public.touch_card_prices(card_ids uuid[], as_of timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.cards
     set price_updated_at = as_of
   where id = any(card_ids)
     and current_price is not null
     and (price_updated_at is null or price_updated_at < as_of);
$$;

revoke all on function public.touch_card_prices(uuid[], timestamptz) from public, anon, authenticated;

-- Sealed products the same way (used when a price is unchanged).
create or replace function public.touch_product_prices(product_ids uuid[], as_of timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sealed_products
     set price_updated_at = as_of
   where id = any(product_ids)
     and current_price is not null
     and (price_updated_at is null or price_updated_at < as_of);
$$;

revoke all on function public.touch_product_prices(uuid[], timestamptz) from public, anon, authenticated;

-- Dashboard totals in one call (PostgREST has no aggregates by default).
-- Top-5 metrics use booster boxes only: single packs and small items make
-- "top-5 card value ÷ price" meaningless.
create or replace function public.market_overview()
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select json_build_object(
    'priced', count(*) filter (where current_price > 0),
    'boxes', count(*) filter (where current_price > 0 and product_type = 'booster_box'),
    'with_ev', count(*) filter (where ev_ratio is not null),
    'avg_ev_ratio', avg(ev_ratio),
    'ev_at_or_above_1', count(*) filter (where ev_ratio >= 1),
    'boxes_with_top5', count(*) filter (where product_type = 'booster_box' and top5_ratio is not null),
    'avg_box_top5_ratio', avg(top5_ratio) filter (where product_type = 'booster_box'),
    'box_top5_at_or_above_1', count(*) filter (where product_type = 'booster_box' and top5_ratio >= 1)
  )
  from public.product_overview;
$$;

grant execute on function public.market_overview() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes for browsing ~1M card printings
-- ---------------------------------------------------------------------------

create schema if not exists extensions; -- exists on Supabase; needed on plain Postgres (tests)
create extension if not exists pg_trgm with schema extensions;
create index if not exists cards_set_price_idx on public.cards (set_id, current_price desc nulls last);
create index if not exists cards_price_idx on public.cards (current_price desc nulls last, id);
create index if not exists cards_name_trgm_idx on public.cards using gin (name extensions.gin_trgm_ops);
create index if not exists sealed_products_name_trgm_idx on public.sealed_products using gin (name extensions.gin_trgm_ops);
create index if not exists sets_name_trgm_idx on public.sets using gin (name extensions.gin_trgm_ops);
