import { describe, expect, it, vi } from "vitest";
import {
  cardRowsFromGroup,
  matchGroup,
  matchSealedProduct,
  mostValuableCardIds,
  normalizeName,
} from "../catalog/match";
import { escapeCsvCell, toCsv } from "../csv";
import { parsePriceCsv } from "./csv-import";
import { fetchJson } from "./http";
import { planSnapshots } from "./plan";
import { PokemonTcgProvider, sanitizeQueryTerm } from "./providers/pokemontcg";
import {
  TcgTrackingProvider,
  cleanCardName,
  tcgplayerIdFromUrl,
  type TcgGroup,
  type TcgPrice,
  type TcgProduct,
} from "./providers/tcgtracking";
import { safeImageUrl } from "./types";
import { newestFirst } from "../catalog/sync";

// Mocked TCGTracking responses (shapes as returned by /v1/{cat}/sets, /sets/{id}
// and /sets/{id}/pricing). Ids and prices are test fixtures, not market data.
const TT_SETS = {
  sets: [
    { id: 9001, name: "SV08: Test Sparks", abbreviation: "SV08", published_on: "2024-11-08", set_symbol_url: null },
    { id: 9002, name: "SV08: Test Sparks Promos", abbreviation: "", published_on: "", set_symbol_url: null },
  ],
};
const TT_PRODUCTS = {
  products: [
    {
      id: 1,
      name: "Test Sparks Booster Box",
      clean_name: "Test Sparks Booster Box",
      number: "",
      rarity: "",
      image_url: "https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg",
      tcgplayer_url: "https://www.tcgplayer.com/product/1/test-sparks-booster-box",
    },
    { id: 2, name: "Test Sparks Booster Box Case", number: null, rarity: null, image_url: null, tcgplayer_url: null },
    {
      id: 3,
      name: "Testachu ex - 238/191",
      number: "238/191",
      rarity: "Special Illustration Rare",
      image_url: "http://insecure.example.com/x.jpg",
      tcgplayer_url: "https://www.tcgplayer.com/product/3",
    },
  ],
};
const TT_PRICING = {
  prices: {
    "1": { tcg: { Normal: { low: 1, market: 2.5 } } },
    "3": { tcg: { Holofoil: { low: 1, market: 9.99 }, "Reverse Holofoil": { low: null, market: null } } },
  },
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    const body = routes[key];
    return typeof body === "string" ? new Response(body) : Response.json(body);
  }) as unknown as typeof fetch;
}

const ttRoutes = {
  "openapi.tcgtracking.com/v1/3/sets": TT_SETS,
  "openapi.tcgtracking.com/v1/3/sets/9001": TT_PRODUCTS,
  "openapi.tcgtracking.com/v1/3/sets/9001/pricing": TT_PRICING,
};

// Internal shapes for the matcher tests, produced by the provider itself.
let GROUPS: TcgGroup[] = [];
let PRODUCTS: TcgProduct[] = [];
let PRICES: TcgPrice[] = [];

