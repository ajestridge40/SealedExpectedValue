import { z } from "zod";
import { fetchJson, ProviderError } from "../http";
import type { PricingProvider, ProviderCard, ProviderPrice, ProviderProduct, ProviderSet, SearchQuery } from "../types";

/**
 * TCG API (https://tcgapi.dev): TCGplayer market prices, catalog and images for
 * 89+ games, covering single cards and sealed products. Requires an API key
 * (TCGAPI_KEY, sent as X-API-Key). Plans are metered per day (free: 100
 * requests/day, reset at UTC midnight); prices refresh daily for major games.
 *
 *   GET /games/{slug|tcgplayerCategoryId}/sets         sets of a game
 *   GET /sets/{id}/cards?type=Cards|Sealed Products    primary-printing prices, paged (max 200)
 *   GET /sets/{id}/prices                              every printing of every product (Starter+)
 *   GET /search?q=…                                    fuzzy search
 *   GET /cards/{id}, /cards/{id}/prices, /cards/{id}/history
 *
 * Every response is { data, meta?, rate_limit? }. External ids used here are
 * tcgapi's own numeric ids; rows also carry the TCGplayer product id.
 */

const BASE = "https://api.tcgapi.dev/v1";
const MAX_PAGE = 200;

const num = z.number().nullish();

const setSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  tcgplayer_id: z.number().int().nullish(),
  abbreviation: z.string().nullish(),
  release_date: z.string().nullish(),
});

const cardWithPriceSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  clean_name: z.string().nullish(),
  number: z.string().nullish(),
  rarity: z.string().nullish(),
  tcgplayer_id: z.number().int().nullish(),
  product_type: z.string().nullish(),
  printing: z.string().nullish(),
  market_price: num,
  low_price: num,
  median_price: num,
  price_updated_at: z.string().nullish(),
  image_url: z.string().nullish(),
});

const priceRowSchema = z.object({
  card_id: z.number().int(),
  name: z.string().nullish(),
  tcgplayer_id: z.number().int().nullish(),
  product_type: z.string().nullish(),
  printing: z.string().nullish(),
  market_price: num,
  low_price: num,
  median_price: num,
  last_updated_at: z.string().nullish(),
  image_url: z.string().nullish(),
});

const cardSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  number: z.string().nullish(),
  rarity: z.string().nullish(),
  image_url: z.string().nullish(),
  tcgplayer_id: z.number().int().nullish(),
  tcgplayer_url: z.string().nullish(),
  product_type: z.string().nullish(),
  set_id: z.number().int().nullish(),
});

const historySchema = z.object({
  date: z.string(),
  printing: z.string().nullish(),
  market_price: num,
  low_price: num,
});

const metaSchema = z.object({ total: z.number().optional(), has_more: z.boolean().optional() }).passthrough();
const rateLimitSchema = z.object({ daily_limit: z.number(), daily_remaining: z.number(), daily_reset: z.string() });

export type TcgApiSet = z.infer<typeof setSchema>;
export type TcgApiCard = z.infer<typeof cardWithPriceSchema>;
export type TcgApiPriceRow = z.infer<typeof priceRowSchema>;
export type RateLimit = z.infer<typeof rateLimitSchema>;

