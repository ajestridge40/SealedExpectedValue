-- Market analytics derived from stored prices (no external calls):
--   set_stats                 per-set card value profile (chase cards, top-5 value, alt arts)
--   sealed_price_changes(n)   sealed product price now vs. n days ago (price movers)

-- One value per distinct card (its most valuable printing), then aggregated per set.
create view public.set_stats with (security_invoker = true) as
with per_card as (
  select
    c.set_id,
    coalesce(c.tcgplayer_product_id::text, c.set_id::text || '|' || coalesce(c.number, '') || '|' || c.name) as card_key,
    max(c.current_price) as best_price,
    bool_or(c.rarity in (
      -- Alt-art / chase rarities (Pokémon, Lorcana, One Piece, Star Wars: Unlimited)
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
)
select
  set_id,
  count(*)::int as total_cards,
  count(best_price)::int as priced_cards,
  (count(*) filter (where best_price >= 10))::int as cards_above_10,
  (count(*) filter (where best_price >= 25))::int as chase_cards,
  (count(*) filter (where best_price >= 50))::int as cards_above_50,
  (count(*) filter (where is_alt_art))::int as alt_art_cards,
  coalesce(sum(best_price) filter (where rank <= 5 and best_price is not null), 0)::numeric(12, 2) as top5_value,
  max(best_price) as top_card_price
from ranked
group by set_id;

grant select on public.set_stats to anon, authenticated;

-- Sealed product price change over p_days, using each product's latest
-- snapshot and its latest snapshot at least p_days old (same currency only).
create or replace function public.sealed_price_changes(p_days integer default 7)
returns table (
  sealed_product_id uuid,
  currency char(3),
  price_now numeric,
  price_then numeric,
  pct_change numeric,
  as_of timestamptz,
  then_as_of timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with obs as (
    select s.sealed_product_id, s.currency, s.market_price, coalesce(s.provider_as_of, s.captured_at) as observed
    from public.price_snapshots s
    where s.sealed_product_id is not null and s.market_price is not null
  ),
  now_p as (
    select distinct on (sealed_product_id) * from obs order by sealed_product_id, observed desc
  ),
  then_p as (
    select distinct on (sealed_product_id) *
    from obs
    where observed <= now() - make_interval(days => greatest(p_days, 1))
    order by sealed_product_id, observed desc
  )
  select n.sealed_product_id, n.currency, n.market_price, t.market_price,
         round((n.market_price - t.market_price) / nullif(t.market_price, 0) * 100, 2),
         n.observed, t.observed
  from now_p n
  join then_p t on t.sealed_product_id = n.sealed_product_id and t.currency = n.currency;
$$;

grant execute on function public.sealed_price_changes(integer) to anon, authenticated;
