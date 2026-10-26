import { describe, expect, it, vi } from "vitest";
import { cardRowsFromGroup, matchGroup, matchSealedProduct, normalizeName } from "../catalog/match";
import { escapeCsvCell, toCsv } from "../csv";
import { parsePriceCsv } from "./csv-import";
import { fetchJson } from "./http";
import { planSnapshots } from "./plan";
import { PokemonTcgProvider, sanitizeQueryTerm } from "./providers/pokemontcg";
import { TcgcsvProvider, cleanCardName } from "./providers/tcgcsv";
import { safeImageUrl } from "./types";

// Mocked provider responses. Ids and prices are test fixtures, not market data.
const GROUPS = {
  success: true,
  errors: [],
  results: [
    {
      groupId: 9001,
      name: "SV08: Test Sparks",
      abbreviation: "SV08",
      publishedOn: "2024-11-08T00:00:00",
      categoryId: 3,
    },
    { groupId: 9002, name: "SV08: Test Sparks Promos", abbreviation: null, publishedOn: null, categoryId: 3 },
  ],
};
const PRODUCTS = {
  success: true,
  errors: [],
  results: [
    {
      productId: 1,
      name: "Test Sparks Booster Box",
      imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg",
      categoryId: 3,
      groupId: 9001,
      url: null,
      extendedData: [],
    },
    {
      productId: 2,
      name: "Test Sparks Booster Box Case",
      imageUrl: null,
      categoryId: 3,
      groupId: 9001,
      url: null,
      extendedData: [],
    },
    {
      productId: 3,
      name: "Testachu ex - 238/191",
      imageUrl: "https://evil.example.com/x.jpg",
      categoryId: 3,
      groupId: 9001,
      url: null,
      extendedData: [
        { name: "Number", value: "238/191" },
        { name: "Rarity", value: "Special Illustration Rare" },
      ],
    },
  ],
};
const PRICES = {
  success: true,
  errors: [],
  results: [
    { productId: 1, lowPrice: 1, midPrice: 2, highPrice: 3, marketPrice: 2.5, subTypeName: "Normal" },
    { productId: 3, lowPrice: 1, midPrice: 2, highPrice: 3, marketPrice: 9.99, subTypeName: "Holofoil" },
    {
      productId: 3,
      lowPrice: null,
      midPrice: null,
      highPrice: null,
      marketPrice: null,
      subTypeName: "Reverse Holofoil",
    },
  ],
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

const tcgRoutes = {
  "/tcgplayer/3/groups": GROUPS,
  "/tcgplayer/3/9001/products": PRODUCTS,
  "/tcgplayer/3/9001/prices": PRICES,
  "/last-updated.txt": "2026-10-25T20:05:00+0000",
};

describe("TcgcsvProvider", () => {
  it("normalizes sets, products, cards and prices from mocked responses", async () => {
    const fetchImpl = mockFetch(tcgRoutes);
    const p = new TcgcsvProvider(fetchImpl);
    const sets = await p.listSets("pokemon");
    expect(sets[0]).toMatchObject({ externalId: "3:9001", name: "SV08: Test Sparks", releaseDate: "2024-11-08" });

    const sealed = await p.searchProducts({ game: "pokemon", setExternalId: "3:9001" });
    expect(sealed.map((s) => s.externalId)).toEqual(["3:9001:1", "3:9001:2"]);

    const cards = await p.searchCards({ game: "pokemon", setExternalId: "3:9001", text: "testachu" });
    expect(cards[0]).toMatchObject({
      name: "Testachu ex",
      number: "238/191",
      printings: ["Holofoil", "Reverse Holofoil"],
    });

    const price = await p.getCurrentProductPrice("3:9001:1");
    expect(price).toMatchObject({ market: 2.5, currency: "USD" });
    expect(price?.asOf?.toISOString()).toBe("2026-10-25T20:05:00.000Z");

    const cardPrices = await p.getCurrentCardPrice("3:9001:3");
    expect(cardPrices.map((x) => [x.printing, x.market])).toEqual([
      ["Holofoil", 9.99],
      ["Reverse Holofoil", null],
    ]);
    // Responses are cached per provider instance: products fetched once.
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.endsWith("/products")).length).toBe(1);
  });

  it("raises a provider error for unexpected response shapes", async () => {
    const p = new TcgcsvProvider(mockFetch({ "/tcgplayer/3/groups": { results: [{ nope: true }] } }));
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
    await expect(fetchJson("http://tcgcsv.com/x")).rejects.toThrow(/non-allowlisted/);
  });

  it("retries once on a 5xx response", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? new Response("x", { status: 503 }) : Response.json({ ok: 1 })));
    await expect(
      fetchJson("https://tcgcsv.com/retry", { fetchImpl: f as unknown as typeof fetch, minIntervalMs: 0 }),
    ).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  }, 10_000);
});

describe("catalog matching", () => {
  it("matches sets and sealed products strictly", () => {
    expect(normalizeName("Scarlet & Violet—Surging Sparks")).toBe("scarlet and violet surging sparks");
    expect(matchGroup("Test Sparks", GROUPS.results).match?.groupId).toBe(9001);
    expect(matchGroup("Scarlet & Violet—Test Sparks", GROUPS.results).match?.groupId).toBe(9001);
    expect(matchGroup("Unknown Set", GROUPS.results).match).toBeNull();
    expect(matchSealedProduct("Test Sparks Booster Box", PRODUCTS.results).match?.productId).toBe(1);
    const miss = matchSealedProduct("Test Sparks Elite Trainer Box", PRODUCTS.results);
    expect(miss.match).toBeNull();
    expect(miss.candidates.length).toBeGreaterThan(0);
  });

  it("creates one card row per priced printing and drops unsafe image hosts", () => {
    const rows = cardRowsFromGroup(PRODUCTS.results, PRICES.results);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.printing)).toEqual(["Holofoil", "Reverse Holofoil"]);
    expect(rows[0].image_url).toBeNull();
    expect(safeImageUrl("https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg")).not.toBeNull();
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
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
