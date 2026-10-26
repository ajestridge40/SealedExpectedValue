-- Pricing provider: TCGTracking Open API (free, no key). Register it as a
-- data source and add the games it covers that the app now supports.

insert into public.data_sources (slug, name, kind, website_url, attribution, notes) values
  ('tcgtracking', 'TCGTracking (TCGplayer market prices)', 'pricing_provider', 'https://tcgtracking.com/tcgapi/',
   'Prices: TCGplayer market prices via the TCGTracking Open API.',
   'Free open API, no key, CDN-cached. Sealed products and every card printing, with images.')
on conflict (slug) do update set
  name = excluded.name, kind = excluded.kind, website_url = excluded.website_url,
  attribution = excluded.attribution, notes = excluded.notes;

insert into public.games (slug, name, tcgplayer_category_id) values
  ('one-piece', 'One Piece Card Game', 68),
  ('lorcana', 'Disney Lorcana', 71),
  ('star-wars-unlimited', 'Star Wars: Unlimited', 79),
  ('riftbound', 'Riftbound', 89)
on conflict (slug) do nothing;
