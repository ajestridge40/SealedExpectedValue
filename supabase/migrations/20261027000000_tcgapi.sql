-- Pricing provider switched to TCG API (tcgapi.dev). Store its ids next to the
-- TCGplayer ids so sets can be fetched directly and products/cards resolved
-- without another search.

alter table public.sets add column tcgapi_set_id integer unique;
alter table public.sealed_products add column tcgapi_id integer unique;
alter table public.cards add column tcgapi_id integer;

create index cards_tcgapi_idx on public.cards (tcgapi_id);

insert into public.data_sources (slug, name, kind, website_url, attribution, notes) values
  ('tcgapi', 'TCG API (TCGplayer market prices)', 'pricing_provider', 'https://tcgapi.dev',
   'Prices: TCGplayer market prices via TCG API (tcgapi.dev).',
   'Requires an API key. Plans are metered per day; prices refresh about daily for major games.')
on conflict (slug) do nothing;

-- A card's identity is its TCGplayer product id + printing (unique already).
-- TCGplayer can list distinct products with the same set/name/number/printing
-- (e.g. stamped variants), so the old name-based index must not be unique.
drop index public.cards_identity_idx;
create index cards_identity_idx on public.cards (set_id, coalesce(number, ''), name, printing);
