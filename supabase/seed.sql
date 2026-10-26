-- SealedEV seed data. Idempotent: safe to run more than once.
--
-- What is here: real games, real sets and real sealed products, plus
-- pull-rate models built from publicly reported COMMUNITY estimates with
-- their sources. What is NOT here: prices, images, or card lists. Those come
-- from the catalog import and price refresh (`npm run catalog:import`,
-- `npm run prices:refresh:force`), so nothing in this file can be mistaken for
-- market data.
--
-- The Pokémon Company does not publish pull rates. The rates below come from
-- TCGplayer's published pack-opening studies (their own samples, reported with
-- 95% confidence intervals) and are labelled "community" accordingly.

-- ---------------------------------------------------------------------------
-- Games and data sources
-- ---------------------------------------------------------------------------

insert into public.games (slug, name, tcgplayer_category_id) values
  ('pokemon', 'Pokémon TCG', 3),
  ('mtg', 'Magic: The Gathering', 1),
  ('yugioh', 'Yu-Gi-Oh!', 2)
on conflict (slug) do update set name = excluded.name, tcgplayer_category_id = excluded.tcgplayer_category_id;

insert into public.data_sources (slug, name, kind, website_url, attribution, notes) values
  ('tcgapi', 'TCG API (TCGplayer market prices)', 'pricing_provider', 'https://tcgapi.dev',
   'Prices: TCGplayer market prices via TCG API (tcgapi.dev).',
   'Requires an API key. Plans are metered per day; prices refresh about daily for major games.'),
  ('csv_import', 'CSV import', 'import', null, null, 'Prices uploaded by an administrator.'),
  ('manual', 'Manual entry', 'manual', null, null, 'Prices typed in by an administrator.'),
  ('tcgplayer_pull_rates', 'TCGplayer pull-rate studies', 'pull_rate_source', 'https://www.tcgplayer.com/content',
   'Pull rates: TCGplayer pack-opening studies (community estimates, not official odds).', null),
  ('pack_structure', 'Pack composition (community-documented)', 'pull_rate_source', null, null,
   'Number of common/uncommon/reverse-holo/rare slots per booster pack as documented by the community.')
on conflict (slug) do update set
  name = excluded.name, kind = excluded.kind, website_url = excluded.website_url,
  attribution = excluded.attribution, notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- Sets and sealed products (no prices; those come from the price refresh)
-- ---------------------------------------------------------------------------

insert into public.sets (game_id, name, code, release_date)
select g.id, v.name, v.code, v.release_date::date
from public.games g
cross join (values
  ('Surging Sparks', 'sv8', '2024-11-08'),
  ('Prismatic Evolutions', 'sv8pt5', '2025-01-17')
) as v(name, code, release_date)
where g.slug = 'pokemon'
on conflict (game_id, name) do update set code = excluded.code, release_date = excluded.release_date;

insert into public.sealed_products
  (game_id, set_id, name, slug, product_type, release_date, pack_count, pack_configuration, description)
select s.game_id, s.id, v.name, v.slug, v.product_type::public.product_type, s.release_date, v.packs, v.config, v.description
from public.sets s
join (values
  ('Surging Sparks', 'Surging Sparks Booster Box', 'pokemon-surging-sparks-booster-box', 'booster_box', 36,
   '36 booster packs',
   'Booster display of 36 Surging Sparks packs (10 cards each, plus a basic Energy).'),
  ('Surging Sparks', 'Surging Sparks Elite Trainer Box', 'pokemon-surging-sparks-elite-trainer-box', 'elite_trainer_box', 9,
   '9 booster packs, 1 full-art promo card, card sleeves, Energy cards, dice, condition markers, storage box',
   'Elite Trainer Box with 9 Surging Sparks booster packs and accessories.'),
  ('Surging Sparks', 'Surging Sparks Booster Bundle', 'pokemon-surging-sparks-booster-bundle', 'booster_bundle', 6,
   '6 booster packs',
   'Bundle of 6 Surging Sparks booster packs.'),
  ('Prismatic Evolutions', 'Prismatic Evolutions Elite Trainer Box', 'pokemon-prismatic-evolutions-elite-trainer-box', 'elite_trainer_box', 9,
   '9 booster packs, 1 full-art Eevee promo card, card sleeves, Energy cards, dice, condition markers, storage box',
   'Elite Trainer Box with 9 Prismatic Evolutions booster packs. Prismatic Evolutions is a special set with no booster box.'),
  ('Prismatic Evolutions', 'Prismatic Evolutions Booster Bundle', 'pokemon-prismatic-evolutions-booster-bundle', 'booster_bundle', 6,
   '6 booster packs',
   'Bundle of 6 Prismatic Evolutions booster packs.')
) as v(set_name, name, slug, product_type, packs, config, description) on v.set_name = s.name
on conflict (slug) do update set
  name = excluded.name, product_type = excluded.product_type, pack_count = excluded.pack_count,
  pack_configuration = excluded.pack_configuration, description = excluded.description;

