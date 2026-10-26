import { describe, expect, it } from "vitest";
import { classifySealed, slugify } from "../catalog/product-type";
import { daysSince, listingSpread, momentum, priceAt, topValueRatio, volatility } from "./market";

const NOW = new Date("2026-10-26T12:00:00Z");
const day = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("market signals", () => {
  const history = [
    { t: day(95), price: 100 },
    { t: day(40), price: 120 },
    { t: day(20), price: 125 },
    { t: day(10), price: 130 },
    { t: day(1), price: 132 },
  ];

  it("finds the price at a point in time", () => {
    expect(priceAt(history, NOW)).toBe(132);
    expect(priceAt(history, new Date(day(30)))).toBe(120);
    expect(priceAt(history, new Date(day(200)))).toBeNull();
  });

  it("computes 30d and 90d momentum, or null without enough history", () => {
    expect(momentum(history, 30, NOW)).toBeCloseTo(0.1, 10); // 132 vs 120
    expect(momentum(history, 90, NOW)).toBeCloseTo(0.32, 10); // 132 vs 100
    expect(momentum(history, 365, NOW)).toBeNull();
    expect(momentum([{ t: day(1), price: 5 }], 30, NOW)).toBeNull();
  });

  it("computes volatility as the coefficient of variation", () => {
    const v = volatility(history, 30, NOW)!; // 125, 130, 132
    expect(v).toBeGreaterThan(0.02);
    expect(v).toBeLessThan(0.03);
    expect(volatility(history.slice(0, 2), 30, NOW)).toBeNull();
  });

  it("measures the listing spread and the top-5 ratio", () => {
    expect(listingSpread(100, 90)).toBeCloseTo(0.1);
    expect(listingSpread(100, null)).toBeNull();
    expect(listingSpread(0, 10)).toBeNull();
    expect(topValueRatio(300, 150)).toBe(2);
    expect(topValueRatio(300, 0)).toBeNull();
    expect(daysSince("2026-10-16", NOW)).toBe(10);
  });
});

describe("classifySealed", () => {
  it("recognises common sealed product types", () => {
    expect(classifySealed("Surging Sparks Booster Box")?.type).toBe("booster_box");
    expect(classifySealed("Bloomburrow Play Booster Display")?.type).toBe("booster_box");
    expect(classifySealed("Surging Sparks Elite Trainer Box")).toEqual({ type: "elite_trainer_box", packs: 9 });
    expect(classifySealed("Surging Sparks Booster Bundle")).toEqual({ type: "booster_bundle", packs: 6 });
    expect(classifySealed("Surging Sparks Booster Pack")).toEqual({ type: "booster_pack", packs: 1 });
    expect(classifySealed("Prismatic Evolutions Super-Premium Collection")?.type).toBe("collection_box");
    expect(classifySealed("Stacking Tin")?.type).toBe("tin");
  });

  it("skips cases and accessories", () => {
    expect(classifySealed("Surging Sparks Booster Box Case")).toBeNull();
    expect(classifySealed("Elite Trainer Box Sleeves")).toBeNull();
    expect(classifySealed("Code Card - Surging Sparks")).toBeNull();
  });

  it("slugifies names", () => {
    expect(slugify("Pokémon: Scarlet & Violet—151 Booster Bundle")).toBe(
      "pokemon-scarlet-and-violet-151-booster-bundle",
    );
  });
});
