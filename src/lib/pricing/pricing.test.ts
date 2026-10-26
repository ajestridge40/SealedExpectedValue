import { describe, expect, it, vi } from "vitest";
import { cardRowsFromSet, matchSealedProduct, matchSet, normalizeName } from "../catalog/match";
import { escapeCsvCell, toCsv } from "../csv";
import { parsePriceCsv } from "./csv-import";
import { fetchJson } from "./http";
import { planSnapshots } from "./plan";
import { TcgApiProvider, cleanCardName } from "./providers/tcgapi";
import { safeImageUrl } from "./types";

// Mocked TCG API responses. Ids and prices are test fixtures, not market data.
const RATE = { daily_limit: 100, daily_remaining: 93, daily_reset: "2026-10-27T00:00:00.000Z" };
const SETS = [
  { id: 501, name: "SV08: Test Sparks", tcgplayer_id: 9001, abbreviation: "SV08", release_date: "2024-11-08" },
  { id: 502, name: "SV08: Test Sparks Promos", tcgplayer_id: 9002, abbreviation: null, release_date: null },
];
const CARDS = [
  {
    id: 7001,
    name: "Testachu ex - 238/191",
    clean_name: "Testachu ex 238 191",
    number: "238/191",
    rarity: "Special Illustration Rare",
    tcgplayer_id: 3,
    product_type: "Cards",
    printing: "Holofoil",
    market_price: 9.99,
    low_price: 8,
    median_price: 9.5,
    price_updated_at: "2026-10-26T06:00:00Z",
    image_url: "https://evil.example.com/x.jpg",
  },
  {
    id: 7002,
    name: "Testmon",
    number: "001/191",
    rarity: "Common",
    tcgplayer_id: 4,
    product_type: "Cards",
    printing: "Normal",
    market_price: 0.05,
    price_updated_at: "2026-10-26T06:00:00Z",
    image_url: "https://tcgplayer-cdn.tcgplayer.com/product/4_200w.jpg",
  },
];
const SEALED = [
  {
    id: 8001,
    name: "Test Sparks Booster Box",
    tcgplayer_id: 1,
    product_type: "Sealed Products",
    printing: "Normal",
    market_price: 150.5,
    price_updated_at: "2026-10-26T06:00:00Z",
    image_url: "https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg",
  },
  { id: 8002, name: "Test Sparks Booster Box Case", tcgplayer_id: 2, printing: "Normal", market_price: 900 },
];
const SET_PRICES = [
  { card_id: 7001, tcgplayer_id: 3, printing: "Holofoil", market_price: 9.99, last_updated_at: "2026-10-26T06:00:00Z" },
  { card_id: 7002, tcgplayer_id: 4, printing: "Normal", market_price: 0.05, last_updated_at: "2026-10-26T06:00:00Z" },
  {
    card_id: 7002,
    tcgplayer_id: 4,
    printing: "Reverse Holofoil",
    market_price: 0.25,
    last_updated_at: "2026-10-26T06:00:00Z",
  },
  { card_id: 8001, tcgplayer_id: 1, printing: "Normal", market_price: 150.5, last_updated_at: "2026-10-26T06:00:00Z" },
];

const ok = (data: unknown, meta?: unknown) => Response.json({ data, meta, rate_limit: RATE });

function mockApi(opts: { setPricesStatus?: number } = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = (init?.headers as Record<string, string>)?.["X-API-Key"];
    if (key !== "test-key-0123456789") return Response.json({ error: { message: "bad key" } }, { status: 401 });
    const path = url.pathname.replace("/v1", "");
    if (path === "/games/3/sets") return ok(SETS, { total: 2, has_more: false });
    if (path === "/sets/501/cards") {
      const type = url.searchParams.get("type");
      if (type === "Sealed Products") return ok(SEALED, { total: 2, has_more: false });
      // two pages of cards to exercise pagination
      return url.searchParams.get("page") === "1"
        ? ok([CARDS[0]], { total: 2, has_more: true })
        : ok([CARDS[1]], { total: 2, has_more: false });
    }
    if (path === "/sets/501/prices") {
      return opts.setPricesStatus
        ? Response.json({ error: { message: "Upgrade" } }, { status: opts.setPricesStatus })
        : ok(SET_PRICES);
    }
    if (path === "/cards/7002/prices") return ok(SET_PRICES.filter((r) => r.card_id === 7002));
    if (path === "/cards/7002/history")
      return ok([{ date: "2026-10-20", printing: "Normal", market_price: 0.04, low_price: 0.01 }]);
    return Response.json({ error: { message: "not found" } }, { status: 404 });
  }) as unknown as typeof fetch;
}

const calls = (f: typeof fetch) =>
  (f as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => new URL(String(c[0])).pathname);