-- ---------------------------------------------------------------------------
-- Pull models
--
-- Scarlet & Violet-era booster (energy card excluded):
--   4 common slots, 3 uncommon slots, 1 rare slot, 2 reverse-holo slots, one
--   of which can be upgraded to a hit. EV depends on the per-pack rates; which
--   slot a hit is assigned to only changes which low-value filler card it
--   replaces. See docs/EV_METHODOLOGY.md.
-- ---------------------------------------------------------------------------

create or replace function pg_temp.seed_estimate(
  p_slot uuid, p_label text, p_rarities text[], p_probability numeric, p_remainder boolean,
  p_basis public.probability_basis, p_source_type public.pull_rate_source_type, p_source_slug text,
  p_source_name text, p_url text, p_sample integer, p_verified date, p_conf public.confidence_level,
  p_notes text, p_pos integer, p_printing text default null, p_contains text default null, p_excludes text default null
) returns void language sql as $$
  insert into public.pull_rate_estimates
    (slot_id, label, outcome_kind, rarities, printing, name_contains, name_excludes, probability, is_remainder,
     probability_basis, source_type, source_id, source_name, source_url, sample_size, last_verified_at,
     confidence, notes, position)
  values
    (p_slot, p_label, 'rarity_pool', p_rarities, p_printing, p_contains, p_excludes, p_probability, p_remainder,
     p_basis, p_source_type, (select id from public.data_sources where slug = p_source_slug), p_source_name, p_url,
     p_sample, p_verified, p_conf, p_notes, p_pos);
$$;

create or replace function pg_temp.seed_slot(p_model uuid, p_name text, p_per_pack numeric, p_pos integer, p_notes text)
returns uuid language sql as $$
  insert into public.pull_model_slots (model_id, name, kind, occurrences_per_pack, position, notes)
  values (p_model, p_name, 'random', p_per_pack, p_pos, p_notes)
  returning id;
$$;

-- Base slots shared by both sets: commons, uncommons, plain reverse holo.
create or replace function pg_temp.seed_base_slots(p_model uuid, p_reverse_excludes text) returns void
language plpgsql as $$
declare
  s uuid;
  structure_note text := 'Standard Scarlet & Violet booster composition.';
begin
  s := pg_temp.seed_slot(p_model, 'Common slots', 4, 0, '4 commons per pack.');
  perform pg_temp.seed_estimate(s, 'Common', array['Common'], 1, false, 'per_slot', 'community', 'pack_structure',
    'Pack composition (community-documented)', null, null, null, 'medium', structure_note, 0, 'Normal', null, p_reverse_excludes);

  s := pg_temp.seed_slot(p_model, 'Uncommon slots', 3, 1, '3 uncommons per pack.');
  perform pg_temp.seed_estimate(s, 'Uncommon', array['Uncommon'], 1, false, 'per_slot', 'community', 'pack_structure',
    'Pack composition (community-documented)', null, null, null, 'medium', structure_note, 0, 'Normal', null, p_reverse_excludes);

  s := pg_temp.seed_slot(p_model, 'Reverse holo slot', 1, 4, 'Second reverse-holo slot (never upgraded in this model).');
  perform pg_temp.seed_estimate(s, 'Reverse holo (common–rare)', array['Common', 'Uncommon', 'Rare'], 1, false, 'per_slot',
    'community', 'pack_structure', 'Pack composition (community-documented)', null, null, null, 'medium',
    structure_note || ' Valued at the Reverse Holofoil printing of commons, uncommons and rares.', 0,
    'Reverse Holofoil', null, p_reverse_excludes);
end;
$$;

-- Surging Sparks: TCGplayer study of 8,000+ packs opened before release.
create or replace function pg_temp.seed_surging_sparks(p_product_slug text) returns void
language plpgsql as $$
declare
  m uuid;
  s uuid;
  src_name text := 'TCGplayer: Pokémon TCG: Surging Sparks Pull Rates';
  src_url text := 'https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Surging-Sparks-Pull-Rates/6ccfb6ab-f26a-4ce8-bab5-5f91c85ec70e/';
  verified date := '2026-10-26';
  study text := 'TCGplayer opened 8,000+ packs before release; ';
