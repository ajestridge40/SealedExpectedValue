import type { CardRow } from "../ev/model";

export type ProductType =
  | "booster_box"
  | "elite_trainer_box"
  | "booster_bundle"
  | "collection_box"
  | "booster_pack"
  | "blister"
  | "tin"
  | "other";

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  booster_box: "Booster box",
  elite_trainer_box: "Elite Trainer Box",
  booster_bundle: "Booster bundle",
  collection_box: "Collection box",
  booster_pack: "Booster pack",
  blister: "Blister",
  tin: "Tin",
  other: "Other",
};

export type PriceKind = "provider" | "csv_import" | "manual";

export interface Game {
  id: string;
  slug: string;
  name: string;
}

export interface SetRow {
  id: string;
  game_id: string;
  name: string;
  code: string | null;
  release_date: string | null;
  tcgplayer_group_id: number | null;
}

export interface DataSource {
  id: string;
  slug: string;
  name: string;
  kind: string;
  website_url: string | null;
  attribution: string | null;
}

export interface ProductRow {
  id: string;
  game_id: string;
  set_id: string | null;
  name: string;
  slug: string;
  product_type: ProductType;
  release_date: string | null;
  image_url: string | null;
  description: string | null;
  pack_count: number | null;
  pack_configuration: string | null;
  tcgplayer_product_id: number | null;
  msrp: number | null;
  current_price: number | null;
  current_price_currency: string | null;
  current_price_source_id: string | null;
  current_price_kind: PriceKind | null;
  price_updated_at: string | null;
  is_sample: boolean;
}

export const PRODUCT_COLUMNS =
  "id, game_id, set_id, name, slug, product_type, release_date, image_url, description, pack_count, pack_configuration, tcgplayer_product_id, msrp, current_price, current_price_currency, current_price_source_id, current_price_kind, price_updated_at, is_sample";

export interface CardCatalogRow extends CardRow {
  game_id: string;
  current_price_source_id: string | null;
  pokemontcg_id: string | null;
}

export const CARD_COLUMNS =
  "id, game_id, set_id, name, number, rarity, printing, image_url, tcgplayer_product_id, pokemontcg_id, current_price, current_price_currency, current_price_source_id, current_price_kind, price_updated_at";

export interface SnapshotPoint {
  captured_at: string;
  provider_as_of: string | null;
  market_price: number | null;
  currency: string;
  source_kind: PriceKind;
  source_id: string;
}
