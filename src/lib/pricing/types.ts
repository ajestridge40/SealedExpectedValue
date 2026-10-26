/*
 * Provider-independent pricing interface. Every provider normalizes its
 * responses into these shapes; nothing outside src/lib/pricing/providers knows
 * a provider's wire format.
 */

export interface ProviderPrice {
  /** Provider's id for the priced item (+ printing for cards). */
  externalId: string;
  printing?: string | null;
  currency: string;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  /** When the provider computed the price; null if it does not say. */
  asOf: Date | null;
}

export interface ProviderProduct {
  externalId: string;
  name: string;
  setExternalId: string | null;
  imageUrl: string | null;
  url: string | null;
}

export interface ProviderCard extends ProviderProduct {
  number: string | null;
  rarity: string | null;
  /** Printings the provider prices separately (Normal, Holofoil, Reverse Holofoil...). */
  printings: string[];
}

export interface ProviderSet {
  externalId: string;
  name: string;
  abbreviation: string | null;
  releaseDate: string | null;
}

export interface SearchQuery {
  /** Internal game slug, e.g. "pokemon". */
  game: string;
  setExternalId?: string;
  text?: string;
}

export interface ProviderCapabilities {
  sealedProducts: boolean;
  cards: boolean;
  priceHistory: boolean;
  requiresApiKey: boolean;
}

export interface PricingProvider {
  /** Matches data_sources.slug. */
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  searchProducts(q: SearchQuery): Promise<ProviderProduct[]>;
  getProductDetails(externalId: string): Promise<ProviderProduct | null>;
  getCurrentProductPrice(externalId: string): Promise<ProviderPrice | null>;
  searchCards(q: SearchQuery): Promise<ProviderCard[]>;
  getCardDetails(externalId: string): Promise<ProviderCard | null>;
  /** All printings' prices for one card. */
  getCurrentCardPrice(externalId: string): Promise<ProviderPrice[]>;
  /** Only where the provider offers history; otherwise history comes from our own snapshots. */
  getPriceHistory?(externalId: string, from: Date, to: Date): Promise<ProviderPrice[]>;
}

/** Image hosts we will display. Anything else falls back to a placeholder. */
export const ALLOWED_IMAGE_HOSTS = [
  "tcgplayer-cdn.tcgplayer.com",
  "product-images.tcgplayer.com",
  "images.pokemontcg.io",
];

export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_IMAGE_HOSTS.includes(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}