begin
  if exists (select 1 from public.product_pull_models pm join public.sealed_products p on p.id = pm.sealed_product_id
             where p.slug = p_product_slug) then
    return;
  end if;

  insert into public.product_pull_models (sealed_product_id, name, packs_per_product, description, assumptions)
  select id, 'Scarlet & Violet booster model (community rates)', pack_count,
    'Per-pack hit rates from TCGplayer''s Surging Sparks pull-rate study, applied to every pack in the product.',
    'Rates are community estimates (TCGplayer''s own sample), not official odds. Cards within a rarity are assumed '
    'equally likely. Hits are modelled in one reverse-holo slot; Double Rares replace the holo rare. Promo cards, '
    'code cards and accessories are not included, so ETB results understate contents slightly.'
  from public.sealed_products where slug = p_product_slug
  returning id into m;

  perform pg_temp.seed_base_slots(m, null);

  s := pg_temp.seed_slot(m, 'Rare slot', 1, 2, 'Holo rare, sometimes upgraded to a Double Rare.');
  perform pg_temp.seed_estimate(s, 'Double Rare', array['Double Rare'], 0.1694, false, 'per_pack', 'community',
    'tcgplayer_pull_rates', src_name, src_url, 8000, verified, 'medium', study || '16.94% ± 0.79% (≈1 in 6 packs).', 0);
  perform pg_temp.seed_estimate(s, 'Rare (holo)', array['Rare', 'Holo Rare'], null, true, 'per_pack', 'community',
    'pack_structure', 'Pack composition (community-documented)', null, null, null, 'medium',
    'Remainder of the rare slot.', 1);

  s := pg_temp.seed_slot(m, 'Reverse holo / hit slot', 1, 3, 'Reverse-holo slot that can be upgraded to a hit.');
  perform pg_temp.seed_estimate(s, 'Ultra Rare', array['Ultra Rare'], 0.0674, false, 'per_pack', 'community',
    'tcgplayer_pull_rates', src_name, src_url, 8000, verified, 'medium', study || '6.74% ± 0.53% (≈1 in 15 packs).', 0);
  perform pg_temp.seed_estimate(s, 'Illustration Rare', array['Illustration Rare'], 0.0767, false, 'per_pack', 'community',
    'tcgplayer_pull_rates', src_name, src_url, 8000, verified, 'medium', study || '7.67% ± 0.56% (≈1 in 13 packs).', 1);
  perform pg_temp.seed_estimate(s, 'Special Illustration Rare', array['Special Illustration Rare'], 0.0115, false, 'per_pack',
    'community', 'tcgplayer_pull_rates', src_name, src_url, 8000, verified, 'medium',
    study || '1.15% ± 0.22% (≈1 in 87 packs). A separate 500-pack opening by TCGTalk saw ≈1 in 71.', 2);
  perform pg_temp.seed_estimate(s, 'Hyper Rare', array['Hyper Rare'], 0.0053, false, 'per_pack', 'community',
    'tcgplayer_pull_rates', src_name, src_url, 8000, verified, 'medium', study || '0.53% ± 0.15% (≈1 in 188 packs).', 3);
  perform pg_temp.seed_estimate(s, 'ACE SPEC Rare', array['ACE SPEC Rare'], 0.0503, false, 'per_pack', 'community',
    'tcgplayer_pull_rates', src_name, src_url, 8000, verified, 'medium', study || '5.03% ± 0.46% (≈1 in 20 packs).', 4);
  perform pg_temp.seed_estimate(s, 'Reverse holo (common–rare)', array['Common', 'Uncommon', 'Rare'], null, true, 'per_pack',
    'community', 'pack_structure', 'Pack composition (community-documented)', null, null, null, 'medium',
    'Remainder of the slot when no hit is pulled.', 5, 'Reverse Holofoil');
end;
$$;

-- Prismatic Evolutions: TCGplayer study of ~1,200 packs (a smaller sample).
-- No Double Rare rate was found in the sources reviewed, so that outcome is
-- left unknown and the result is reported as a partial estimate.
create or replace function pg_temp.seed_prismatic(p_product_slug text) returns void
language plpgsql as $$
declare
  m uuid;
  s uuid;
  src_name text := 'TCGplayer: Pokémon TCG: Prismatic Evolutions Pull Rates';
  src_url text := 'https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Prismatic-Evolutions-Pull-Rates/d94889ea-f76a-4a13-b74d-5b0b071220a7/';
  verified date := '2026-10-26';
  study text := 'TCGplayer sample of ~1,200 packs (small; TCGplayer notes God/Demigod packs affect the per-pack figure); ';