describe("TcgApiProvider", () => {
  it("sends the API key, pages through results and records the rate limit", async () => {
    const f = mockApi();
    const p = new TcgApiProvider("test-key-0123456789", f);
    const cards = await p.setCards(501, "Cards");
    expect(cards.map((c) => c.id)).toEqual([7001, 7002]);
    expect(p.rateLimit?.daily_remaining).toBe(93);
    const sets = await p.listSets(3);
    expect(sets[0]).toMatchObject({ externalId: "501", name: "SV08: Test Sparks", releaseDate: "2024-11-08" });
    // cached: a second call does not hit the API again
    await p.setCards(501, "Cards");
    expect(calls(f).filter((c) => c.endsWith("/sets/501/cards")).length).toBe(2);
  });

  it("returns every printing when the plan includes set prices", async () => {
    const p = new TcgApiProvider("test-key-0123456789", mockApi());
    const { prices, allPrintings } = await p.setPrices(501);
    expect(allPrintings).toBe(true);
    expect(prices.map((x) => [x.externalId, x.printing, x.market])).toContainEqual(["4", "Reverse Holofoil", 0.25]);
    expect(prices[0].asOf?.toISOString()).toBe("2026-10-26T06:00:00.000Z");
  });

  it("falls back to primary printings on plans without set prices (403)", async () => {
    const f = mockApi({ setPricesStatus: 403 });
    const p = new TcgApiProvider("test-key-0123456789", f);
    const { prices, allPrintings } = await p.setPrices(501);
    expect(allPrintings).toBe(false);
    expect(p.setPricesAvailable).toBe(false);
    expect(prices.map((x) => [x.externalId, x.printing, x.market])).toEqual([
      ["3", "Holofoil", 9.99],
      ["4", "Normal", 0.05],
      ["1", "Normal", 150.5],
      ["2", "Normal", 900],
    ]);
    // does not retry the forbidden endpoint for the next set
    expect(await p.setPriceRows(501)).toBeNull();
    expect(calls(f).filter((c) => c.endsWith("/prices")).length).toBe(1);
  });

  it("explains a bad key and a missing key", async () => {
    const p = new TcgApiProvider("wrong-key-0123456789", mockApi());
    await expect(p.setCards(501, "Cards")).rejects.toThrow(/rejected the API key/);
    const none = new TcgApiProvider("", mockApi());
    expect(none.configured).toBe(false);
    await expect(none.setCards(501, "Cards")).rejects.toThrow(/TCGAPI_KEY is not set/);
  });

  it("reads card prices and history", async () => {
    const p = new TcgApiProvider("test-key-0123456789", mockApi());
    const prices = await p.getCurrentCardPrice("7002");
    expect(prices.map((x) => x.printing)).toEqual(["Normal", "Reverse Holofoil"]);
    const hist = await p.getPriceHistory("7002");
    expect(hist[0]).toMatchObject({ market: 0.04, printing: "Normal" });
    expect(await p.getCurrentCardPrice("../etc")).toEqual([]);
  });

  it("raises a provider error for unexpected response shapes", async () => {
    const f = vi.fn(async () => Response.json({ data: [{ nope: true }] })) as unknown as typeof fetch;
    const p = new TcgApiProvider("test-key-0123456789", f);
    await expect(p.setCards(1, "Cards")).rejects.toThrow(/unexpected response/);
  });

  it("cleans card names", () => {
    expect(cleanCardName("Pikachu ex - 238/191")).toBe("Pikachu ex");
    expect(cleanCardName("Black Lotus")).toBe("Black Lotus");
    expect(cleanCardName("Sol Ring - 279")).toBe("Sol Ring");
  });
});

describe("fetchJson", () => {
  it("refuses hosts outside the provider allowlist", async () => {
    await expect(fetchJson("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/non-allowlisted/);
    await expect(fetchJson("http://api.tcgapi.dev/v1/games")).rejects.toThrow(/non-allowlisted/);
  });

  it("retries once on a 5xx response", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? new Response("x", { status: 503 }) : Response.json({ ok: 1 })));
    await expect(
      fetchJson("https://api.tcgapi.dev/v1/retry", { fetchImpl: f as unknown as typeof fetch, minIntervalMs: 0 }),
    ).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  }, 10_000);
});

describe("catalog matching", () => {
  it("matches sets by TCGplayer id or exact name, and sealed products strictly", () => {
    expect(normalizeName("Scarlet & Violet—Surging Sparks")).toBe("scarlet and violet surging sparks");
    expect(matchSet({ name: "Test Sparks" }, SETS).match?.id).toBe(501);
    expect(matchSet({ name: "Scarlet & Violet—Test Sparks" }, SETS).match?.id).toBe(501);
    expect(matchSet({ name: "Renamed", tcgplayerGroupId: 9002 }, SETS).match?.id).toBe(502);
    expect(matchSet({ name: "Unknown Set" }, SETS).match).toBeNull();
    expect(matchSealedProduct("Test Sparks Booster Box", SEALED).match?.id).toBe(8001);
    const miss = matchSealedProduct("Test Sparks Elite Trainer Box", SEALED);
    expect(miss.match).toBeNull();
    expect(miss.candidates.length).toBeGreaterThan(0);
  });

  it("creates one card row per printing and drops unsafe image hosts", () => {
    const all = cardRowsFromSet(CARDS, SET_PRICES);
    expect(all.map((r) => [r.name, r.printing])).toEqual([
      ["Testachu ex", "Holofoil"],
      ["Testmon", "Normal"],
      ["Testmon", "Reverse Holofoil"],
    ]);
    expect(all[0].image_url).toBeNull();
    expect(all[1].image_url).not.toBeNull();
    expect(all[0].tcgapi_id).toBe(7001);
    // without set prices: primary printing only
    expect(cardRowsFromSet(CARDS, null).map((r) => r.printing)).toEqual(["Holofoil", "Normal"]);
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
