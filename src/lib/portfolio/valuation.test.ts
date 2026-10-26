import { describe, expect, it } from "vitest";
import { Decimal, formatMoney, roundMoney, toMoneyString } from "../money";
import { groupPositions, summarize, valueLot, type LotInput } from "./valuation";

const NOW = new Date("2026-10-26T12:00:00Z");
const fresh = (amount: string, currency = "USD") => ({ amount, currency, asOf: "2026-10-26T00:00:00Z" });

function lot(partial: Partial<LotInput> & Pick<LotInput, "id" | "quantity" | "unitPrice">): LotInput {
  return {
    assetType: "sealed",
    itemKey: "sealed:box",
    itemName: "Box",
    currency: "USD",
    marketPrice: fresh("150"),
    ...partial,
  };
}

describe("valueLot", () => {
  it("includes fees and shipping in the cost basis", () => {
    const v = valueLot(lot({ id: "1", quantity: 2, unitPrice: "100", extraCosts: ["7.50", "12.25", null] }), {
      now: NOW,
    });
    expect(v.costBasis.toString()).toBe("219.75");
    expect(v.unitCostBasis.toString()).toBe("109.875");
    expect(v.marketValue?.toString()).toBe("300");
    expect(v.gain?.toString()).toBe("80.25");
    expect(v.gainPct?.toFixed(4)).toBe("36.5188");
    expect(v.priceStatus).toBe("fresh");
  });

  it("calculates unrealized losses", () => {
    const v = valueLot(lot({ id: "1", quantity: 1, unitPrice: "200" }), { now: NOW });
    expect(v.gain?.toString()).toBe("-50");
    expect(v.gainPct?.toString()).toBe("-25");
  });

  it("flags a missing price instead of valuing at zero", () => {
    const v = valueLot(lot({ id: "1", quantity: 1, unitPrice: "10", marketPrice: null }), { now: NOW });
    expect(v.priceStatus).toBe("missing");
    expect(v.marketValue).toBeNull();
    expect(v.gain).toBeNull();
  });

  it("uses but flags a stale price", () => {
    const v = valueLot(
      lot({
        id: "1",
        quantity: 1,
        unitPrice: "10",
        marketPrice: { amount: "12", currency: "USD", asOf: "2026-08-01T00:00:00Z" },
      }),
      { now: NOW },
    );
    expect(v.priceStatus).toBe("stale");
    expect(v.marketValue?.toString()).toBe("12");
  });

  it("prefers the owner's manual value and refuses cross-currency valuation", () => {
    const manual = valueLot(lot({ id: "1", quantity: 1, unitPrice: "10", manualUnitValue: { amount: "25" } }), {
      now: NOW,
    });
    expect(manual.priceStatus).toBe("manual");
    expect(manual.marketValue?.toString()).toBe("25");
    const eur = valueLot(lot({ id: "2", quantity: 1, unitPrice: "10", marketPrice: fresh("12", "EUR") }), { now: NOW });
    expect(eur.priceStatus).toBe("currency_mismatch");
    expect(eur.marketValue).toBeNull();
  });

  it("warns that graded cards use the raw price", () => {
    const v = valueLot(lot({ id: "1", quantity: 1, unitPrice: "10", assetType: "card", isGraded: true }), { now: NOW });
    expect(v.warnings[0]).toMatch(/ungraded/);
  });

  it("rejects invalid quantities and negative costs", () => {
    expect(() => valueLot(lot({ id: "1", quantity: 0, unitPrice: "10" }))).toThrow();
    expect(() => valueLot(lot({ id: "1", quantity: 1.5, unitPrice: "10" }))).toThrow();
    expect(() => valueLot(lot({ id: "1", quantity: 1, unitPrice: "-1" }))).toThrow();
    expect(() => valueLot(lot({ id: "1", quantity: 1, unitPrice: "1", extraCosts: ["-2"] }))).toThrow();
  });
});

describe("multiple acquisition lots", () => {
  it("uses each lot's actual price for the position cost basis", () => {
    const lots = [
      lot({ id: "a", quantity: 1, unitPrice: "90", extraCosts: ["10"] }),
      lot({ id: "b", quantity: 3, unitPrice: "130" }),
    ].map((l) => valueLot(l, { now: NOW }));
    const [pos] = groupPositions(lots);
    expect(pos.quantity).toBe(4);
    expect(pos.costBasis.toString()).toBe("490"); // 100 + 390, not 4 x the last price
    expect(pos.averageUnitCost.toString()).toBe("122.5");
    expect(pos.marketValue?.toString()).toBe("600");
    expect(pos.gain?.toString()).toBe("110");
    expect(pos.lots[0].gain?.toString()).toBe("50");
    expect(pos.lots[1].gain?.toString()).toBe("60");
  });

  it("summarizes a portfolio per currency, excluding unpriced lots from gain", () => {
    const vals = [
      lot({ id: "a", quantity: 2, unitPrice: "100" }),
      lot({ id: "b", quantity: 1, unitPrice: "50", assetType: "card", itemKey: "card:x", marketPrice: fresh("80") }),
      lot({ id: "c", quantity: 1, unitPrice: "20", itemKey: "custom:1", marketPrice: null }),
      lot({ id: "d", quantity: 1, unitPrice: "10", currency: "EUR", marketPrice: fresh("11", "EUR") }),
    ].map((l) => valueLot(l, { now: NOW }));
    const totals = summarize(vals);
    const usd = totals.find((t) => t.currency === "USD")!;
    expect(usd.costBasis.toString()).toBe("270");
    expect(usd.valuedCostBasis.toString()).toBe("250");
    expect(usd.marketValue.toString()).toBe("380");
    expect(usd.unrealizedGain.toString()).toBe("130");
    expect(usd.unrealizedGainPct?.toString()).toBe("52");
    expect(usd.sealedValue.toString()).toBe("300");
    expect(usd.cardValue.toString()).toBe("80");
    expect(usd.sealedQuantity).toBe(3);
    expect(usd.cardQuantity).toBe(1);
    expect(usd.missingPriceLots).toBe(1);
    expect(totals.find((t) => t.currency === "EUR")?.marketValue.toString()).toBe("11");
  });
});

describe("money", () => {
  it("avoids binary floating point errors", () => {
    expect(new Decimal("0.1").plus("0.2").toString()).toBe("0.3");
    const v = valueLot(lot({ id: "1", quantity: 3, unitPrice: "0.1", marketPrice: fresh("0.1") }), { now: NOW });
    expect(v.costBasis.toString()).toBe("0.3");
  });

  it("rounds half-up to the currency's minor unit", () => {
    expect(toMoneyString(new Decimal("2.005"))).toBe("2.01");
    expect(toMoneyString(new Decimal("2.004"))).toBe("2.00");
    expect(toMoneyString(new Decimal("-2.005"))).toBe("-2.01");
    expect(roundMoney(new Decimal("1234.5"), "JPY").toString()).toBe("1235");
    expect(formatMoney("1234.565", "USD")).toBe("$1,234.57");
    expect(formatMoney("-5", "USD", { signed: true })).toBe("-$5.00");
    expect(formatMoney(null)).toBe("—");
  });
});