begin
  if exists (select 1 from public.product_pull_models pm join public.sealed_products p on p.id = pm.sealed_product_id
             where p.slug = p_product_slug) then
    return;
  end if;

  insert into public.product_pull_models (sealed_product_id, name, packs_per_product, description, assumptions)
  select id, 'Prismatic Evolutions booster model (community rates, partial)', pack_count,
    'Per-pack hit rates from TCGplayer''s Prismatic Evolutions pull-rate study.',
    'Rates are community estimates from a small sample, not official odds. The Double Rare rate is unknown, so the '
    'rare slot is excluded and the estimate is partial. Poké Ball / Master Ball pattern cards are matched by name '
    '("Poke Ball Pattern", "Master Ball Pattern"); if the catalog import names them differently those outcomes are '
    'excluded and flagged. God/Demigod packs are not modelled separately. Promo cards and accessories are excluded.'
  from public.sealed_products where slug = p_product_slug
  returning id into m;

  perform pg_temp.seed_base_slots(m, 'Pattern');

  s := pg_temp.seed_slot(m, 'Rare slot', 1, 2, 'Holo rare, sometimes upgraded to a Double Rare.');
  perform pg_temp.seed_estimate(s, 'Double Rare', array['Double Rare'], null, false, 'per_pack', 'unknown',
    null, null, null, null, null, 'insufficient', 'No sourced rate found; excluded from EV.', 0);
  perform pg_temp.seed_estimate(s, 'Rare (holo)', array['Rare', 'Holo Rare'], null, true, 'per_pack', 'community',
    'pack_structure', 'Pack composition (community-documented)', null, null, null, 'medium',
    'Remainder of the rare slot (unresolved while the Double Rare rate is unknown).', 1, null, null, 'Pattern');

  s := pg_temp.seed_slot(m, 'Reverse holo / hit slot', 1, 3, 'Reverse-holo slot that can be a pattern card or a hit.');
  perform pg_temp.seed_estimate(s, 'Ultra Rare', array['Ultra Rare'], 0.0769, false, 'per_pack', 'community',
    'tcgplayer_pull_rates', src_name, src_url, 1200, verified, 'low', study || '≈1 in 13 packs.', 0);
  perform pg_temp.seed_estimate(s, 'Special Illustration Rare', array['Special Illustration Rare'], 0.0222, false, 'per_pack',
    'community', 'tcgplayer_pull_rates', src_name, src_url, 1200, verified, 'low', study || '≈1 in 45 packs.', 1);
  perform pg_temp.seed_estimate(s, 'Hyper Rare', array['Hyper Rare'], 0.0056, false, 'per_pack', 'community',
    'tcgplayer_pull_rates', src_name, src_url, 1200, verified, 'low', study || '≈1 in 180 packs.', 2);
  perform pg_temp.seed_estimate(s, 'ACE SPEC Rare', array['ACE SPEC Rare'], 0.0476, false, 'per_pack', 'community',
    'tcgplayer_pull_rates', src_name, src_url, 1200, verified, 'low', study || '≈1 in 21 packs.', 3);
  perform pg_temp.seed_estimate(s, 'Master Ball pattern', array['Common', 'Uncommon', 'Rare'], 0.05, false, 'per_pack',
    'community', 'tcgplayer_pull_rates', src_name, src_url, 1200, verified, 'low', study || '≈1 in 20 packs.', 4,
    null, 'Master Ball Pattern', null);
  perform pg_temp.seed_estimate(s, 'Poké Ball pattern', array['Common', 'Uncommon', 'Rare'], 0.3333, false, 'per_pack',
    'community', 'tcgplayer_pull_rates', src_name, src_url, 1200, verified, 'low', study || '≈1 in 3 packs.', 5,
    null, 'Poke Ball Pattern', null);
  perform pg_temp.seed_estimate(s, 'Reverse holo (common–rare)', array['Common', 'Uncommon', 'Rare'], null, true, 'per_pack',
    'community', 'pack_structure', 'Pack composition (community-documented)', null, null, null, 'medium',
    'Remainder of the slot.', 6, 'Reverse Holofoil', null, 'Pattern');
end;
$$;

select pg_temp.seed_surging_sparks('pokemon-surging-sparks-booster-box');
select pg_temp.seed_surging_sparks('pokemon-surging-sparks-elite-trainer-box');
select pg_temp.seed_surging_sparks('pokemon-surging-sparks-booster-bundle');
select pg_temp.seed_prismatic('pokemon-prismatic-evolutions-elite-trainer-box');
select pg_temp.seed_prismatic('pokemon-prismatic-evolutions-booster-bundle');
