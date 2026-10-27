import { z } from "zod";
import { fetchJson, ProviderError } from "../http";
import type { PricingProvider, ProviderCard, ProviderPrice, ProviderProduct, ProviderSet, SearchQuery } from "../types";

/**
 * TCGTracking Open API (https://tcgtracking.com/tcgapi/): free, no API key,
 * CDN-cached TCGplayer market prices for 55+ games, covering sealed products
 * and every card printing, with product images.
 *
 *   GET /v1/{categoryId}/sets                   { sets: [...] }
 *   GET /v1/{categoryId}/sets/{setId}           { products: [...] }
 *   GET /v1/{categoryId}/sets/{setId}/pricing   { prices: { [productId]: { tcg: { [printing]: { low, market } } } } }
 *
 * TCGTracking announced that tcgtracking.com/tcgapi moves to
 * openapi.tcgtracking.com (same paths and fields). The new host is tried first
 * and the old one is used automatically if it fails. Override with
 * TCGTRACKING_BASE_URL.
 *
 * Category and set ids follow TCGplayer's (Pokémon = 3, One Piece = 68,
 * Lorcana = 71, Star Wars: Unlimited = 79, Riftbound = 89). Product ids are
 * mapped to TCGplayer product ids via tcgplayer_url when it is present.
 *
 * Results are adapted to the internal group/product/price shapes used by the
 * catalog import and price refresh. External ids: set = "categoryId:setId",
 * item = "categoryId:setId:productId".
 */

export const DEFAULT_BASES = ["https://openapi.tcgtracking.com/v1", "https://tcgtracking.com/tcgapi/v1"];

/** TCGplayer category ids for the games the app knows about. */
export const TCGPLAYER_CATEGORY: Record<string, number> = {
  mtg: 1,
  yugioh: 2,
  pokemon: 3,
  "one-piece": 68,
  lorcana: 71,
  "star-wars-unlimited": 79,
  riftbound: 89,
};

const setSchema = z
  .object({
    id: z.coerce.number().int(),
    name: z.string(),
    abbreviation: z.string().nullish(),
    // Release date: the documented field is published_on; accept common alternatives.
    published_on: z.string().nullish(),
    publishedOn: z.string().nullish(),
    release_date: z.string().nullish(),
    released_on: z.string().nullish(),
    set_symbol_url: z.string().nullish(),
    // Larger set artwork when the API provides one (field names vary).
    image_url: z.string().nullish(),
    logo_url: z.string().nullish(),
    set_logo_url: z.string().nullish(),
    set_image_url: z.string().nullish(),
  })
  .passthrough();

const categorySchema = z
  .object({
    id: z.coerce.number().int().optional(),
    category_id: z.coerce.number().int().optional(),
    categoryId: z.coerce.number().int().optional(),
    name: z.string().optional(),
    display_name: z.string().optional(),
    displayName: z.string().optional(),
  })
  .passthrough();

const productSchema = z.object({
  id: z.coerce.number().int(),
  name: z.string(),
  clean_name: z.string().nullish(),
  number: z.union([z.string(), z.number()]).nullish(),
  rarity: z.string().nullish(),
  image_url: z.string().nullish(),
  tcgplayer_url: z.string().nullish(),
});

/** A price that may arrive as a number, a numeric string, or be missing. */
function toPrice(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Date.parse(v))) return new Date(v);
  return null;
}

function shapeError(path: string, error: z.ZodError): ProviderError {
  const issue = error.issues[0];
  return new ProviderError(
    `TCGTracking ${path}: unexpected response shape (${issue?.path.join(".") || "root"}: ${issue?.message ?? "invalid"})`,
  );
}

/** Internal shapes (shared with the catalog matcher and the refresh planner). */
export interface TcgGroup {
  groupId: number;
  name: string;
  abbreviation: string | null;
  publishedOn: string | null;
  categoryId: number;
  /** Set artwork/logo when available. */
  imageUrl?: string | null;
  /** Small set symbol. */
  symbolUrl?: string | null;
}

export interface TcgCategory {
  categoryId: number;
  name: string;
}

export interface TcgProduct {
  productId: number;
  /** TCGTracking's own id (same as productId unless tcgplayer_url says otherwise). */
  sourceId: number;
  name: string;
  cleanName: string | null;
  imageUrl: string | null;
  categoryId: number;
  groupId: number;
  url: string | null;
  extendedData: { name: string; value: string | null }[];
}

export interface TcgPrice {
  productId: number;
  lowPrice: number | null;
  marketPrice: number | null;
  subTypeName: string;
}

export function parseItemId(externalId: string): { categoryId: number; groupId: number; productId: number } {
  const [c, g, p] = externalId.split(":").map(Number);
  if (![c, g, p].every((n) => Number.isInteger(n) && n > 0))
    throw new ProviderError(`Bad TCGTracking id: ${externalId}`);
  return { categoryId: c, groupId: g, productId: p };
}