describe("TcgTrackingProvider", () => {
  it("normalizes sets, products, cards and prices from mocked responses", async () => {
    const fetchImpl = mockFetch(ttRoutes);
    const p = new TcgTrackingProvider(fetchImpl, undefined);
    const sets = await p.listSets("pokemon");
    expect(sets[0]).toMatchObject({ externalId: "3:9001", name: "SV08: Test Sparks", releaseDate: "2024-11-08" });
    expect(sets[1].abbreviation).toBeNull();

    const sealed = await p.searchProducts({ game: "pokemon", setExternalId: "3:9001" });
    expect(sealed.map((s) => s.externalId)).toEqual(["3:9001:1", "3:9001:2"]);

    const cards = await p.searchCards({ game: "pokemon", setExternalId: "3:9001", text: "testachu" });
    expect(cards[0]).toMatchObject({
      name: "Testachu ex",
      number: "238/191",
      rarity: "Special Illustration Rare",
      printings: ["Holofoil", "Reverse Holofoil"],
    });

    const price = await p.getCurrentProductPrice("3:9001:1");
    expect(price).toMatchObject({ market: 2.5, low: 1, currency: "USD", asOf: null });

    const cardPrices = await p.getCurrentCardPrice("3:9001:3");
    expect(cardPrices.map((x) => [x.printing, x.market])).toEqual([
      ["Holofoil", 9.99],
      ["Reverse Holofoil", null],
    ]);
    // Responses are cached per provider instance.
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.endsWith("/sets/9001")).length).toBe(1);

    GROUPS = await p.groups(3);
    PRODUCTS = await p.products(3, 9001);
    PRICES = await p.prices(3, 9001);
  });

  it("falls back to the old tcgtracking.com/tcgapi host when the new one fails", async () => {
    const f = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://openapi.tcgtracking.com")) return new Response("gone", { status: 503 });
      if (url === "https://tcgtracking.com/tcgapi/v1/3/sets") return Response.json(TT_SETS);
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    const p = new TcgTrackingProvider(f, undefined);
    expect((await p.groups(3)).map((g) => g.groupId)).toEqual([9001, 9002]);
  }, 15_000);

  it("maps TCGTracking ids to TCGplayer ids from tcgplayer_url", async () => {
    expect(tcgplayerIdFromUrl("https://www.tcgplayer.com/product/565606/pokemon-sv08")).toBe(565606);
    expect(tcgplayerIdFromUrl(null)).toBeNull();
    const f = mockFetch({
      "/v1/3/sets/5": {
        products: [
          {
            id: 77,
            name: "X - 001/100",
            number: "1",
            rarity: "Rare",
            tcgplayer_url: "https://www.tcgplayer.com/product/12345",
          },
        ],
      },
      "/v1/3/sets/5/pricing": {
        prices: { "77": { tcg: { Holofoil: { low: 0.5, market: 1 } } } },
        updated: "2026-10-26T08:00:00Z",
      },
    });
    const p = new TcgTrackingProvider(f, "https://openapi.tcgtracking.com/v1");
    const rows = await p.setPrices(3, 5);
    expect(rows).toEqual([expect.objectContaining({ externalId: "3:5:12345", printing: "Holofoil", market: 1 })]);
    expect(rows[0].asOf?.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  it("keeps the good entries when some pricing entries are odd", async () => {
    const f = mockFetch({
      "/v1/3/sets/7": {
        products: [
          { id: 1, name: "A - 001/100", number: "1", rarity: "Rare" },
          { id: 2, name: "B - 002/100", number: "2", rarity: "Rare" },
          { id: 3, name: "C Booster Box" },
        ],
      },
      "/v1/3/sets/7/pricing": {
        updated: 1793000000,
        prices: {
          "1": { tcg: { Holofoil: { low: "1.50", market: "2.25" }, "Reverse Holofoil": null, Foil: "n/a" } },
          "2": { tcg: [] },
          "3": { tcg: { Normal: { low: null, market: 120 } } },
          "4": null,
          oops: { tcg: { Normal: { market: 5 } } },
          "5": { manapool: { Normal: { market: 9 } } },
        },
      },
    });
    const p = new TcgTrackingProvider(f, "https://openapi.tcgtracking.com/v1");
    const rows = await p.setPrices(3, 7);
    expect(rows.map((r) => [r.externalId, r.printing, r.market, r.low])).toEqual([
      ["3:7:1", "Holofoil", 2.25, 1.5],
      ["3:7:3", "Normal", 120, null],
    ]);
    expect(rows[0].asOf?.getUTCFullYear()).toBe(2026);
  });

  it("explains which field broke when the shape is wrong", async () => {
    const p = new TcgTrackingProvider(
      mockFetch({ "/v1/3/sets/8/pricing": { data: [] }, "/v1/3/sets/8": { products: [] } }),
      "https://openapi.tcgtracking.com/v1",
    );
    await expect(p.prices(3, 8)).rejects.toThrow(/no "prices" object; keys: data/);
    const q = new TcgTrackingProvider(
      mockFetch({ "/v1/3/sets": { sets: [{ id: 1 }] } }),
      "https://openapi.tcgtracking.com/v1",
    );
    await expect(q.groups(3)).rejects.toThrow(/sets\.0\.name/);
  });

  it("raises a provider error for unexpected response shapes", async () => {
    const p = new TcgTrackingProvider(mockFetch({ "/v1/3/sets": { sets: [{ nope: true }] } }), undefined);
    await expect(p.listSets("pokemon")).rejects.toThrow(/unexpected response/);
  });

  it("cleans card names", () => {
    expect(cleanCardName("Pikachu ex - 238/191")).toBe("Pikachu ex");
    expect(cleanCardName("Black Lotus")).toBe("Black Lotus");
    expect(cleanCardName("Sol Ring - 279")).toBe("Sol Ring");
  });
});

describe("PokemonTcgProvider", () => {
  it("maps printings and update dates", async () => {
    const card = {
      id: "test1-1",
      name: "Testmon",
      number: "1",
      rarity: "Rare",
      set: { id: "test1", name: "Test" },
      images: {
        small: "https://images.pokemontcg.io/test1/1.png",
        large: "https://images.pokemontcg.io/test1/1_hires.png",
      },
      tcgplayer: {
        url: null,
        updatedAt: "2026/10/24",
        prices: { holofoil: { market: 3.21 }, reverseHolofoil: { market: 1.5 } },
      },
    };
    const p = new PokemonTcgProvider(undefined, mockFetch({ "/cards/test1-1": { data: card } }));
    const prices = await p.getCurrentCardPrice("test1-1");
    expect(prices.map((x) => [x.printing, x.market])).toEqual([
      ["Holofoil", 3.21],
      ["Reverse Holofoil", 1.5],
    ]);
    expect(prices[0].asOf?.toISOString()).toBe("2026-10-24T00:00:00.000Z");
    expect(await p.getCardDetails("../../etc")).toBeNull();
  });

  it("sanitizes query terms", () => {
    expect(sanitizeQueryTerm('pika" OR set.id:*')).toBe("pika OR set.id");
  });
});

describe("fetchJson", () => {
  it("refuses hosts outside the provider allowlist", async () => {
    await expect(fetchJson("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/non-allowlisted/);
    await expect(fetchJson("http://tcgtracking.com/tcgapi/v1/3/sets")).rejects.toThrow(/non-allowlisted/);
  });

  it("retries once on a 5xx response", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? new Response("x", { status: 503 }) : Response.json({ ok: 1 })));
    await expect(
      fetchJson("https://openapi.tcgtracking.com/v1/retry", {
        fetchImpl: f as unknown as typeof fetch,
        minIntervalMs: 0,
      }),
    ).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  }, 10_000);
});