/** "Pikachu ex - 238/191" -> "Pikachu ex" */
export function cleanCardName(name: string): string {
  return name.replace(/\s+-\s+[A-Za-z0-9]*\d+[A-Za-z0-9]*(\/[A-Za-z0-9]+)?$/, "").trim();
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class TcgApiProvider implements PricingProvider {
  readonly id = "tcgapi";
  readonly name = "TCG API (TCGplayer market prices)";
  readonly capabilities = { sealedProducts: true, cards: true, priceHistory: true, requiresApiKey: true };

  /** Latest rate-limit budget reported by the API. */
  rateLimit: RateLimit | null = null;
  /** False once /sets/{id}/prices answered 403 (plan below Starter). */
  setPricesAvailable = true;

  private cache = new Map<string, Promise<unknown>>();

  constructor(
    private readonly apiKey: string | undefined = process.env.TCGAPI_KEY,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  private async request(path: string, query: Record<string, string | number | undefined> = {}) {
    if (!this.apiKey) throw new ProviderError("TCGAPI_KEY is not set. Get a key at https://tcgapi.dev/dashboard.");
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const key = url.toString();
    let p = this.cache.get(key) as Promise<{ data: unknown; meta?: z.infer<typeof metaSchema> }> | undefined;
    if (!p) {
      p = (async () => {
        let body: unknown;
        try {
          body = await fetchJson<unknown>(key, {
            fetchImpl: this.fetchImpl,
            headers: { "X-API-Key": this.apiKey! },
            minIntervalMs: 250,
            timeoutMs: 30_000,
          });
        } catch (err) {
          if (err instanceof ProviderError) {
            if (err.status === 401)
              throw new ProviderError("TCG API rejected the API key (401). Check TCGAPI_KEY.", 401);
            if (err.status === 429)
              throw new ProviderError("TCG API daily request limit reached (429). It resets at UTC midnight.", 429);
          }
          throw err;
        }
        const parsed = z
          .object({ data: z.unknown(), meta: metaSchema.optional(), rate_limit: rateLimitSchema.optional() })
          .safeParse(body);
        if (!parsed.success) throw new ProviderError(`TCG API ${path}: unexpected response shape`);
        if (parsed.data.rate_limit) this.rateLimit = parsed.data.rate_limit;
        return { data: parsed.data.data, meta: parsed.data.meta };
      })();
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key));
    }
    return p;
  }

  private async list<T extends z.ZodType>(
    path: string,
    schema: T,
    query: Record<string, string | number | undefined> = {},
    maxPages = 20,
  ): Promise<z.infer<T>[]> {
    const out: z.infer<T>[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const { data, meta } = await this.request(path, { ...query, page, per_page: MAX_PAGE });
      const rows = z.array(schema).safeParse(data);
      if (!rows.success) throw new ProviderError(`TCG API ${path}: unexpected response shape`);
      out.push(...rows.data);
      if (!meta?.has_more || rows.data.length === 0) break;
    }
    return out;
  }

  /** Sets of a game, addressed by TCGplayer category id (e.g. 3 = Pokémon). */
  gameSets(categoryId: number) {
    return this.list(`/games/${categoryId}/sets`, setSchema);
  }

  /** Cards or sealed products in a set, each with its primary printing's price. */
  setCards(setId: number, type: "Cards" | "Sealed Products") {
    return this.list(`/sets/${setId}/cards`, cardWithPriceSchema, { type });
  }

  /** Every printing of every product in a set (Starter plan and up). Null when the plan does not allow it. */
  async setPriceRows(setId: number): Promise<TcgApiPriceRow[] | null> {
    if (!this.setPricesAvailable) return null;
    try {
      const { data } = await this.request(`/sets/${setId}/prices`);
      const rows = z.array(priceRowSchema).safeParse(data);
      if (!rows.success) throw new ProviderError(`TCG API /sets/${setId}/prices: unexpected response shape`);
      return rows.data;
    } catch (err) {
      if (err instanceof ProviderError && err.status === 403) {
        this.setPricesAvailable = false;
        return null;
      }
      throw err;
    }
  }

  /**
   * All prices in a set, normalized. Uses /sets/{id}/prices (every printing)
   * when the plan allows it, otherwise the primary printing of each card and
   * sealed product from /sets/{id}/cards.
   */
  async setPrices(setId: number): Promise<{ prices: ProviderPrice[]; allPrintings: boolean }> {
    const rows = await this.setPriceRows(setId);
    if (rows) {
      return {
        allPrintings: true,
        prices: rows
          .filter((r) => r.tcgplayer_id)
          .map((r) =>
            normalize(r.tcgplayer_id!, r.printing, r.market_price, r.low_price, r.median_price, r.last_updated_at),
          ),
      };
    }
    const [cards, sealed] = await Promise.all([this.setCards(setId, "Cards"), this.setCards(setId, "Sealed Products")]);
    return {
      allPrintings: false,
      prices: [...cards, ...sealed]
        .filter((r) => r.tcgplayer_id)
        .map((r) =>
          normalize(r.tcgplayer_id!, r.printing, r.market_price, r.low_price, r.median_price, r.price_updated_at),
        ),
    };
  }

  // --- PricingProvider -----------------------------------------------------

  async listSets(categoryId: number): Promise<ProviderSet[]> {
    return (await this.gameSets(categoryId)).map((s) => ({
      externalId: String(s.id),
      name: s.name,
      abbreviation: s.abbreviation ?? null,
      releaseDate: s.release_date?.slice(0, 10) ?? null,
    }));
  }

  private async search(q: SearchQuery, type: "Cards" | "Sealed Products") {
    if (!q.text) return [];
    const { data } = await this.request("/search", {
      q: q.text.slice(0, 100),
      game: q.game === "mtg" ? "magic" : q.game,
      set_id: q.setExternalId ? Number(q.setExternalId) : undefined,
      type,
      per_page: 50,
    });
    const rows = z.array(cardWithPriceSchema).safeParse(data);
    if (!rows.success) throw new ProviderError("TCG API /search: unexpected response shape");
    return rows.data;
  }

  async searchProducts(q: SearchQuery): Promise<ProviderProduct[]> {
    return (await this.search(q, "Sealed Products")).map((r) => ({
      externalId: String(r.id),
      name: r.name,
      setExternalId: q.setExternalId ?? null,
      imageUrl: r.image_url ?? null,
      url: null,
    }));
  }

  async searchCards(q: SearchQuery): Promise<ProviderCard[]> {
    return (await this.search(q, "Cards")).map((r) => ({
      externalId: String(r.id),
      name: cleanCardName(r.name),
      setExternalId: q.setExternalId ?? null,
      imageUrl: r.image_url ?? null,
      url: null,
      number: r.number ?? null,
      rarity: r.rarity ?? null,
      printings: r.printing ? [r.printing] : [],
    }));
  }

  private async card(externalId: string) {
    if (!/^\d{1,12}$/.test(externalId)) return null;
    try {
      const { data } = await this.request(`/cards/${externalId}`);
      const c = cardSchema.safeParse(data);
      if (!c.success) throw new ProviderError("TCG API /cards: unexpected response shape");
      return c.data;
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null;
      throw err;
    }
  }

  async getProductDetails(externalId: string): Promise<ProviderProduct | null> {
    const c = await this.card(externalId);
    return c
      ? {
          externalId: String(c.id),
          name: c.name,
          setExternalId: c.set_id ? String(c.set_id) : null,
          imageUrl: c.image_url ?? null,
          url: c.tcgplayer_url ?? null,
        }
      : null;
  }

  async getCardDetails(externalId: string): Promise<ProviderCard | null> {
    const c = await this.card(externalId);
    if (!c) return null;
    const prices = await this.getCurrentCardPrice(externalId);
    return {
      externalId: String(c.id),
      name: cleanCardName(c.name),
      setExternalId: c.set_id ? String(c.set_id) : null,
      imageUrl: c.image_url ?? null,
      url: c.tcgplayer_url ?? null,
      number: c.number ?? null,
      rarity: c.rarity ?? null,
      printings: prices.map((p) => p.printing ?? "Normal"),
    };
  }

  async getCurrentCardPrice(externalId: string): Promise<ProviderPrice[]> {
    if (!/^\d{1,12}$/.test(externalId)) return [];
    const { data } = await this.request(`/cards/${externalId}/prices`);
    const rows = z.array(priceRowSchema).safeParse(data);
    if (!rows.success) throw new ProviderError("TCG API /cards/prices: unexpected response shape");
    return rows.data.map((r) =>
      normalize(
        r.tcgplayer_id ?? Number(externalId),
        r.printing,
        r.market_price,
        r.low_price,
        r.median_price,
        r.last_updated_at,
      ),
    );
  }

  async getCurrentProductPrice(externalId: string): Promise<ProviderPrice | null> {
    const rows = await this.getCurrentCardPrice(externalId);
    return rows.find((r) => r.market !== null) ?? rows[0] ?? null;
  }

  /** Tier-windowed history (free: 7 days). */
  async getPriceHistory(externalId: string): Promise<ProviderPrice[]> {
    if (!/^\d{1,12}$/.test(externalId)) return [];
    const { data } = await this.request(`/cards/${externalId}/history`, { range: "all" });
    const rows = z.array(historySchema).safeParse(data);
    if (!rows.success) throw new ProviderError("TCG API /cards/history: unexpected response shape");
    return rows.data.map((r) => normalize(Number(externalId), r.printing, r.market_price, r.low_price, null, r.date));
  }
}

function normalize(
  tcgplayerId: number,
  printing: string | null | undefined,
  market: number | null | undefined,
  low: number | null | undefined,
  mid: number | null | undefined,
  asOf: string | null | undefined,
): ProviderPrice {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    externalId: String(tcgplayerId),
    printing: printing ?? "Normal",
    currency: "USD",
    market: n(market),
    low: n(low),
    mid: n(mid),
    high: null,
    asOf: toDate(asOf),
  };
}
