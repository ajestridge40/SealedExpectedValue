import { z } from "zod";
import { fetchJson, fetchText, ProviderError } from "../http";
import type {
  PricingProvider,
  ProviderCard,
  ProviderPrice,
  ProviderProduct,
  ProviderSet,
  SearchQuery,
} from "../types";

/**
 * TCGCSV (https://tcgcsv.com): a free, community-run daily mirror of
 * TCGplayer's catalog and market prices, covering sealed products and single
 * cards for every TCGplayer category. No API key. Updated once a day around
 * 20:00 UTC. Prices are TCGplayer "market" prices in USD.
 *
 *   /tcgplayer/{categoryId}/groups                  sets ("groups")
 *   /tcgplayer/{categoryId}/{groupId}/products      sealed products + cards
 *   /tcgplayer/{categoryId}/{groupId}/prices        one row per product x printing
 *   /last-updated.txt                               timestamp of the last update
 *
 * External ids: set = "categoryId:groupId", item = "categoryId:groupId:productId".
 */

const BASE = "https://tcgcsv.com";

/** TCGplayer category ids for the games we know about. */
export const TCGPLAYER_CATEGORY: Record<string, number> = { mtg: 1, yugioh: 2, pokemon: 3 };

const envelope = <T extends z.ZodType>(item: T) =>
  z.object({ success: z.boolean().optional(), errors: z.array(z.string()).optional(), results: z.array(item) });

const groupSchema = z.object({
  groupId: z.number().int(),
  name: z.string(),
  abbreviation: z.string().nullish(),
  publishedOn: z.string().nullish(),
  categoryId: z.number().int(),
});

const productSchema = z.object({
  productId: z.number().int(),
  name: z.string(),
  cleanName: z.string().nullish(),
  imageUrl: z.string().nullish(),
  categoryId: z.number().int(),
  groupId: z.number().int(),
  url: z.string().nullish(),
  extendedData: z.array(z.object({ name: z.string(), value: z.string().nullish() })).nullish(),
});

const priceSchema = z.object({
  productId: z.number().int(),
  lowPrice: z.number().nullish(),
  midPrice: z.number().nullish(),
  highPrice: z.number().nullish(),
  marketPrice: z.number().nullish(),
  subTypeName: z.string().nullish(),
});

export type TcgGroup = z.infer<typeof groupSchema>;
export type TcgProduct = z.infer<typeof productSchema>;
export type TcgPrice = z.infer<typeof priceSchema>;

export function parseItemId(externalId: string): { categoryId: number; groupId: number; productId: number } {
  const [c, g, p] = externalId.split(":").map(Number);
  if (![c, g, p].every((n) => Number.isInteger(n) && n > 0)) throw new ProviderError(`Bad TCGCSV id: ${externalId}`);
  return { categoryId: c, groupId: g, productId: p };
}

function ext(product: TcgProduct, key: string): string | null {
  return product.extendedData?.find((e) => e.name.toLowerCase() === key.toLowerCase())?.value ?? null;
}

/** Singles carry a collector number; sealed products do not. */
export function isCardProduct(p: TcgProduct): boolean {
  return ext(p, "Number") !== null;
}

/** "Pikachu ex - 238/191" -> "Pikachu ex" */
export function cleanCardName(name: string): string {
  return name.replace(/\s+-\s+[A-Za-z0-9]*\d+[A-Za-z0-9]*(\/[A-Za-z0-9]+)?$/, "").trim();
}

export class TcgcsvProvider implements PricingProvider {
  readonly id = "tcgcsv";
  readonly name = "TCGCSV (TCGplayer market prices)";
  readonly capabilities = { sealedProducts: true, cards: true, priceHistory: false, requiresApiKey: false };