function ext(product: TcgProduct, key: string): string | null {
  return product.extendedData.find((e) => e.name === key)?.value ?? null;
}

/** Singles carry a collector number or rarity; sealed products have neither. */
export function isCardProduct(p: TcgProduct): boolean {
  return Boolean(ext(p, "Number") || ext(p, "Rarity"));
}

/** "Pikachu ex - 238/191" -> "Pikachu ex" */
export function cleanCardName(name: string): string {
  return name.replace(/\s+-\s+[A-Za-z0-9]*\d+[A-Za-z0-9]*(\/[A-Za-z0-9]+)?$/, "").trim();
}

/** TCGplayer product id from a TCGplayer URL, e.g. https://www.tcgplayer.com/product/565606/... */
export function tcgplayerIdFromUrl(url: string | null | undefined): number | null {
  const m = url?.match(/tcgplayer\.com\/product\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export class TcgTrackingProvider implements PricingProvider {
  readonly id = "tcgtracking";
  readonly name = "TCGTracking (TCGplayer market prices)";
  readonly capabilities = { sealedProducts: true, cards: true, priceHistory: false, requiresApiKey: false };

  private cache = new Map<string, Promise<unknown>>();
  private bases: string[];
  /** Set once any request succeeded: later 404s mean "no such set", not "wrong host". */
  private hostConfirmed = false;
  /** When the pricing response carries a timestamp, the latest one seen. */
  private asOfBySet = new Map<string, Date | null>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    base: string | undefined = process.env.TCGTRACKING_BASE_URL,
  ) {
    this.bases = base ? [base.replace(/\/$/, "")] : [...DEFAULT_BASES];
  }

  /** GET a path, trying each base URL until one answers; remembers the one that worked. */
  private async get(path: string): Promise<unknown> {
    let p = this.cache.get(path) as Promise<unknown> | undefined;
    if (!p) {
      p = (async () => {
        let lastError: unknown;
        for (let i = 0; i < this.bases.length; i++) {
          try {
            const body = await fetchJson<unknown>(`${this.bases[i]}/${path}`, {
              fetchImpl: this.fetchImpl,
              minIntervalMs: 50,
              timeoutMs: 20_000,
            });
            if (i > 0) this.bases = [this.bases[i], ...this.bases.filter((_, j) => j !== i)];
            this.hostConfirmed = true;
            return body;
          } catch (err) {
            lastError = err;
            if (err instanceof ProviderError && err.status === 404 && this.hostConfirmed) break;
          }
        }
        throw lastError;
      })();
      this.cache.set(path, p);
      p.catch(() => this.cache.delete(path));
    }
    return p;
  }

  async groups(categoryId: number): Promise<TcgGroup[]> {
    const body = z.object({ sets: z.array(setSchema) }).safeParse(await this.get(`${categoryId}/sets`));
    if (!body.success) throw shapeError(`${categoryId}/sets`, body.error);
    return body.data.sets.map((s) => ({
      groupId: s.id,
      name: s.name,
      abbreviation: s.abbreviation || null,
      publishedOn: s.published_on || s.publishedOn || s.release_date || s.released_on || null,
      categoryId,
      imageUrl: s.image_url || s.logo_url || s.set_logo_url || s.set_image_url || null,
      symbolUrl: s.set_symbol_url || null,
    }));
  }

  /**
   * Every game (TCGplayer category) TCGTracking covers, from its categories
   * endpoint. Returns null when the endpoint is not available, so callers can
   * fall back to the games already in the database.
   */
  async categories(): Promise<TcgCategory[] | null> {
    let raw: unknown;
    try {
      raw = await this.get("categories");
    } catch {
      return null;
    }
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
        ? ((raw as Record<string, unknown>).categories ?? (raw as Record<string, unknown>).data ?? null)
        : null;
    if (!Array.isArray(list)) return null;
    const out: TcgCategory[] = [];
    for (const item of list) {
      const c = categorySchema.safeParse(item);
      if (!c.success) continue;
      const id = c.data.id ?? c.data.category_id ?? c.data.categoryId;
      const name = c.data.display_name ?? c.data.displayName ?? c.data.name;
      if (id && name) out.push({ categoryId: id, name });
    }
    return out.length ? out : null;
  }

  /** Drop cached responses for one set (keeps memory flat during full-catalog runs). */
  forgetSet(categoryId: number, groupId: number): void {
    for (const key of [...this.cache.keys()]) {
      const base = `${categoryId}/sets/${groupId}`;
      if (key === base || key.startsWith(`${base}/`)) this.cache.delete(key);
    }
    this.asOfBySet.delete(`${categoryId}:${groupId}`);
  }

  async products(categoryId: number, groupId: number): Promise<TcgProduct[]> {
    const body = z
      .object({ products: z.array(productSchema) })
      .safeParse(await this.get(`${categoryId}/sets/${groupId}`));
    if (!body.success) throw shapeError(`${categoryId}/sets/${groupId}`, body.error);
    return body.data.products.map((p) => ({
      productId: tcgplayerIdFromUrl(p.tcgplayer_url) ?? p.id,
      sourceId: p.id,
      name: p.name,
      cleanName: p.clean_name || null,
      imageUrl: p.image_url || null,
      categoryId,
      groupId,
      url: p.tcgplayer_url || null,
      extendedData: [
        {
          name: "Number",
          value: p.number === null || p.number === undefined || p.number === "" ? null : String(p.number),
        },
        { name: "Rarity", value: p.rarity || null },
      ],
    }));
  }

  /** One row per product x printing ("subtype") with a price. */
  async prices(categoryId: number, groupId: number): Promise<TcgPrice[]> {
    const [raw, products] = await Promise.all([
      this.get(`${categoryId}/sets/${groupId}/pricing`),
      this.products(categoryId, groupId),
    ]);
    // Parsed entry by entry: one odd entry (a missing or non-numeric price, a
    // printing without data) must not throw away a whole set's prices.
    const body = (raw ?? {}) as Record<string, unknown>;
    const prices = body.prices;
    if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
      throw new ProviderError(
        `TCGTracking ${categoryId}/sets/${groupId}/pricing: unexpected response shape (no "prices" object; keys: ${Object.keys(body).slice(0, 8).join(", ") || "none"})`,
      );
    }
    const asOf = toDate(body.updated ?? body.updated_at ?? body.last_updated ?? null);
    this.asOfBySet.set(`${categoryId}:${groupId}`, asOf);

    // Pricing is keyed by TCGTracking's product id; map to the TCGplayer id used everywhere else.
    const idMap = new Map(products.map((p) => [p.sourceId, p.productId]));
    const rows: TcgPrice[] = [];
    for (const [key, entry] of Object.entries(prices as Record<string, unknown>)) {
      const sourceId = Number(key);
      if (!Number.isInteger(sourceId) || !entry || typeof entry !== "object") continue;
      const tcg = (entry as Record<string, unknown>).tcg;
      if (!tcg || typeof tcg !== "object" || Array.isArray(tcg)) continue;
      for (const [subtype, v] of Object.entries(tcg as Record<string, unknown>)) {
        if (!v || typeof v !== "object") continue;
        const values = v as Record<string, unknown>;
        const market = toPrice(values.market ?? values.market_price);
        const low = toPrice(values.low ?? values.low_price);
        // Kept even without prices: the printing exists and is shown as unpriced.
        rows.push({
          productId: idMap.get(sourceId) ?? sourceId,
          lowPrice: low,
          marketPrice: market,
          subTypeName: subtype || "Normal",
        });
      }
    }
    return rows;
  }

  async listSets(game: string): Promise<ProviderSet[]> {
    const cat = TCGPLAYER_CATEGORY[game];
    if (!cat) return [];
    return (await this.groups(cat)).map((g) => ({
      externalId: `${cat}:${g.groupId}`,
      name: g.name,
      abbreviation: g.abbreviation,
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
      imageUrl: p.imageUrl,
      url: p.url,
    };
  }

  private async toCard(p: TcgProduct): Promise<ProviderCard> {
    const printings = (await this.prices(p.categoryId, p.groupId))
      .filter((x) => x.productId === p.productId)
      .map((x) => x.subTypeName);
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

  /** No search endpoint; this filters one set's product list. */
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
    return (await this.setPrices(categoryId, groupId)).filter((r) => r.externalId.endsWith(`:${productId}`));
  }

  async getCurrentProductPrice(externalId: string): Promise<ProviderPrice | null> {
    const rows = await this.pricesFor(externalId);
    return rows.find((r) => r.market !== null) ?? rows[0] ?? null;
  }

  getCurrentCardPrice(externalId: string): Promise<ProviderPrice[]> {
    return this.pricesFor(externalId);
  }

  /**
   * Every price row in one set, normalized. Two requests per set (product list
   * + pricing), shared with the catalog import through the per-instance cache.
   * When the API gives no timestamp, asOf is null and the snapshot's capture
   * time is used instead.
   */
  async setPrices(categoryId: number, groupId: number): Promise<ProviderPrice[]> {
    const rows = await this.prices(categoryId, groupId);
    const asOf = this.asOfBySet.get(`${categoryId}:${groupId}`) ?? null;
    return rows.map((r) => normalizePrice(r, categoryId, groupId, asOf));
  }
}

export function normalizePrice(r: TcgPrice, categoryId: number, groupId: number, asOf: Date | null): ProviderPrice {
  const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    externalId: `${categoryId}:${groupId}:${r.productId}`,
    printing: r.subTypeName || "Normal",
    currency: "USD",
    market: num(r.marketPrice),
    low: num(r.lowPrice),
    mid: null,
    high: null,
    asOf,
  };
}
