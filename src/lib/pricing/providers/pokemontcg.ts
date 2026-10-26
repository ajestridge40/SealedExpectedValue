import { z } from "zod";
import { fetchJson, ProviderError } from "../http";
import type { PricingProvider, ProviderCard, ProviderPrice, SearchQuery } from "../types";

/**
 * Pokémon TCG API (https://pokemontcg.io): Pokémon card metadata and images,
 * plus a copy of TCGplayer prices per printing with an "updatedAt" date. No
 * sealed products. Works without a key at low rate limits; set
 * POKEMONTCG_API_KEY for higher limits. Used as a secondary source for cards
 * that have a pokemontcg_id but no TCGCSV link.
 */

const BASE = "https://api.pokemontcg.io/v2";

const priceBlock = z.object({
  low: z.number().nullish(),
  mid: z.number().nullish(),
  high: z.number().nullish(),
  market: z.number().nullish(),
});

const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.string().nullish(),
  rarity: z.string().nullish(),
  set: z.object({ id: z.string(), name: z.string() }),
  images: z.object({ small: z.string().nullish(), large: z.string().nullish() }).nullish(),
  tcgplayer: z
    .object({
      url: z.string().nullish(),
      updatedAt: z.string().nullish(),
      prices: z.record(z.string(), priceBlock).nullish(),
    })
    .nullish(),
});

type PtcgCard = z.infer<typeof cardSchema>;

/** pokemontcg.io price keys -> TCGplayer printing names used in our catalog. */
export const PRINTING_NAMES: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holofoil",
  "1stEditionHolofoil": "1st Edition Holofoil",
  "1stEditionNormal": "1st Edition",
  unlimitedHolofoil: "Unlimited Holofoil",
};

/** Strip anything that could change the meaning of a Lucene-style query. */
export function sanitizeQueryTerm(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}\s'.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export class PokemonTcgProvider implements PricingProvider {
  readonly id = "pokemontcg_io";
  readonly name = "Pokémon TCG API";
  readonly capabilities = { sealedProducts: false, cards: true, priceHistory: false, requiresApiKey: false };

  constructor(
    private readonly apiKey: string | undefined = process.env.POKEMONTCG_API_KEY,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get<T>(path: string): Promise<T> {
    return fetchJson<T>(`${BASE}${path}`, {
      fetchImpl: this.fetchImpl,
      headers: this.apiKey ? { "X-Api-Key": this.apiKey } : {},
      // Without a key the API allows ~30 requests/minute.
      minIntervalMs: this.apiKey ? 250 : 2100,
    });
  }

  private toCard(c: PtcgCard): ProviderCard {
    return {
      externalId: c.id,
      name: c.name,
      setExternalId: c.set.id,
      imageUrl: c.images?.large ?? c.images?.small ?? null,
      url: c.tcgplayer?.url ?? null,
      number: c.number ?? null,
      rarity: c.rarity ?? null,
      printings: Object.keys(c.tcgplayer?.prices ?? {}).map((k) => PRINTING_NAMES[k] ?? k),
    };
  }

  private toPrices(c: PtcgCard): ProviderPrice[] {
    const updated = c.tcgplayer?.updatedAt ? new Date(c.tcgplayer.updatedAt.replaceAll("/", "-") + "T00:00:00Z") : null;
    const asOf = updated && !Number.isNaN(updated.getTime()) ? updated : null;
    return Object.entries(c.tcgplayer?.prices ?? {}).map(([key, p]) => ({
      externalId: c.id,
      printing: PRINTING_NAMES[key] ?? key,
      currency: "USD",
      market: p.market ?? null,
      low: p.low ?? null,
      mid: p.mid ?? null,
      high: p.high ?? null,
      asOf,
    }));
  }

  async searchProducts() {
    return []; // no sealed products
  }
  async getProductDetails() {
    return null;
  }
  async getCurrentProductPrice() {
    return null;
  }

  async searchCards(q: SearchQuery): Promise<ProviderCard[]> {
    if (q.game !== "pokemon") return [];
    const terms: string[] = [];
    if (q.text) terms.push(`name:"${sanitizeQueryTerm(q.text)}*"`);
    if (q.setExternalId) terms.push(`set.id:${q.setExternalId.replace(/[^a-z0-9.-]/gi, "")}`);
    if (terms.length === 0) return [];
    const body = await this.get<unknown>(`/cards?pageSize=50&q=${encodeURIComponent(terms.join(" "))}`);
    const parsed = z.object({ data: z.array(cardSchema) }).safeParse(body);
    if (!parsed.success) throw new ProviderError("pokemontcg.io: unexpected response shape");
    return parsed.data.data.map((c) => this.toCard(c));
  }

  private async card(externalId: string): Promise<PtcgCard | null> {
    if (!/^[a-z0-9.-]+-[a-z0-9]+$/i.test(externalId)) return null;
    try {
      const body = await this.get<unknown>(`/cards/${encodeURIComponent(externalId)}`);
      const parsed = z.object({ data: cardSchema }).safeParse(body);
      if (!parsed.success) throw new ProviderError("pokemontcg.io: unexpected response shape");
      return parsed.data.data;
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null;
      throw err;
    }
  }

  async getCardDetails(externalId: string) {
    const c = await this.card(externalId);
    return c ? this.toCard(c) : null;
  }

  async getCurrentCardPrice(externalId: string) {
    const c = await this.card(externalId);
    return c ? this.toPrices(c) : [];
  }
}