  private cache = new Map<string, Promise<unknown>>();
  private asOfPromise: Promise<Date | null> | null = null;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key));
    }
    return p;
  }

  private async list<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>[]> {
    return this.memo(path, async () => {
      const body = await fetchJson<unknown>(`${BASE}/tcgplayer/${path}`, { fetchImpl: this.fetchImpl, minIntervalMs: 150 });
      const parsed = envelope(schema).safeParse(body);
      if (!parsed.success) throw new ProviderError(`TCGCSV ${path}: unexpected response shape`);
      if (parsed.data.success === false) throw new ProviderError(`TCGCSV ${path}: ${parsed.data.errors?.join("; ")}`);
      return parsed.data.results;
    });
  }

  /** Timestamp of TCGCSV's last update; prices are as of this time. */
  lastUpdated(): Promise<Date | null> {
    this.asOfPromise ??= fetchText(`${BASE}/last-updated.txt`, { fetchImpl: this.fetchImpl })
      .then((t) => {
        const d = new Date(t.trim());
        return Number.isNaN(d.getTime()) ? null : d;
      })
      .catch(() => null);
    return this.asOfPromise;
  }

  groups(categoryId: number) {
    return this.list(`${categoryId}/groups`, groupSchema);
  }
  products(categoryId: number, groupId: number) {
    return this.list(`${categoryId}/${groupId}/products`, productSchema);
  }
  prices(categoryId: number, groupId: number) {
    return this.list(`${categoryId}/${groupId}/prices`, priceSchema);
  }

  async listSets(game: string): Promise<ProviderSet[]> {
    const cat = TCGPLAYER_CATEGORY[game];
    if (!cat) return [];
    return (await this.groups(cat)).map((g) => ({
      externalId: `${cat}:${g.groupId}`,
      name: g.name,
      abbreviation: g.abbreviation ?? null,
      releaseDate: g.publishedOn ? g.publishedOn.slice(0, 10) : null,
    }));
  }

  private async groupProducts(setExternalId: string): Promise<TcgProduct[]> {
    const [c, g] = setExternalId.split(":").map(Number);
    return this.products(c, g);
  }

  private toProduct(p: TcgProduct): ProviderProduct {
    return {
      externalId: `${p.categoryId}:${p.groupId}:${p.productId}`,
      name: p.name,
      setExternalId: `${p.categoryId}:${p.groupId}`,
      imageUrl: p.imageUrl ?? null,
      url: p.url ?? null,
    };
  }

  private async toCard(p: TcgProduct): Promise<ProviderCard> {
    const printings = (await this.prices(p.categoryId, p.groupId))
      .filter((x) => x.productId === p.productId)
      .map((x) => x.subTypeName ?? "Normal");
    return {
      ...this.toProduct(p),
      name: cleanCardName(p.name),
      number: ext(p, "Number"),
      rarity: ext(p, "Rarity"),
      printings: printings.length ? [...new Set(printings)] : ["Normal"],
    };
  }

  private matchesText(p: TcgProduct, text?: string) {
    return !text || p.name.toLowerCase().includes(text.toLowerCase());
  }

  /** TCGCSV has no search endpoint; this filters one set's product list. */
  async searchProducts(q: SearchQuery): Promise<ProviderProduct[]> {
    if (!q.setExternalId) return [];
    return (await this.groupProducts(q.setExternalId))
      .filter((p) => !isCardProduct(p) && this.matchesText(p, q.text))
      .map((p) => this.toProduct(p));
  }

  async searchCards(q: SearchQuery): Promise<ProviderCard[]> {
    if (!q.setExternalId) return [];
    const products = (await this.groupProducts(q.setExternalId)).filter(
      (p) => isCardProduct(p) && this.matchesText(p, q.text),
    );
    return Promise.all(products.map((p) => this.toCard(p)));
  }

  private async findProduct(externalId: string): Promise<TcgProduct | null> {
    const { categoryId, groupId, productId } = parseItemId(externalId);
    return (await this.products(categoryId, groupId)).find((p) => p.productId === productId) ?? null;
  }

  async getProductDetails(externalId: string) {
    const p = await this.findProduct(externalId);
    return p ? this.toProduct(p) : null;
  }

  async getCardDetails(externalId: string) {
    const p = await this.findProduct(externalId);
    return p ? this.toCard(p) : null;
  }

  private async pricesFor(externalId: string): Promise<ProviderPrice[]> {
    const { categoryId, groupId, productId } = parseItemId(externalId);
    const [rows, asOf] = await Promise.all([this.prices(categoryId, groupId), this.lastUpdated()]);
    return rows.filter((r) => r.productId === productId).map((r) => normalizePrice(r, categoryId, groupId, asOf));
  }

  async getCurrentProductPrice(externalId: string): Promise<ProviderPrice | null> {
    const rows = await this.pricesFor(externalId);
    // Sealed products normally have a single "Normal" row.
    return rows.find((r) => r.market !== null) ?? rows[0] ?? null;
  }

  getCurrentCardPrice(externalId: string): Promise<ProviderPrice[]> {
    return this.pricesFor(externalId);
  }

  /** Every price row in one set, normalized. One request per set. */
  async setPrices(categoryId: number, groupId: number): Promise<ProviderPrice[]> {
    const [rows, asOf] = await Promise.all([this.prices(categoryId, groupId), this.lastUpdated()]);
    return rows.map((r) => normalizePrice(r, categoryId, groupId, asOf));
  }
}

export function normalizePrice(r: TcgPrice, categoryId: number, groupId: number, asOf: Date | null): ProviderPrice {
  const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    externalId: `${categoryId}:${groupId}:${r.productId}`,
    printing: r.subTypeName ?? "Normal",
    currency: "USD",
    market: num(r.marketPrice),
    low: num(r.lowPrice),
    mid: num(r.midPrice),
    high: num(r.highPrice),
    asOf,
  };
}