describe("catalog matching", () => {
  it("matches sets and sealed products strictly", () => {
    expect(normalizeName("Scarlet & Violet—Surging Sparks")).toBe("scarlet and violet surging sparks");
    expect(matchGroup("Test Sparks", GROUPS).match?.groupId).toBe(9001);
    expect(matchGroup("Scarlet & Violet—Test Sparks", GROUPS).match?.groupId).toBe(9001);
    expect(matchGroup("Unknown Set", GROUPS).match).toBeNull();
    expect(matchSealedProduct("Test Sparks Booster Box", PRODUCTS).match?.productId).toBe(1);
    const miss = matchSealedProduct("Test Sparks Elite Trainer Box", PRODUCTS);
    expect(miss.match).toBeNull();
    expect(miss.candidates.length).toBeGreaterThan(0);
  });

  it("creates one card row per priced printing and drops unsafe image URLs", () => {
    const rows = cardRowsFromGroup(PRODUCTS, PRICES);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.printing)).toEqual(["Holofoil", "Reverse Holofoil"]);
    expect(rows[0].image_url).toBeNull();
    expect(safeImageUrl("https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg")).not.toBeNull();
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safeImageUrl("https://user:pw@cdn.example.com/a.png")).toBeNull();
    expect(safeImageUrl("//tcgplayer-cdn.tcgplayer.com/set_icon/x.png")).toBe(
      "https://tcgplayer-cdn.tcgplayer.com/set_icon/x.png",
    );
  });
});

describe("top cards per set", () => {
  const product = (id: number, card = true): TcgProduct => ({
    productId: id,
    sourceId: id,
    name: card ? `Card ${id} - ${id}/100` : `Box ${id}`,
    cleanName: null,
    imageUrl: null,
    categoryId: 3,
    groupId: 1,
    url: null,
    extendedData: card ? [{ name: "Number", value: `${id}/100` }] : [],
  });
  const price = (id: number, marketPrice: number | null, subTypeName = "Holofoil"): TcgPrice => ({
    productId: id,
    lowPrice: null,
    marketPrice,
    subTypeName,
  });
  const products = [product(1), product(2), product(3), product(4), product(99, false)];
  const prices = [
    price(1, 5),
    price(1, 40, "Reverse Holofoil"), // best printing counts
    price(2, 20),
    price(3, null),
    price(4, 30),
    price(99, 500), // sealed product, never a "card"
  ];

  it("ranks cards by their best printing and ignores sealed and unpriced products", () => {
    expect([...mostValuableCardIds(products, prices, 2)]).toEqual([1, 4]);
    expect([...mostValuableCardIds(products, prices, 10)]).toEqual([1, 4, 2]);
  });

  it("keeps every printing of the top cards only", () => {
    const rows = cardRowsFromGroup(products, prices, { topCards: 2 });
    expect(rows.map((r) => [r.tcgplayer_product_id, r.printing])).toEqual([
      [1, "Holofoil"],
      [1, "Reverse Holofoil"],
      [4, "Holofoil"],
    ]);
    expect(cardRowsFromGroup(products, prices)).toHaveLength(5);
  });
});

describe("planSnapshots", () => {
  it("maps provider prices onto tracked products and card printings", () => {
    const capturedAt = new Date("2026-10-26T21:00:00Z");
    const prices = [
      {
        externalId: "3:9001:1",
        printing: "Normal",
        currency: "USD",
        market: 2.5,
        low: 1,
        mid: 2,
        high: 3,
        asOf: new Date("2026-10-26T20:00:00Z"),
      },
      {
        externalId: "3:9001:3",
        printing: "Holofoil",
        currency: "USD",
        market: 9.99,
        low: null,
        mid: null,
        high: null,
        asOf: null,
      },
      {
        externalId: "3:9001:3",
        printing: "Reverse Holofoil",
        currency: "USD",
        market: null,
        low: null,
        mid: null,
        high: null,
        asOf: null,
      },
    ];
    const plan = planSnapshots({
      products: [
        { id: "p1", tcgplayer_product_id: 1 },
        { id: "p2", tcgplayer_product_id: null },
      ],
      cards: [
        { id: "c1", tcgplayer_product_id: 3, printing: "Holofoil" },
        { id: "c2", tcgplayer_product_id: 3, printing: "Reverse Holofoil" },
        { id: "c3", tcgplayer_product_id: 4, printing: "Normal" },
      ],
      prices,
      sourceId: "src",
      capturedAt,
    });
    expect(plan.rows.map((r) => [r.sealed_product_id ?? r.card_id, r.market_price])).toEqual([
      ["p1", "2.50"],
      ["c1", "9.99"],
      ["c2", null],
    ]);
    expect(plan.rows[0].snapshot_date).toBe("2026-10-26");
    expect(plan.unpricedCards).toEqual(["c2", "c3"]);
  });

  it("writes card history only when a provider price changes", () => {
    const price = (id: number, market: number) => ({
      externalId: `3:9001:${id}`,
      printing: "Holofoil",
      currency: "USD",
      market,
      low: null,
      mid: null,
      high: null,
      asOf: null,
    });
    const card = (id: string, product: number, current: string | null, kind: string | null = "provider") => ({
      id,
      tcgplayer_product_id: product,
      printing: "Holofoil",
      current_price: current,
      current_price_currency: "USD",
      current_price_kind: kind,
    });
    const plan = planSnapshots({
      products: [],
      cards: [
        card("same", 1, "9.99"),
        card("moved", 2, "5.00"),
        card("manual", 3, "7.00", "manual"),
        card("new", 4, null),
      ],
      prices: [price(1, 9.99), price(2, 5.5), price(3, 7), price(4, 1)],
      sourceId: "src",
      capturedAt: new Date("2026-10-26T21:00:00Z"),
    });
    expect(plan.unchangedCards).toEqual(["same"]);
    expect(plan.rows.map((r) => r.card_id)).toEqual(["moved", "manual", "new"]);
  });
});

describe("CSV", () => {
  it("neutralizes formula injection in exported text", () => {
    expect(escapeCsvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell(-5)).toBe("-5");
    expect(escapeCsvCell("-7.00")).toBe("-7.00");
    expect(escapeCsvCell("-1+1")).toBe("'-1+1");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(
      toCsv(
        [{ a: "x", b: 1 }],
        [
          { header: "A", value: (r) => r.a },
          { header: "B", value: (r) => r.b },
        ],
      ),
    ).toBe("A,B\r\nx,1\r\n");
  });

  it("validates price CSV uploads row by row", () => {
    const csv = [
      "item_type,item_id,tcgplayer_product_id,printing,market_price,currency,as_of,note",
      "sealed,,123,,129.99,usd,2026-10-20,Local shop",
      "card,6f1e0b0e-6d1b-4a0e-9a57-0b1d6c3f0a11,,,4.5,,2026-10-20T10:00:00Z,",
      "card,,,,-3,USD,2026-10-20,",
      "sealed,,5,,10.999,USD,2026-10-20,",
      "sealed,,5,,10,USD,2999-01-01,",
      "box,,5,,10,USD,2026-10-20,",
    ].join("\n");
    const { rows, errors } = parsePriceCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      item_type: "sealed",
      tcgplayer_product_id: 123,
      currency: "USD",
      printing: "Normal",
    });
    expect(errors.map((e) => e.line)).toEqual([4, 5, 6, 7]);
  });

  it("rejects files without required columns", () => {
    expect(parsePriceCsv("foo,bar\n1,2").errors[0].message).toMatch(/Missing column/);
  });
});

describe("newestFirst", () => {
  it("orders by release date, then by set id when dates are missing", () => {
    const sets = [
      { groupId: 1422, publishedOn: null },
      { groupId: 24722, publishedOn: null },
      { groupId: 23651, publishedOn: "2024-11-08" },
      { groupId: 23821, publishedOn: "2025-01-17" },
      { groupId: 24688, publishedOn: null },
    ];
    expect(sets.sort(newestFirst).map((s) => s.groupId)).toEqual([23821, 23651, 24722, 24688, 1422]);
  });
});
