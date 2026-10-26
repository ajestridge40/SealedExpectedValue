import { describe, expect, it } from "vitest";
import { Decimal } from "../money";
import { calculateEv } from "./engine";
import { breakEvenPrice, calculateReturns, compareScenarios } from "./returns";
import type { CardRef, OutcomeInput, OutcomeSource, PullModelInput, SlotInput } from "./types";

const NOW = new Date("2026-10-26T12:00:00Z");
const FRESH = "2026-10-26T00:00:00Z";
const OLD = "2026-09-01T00:00:00Z";

function card(id: string, price: string | null, asOf: string | null = FRESH, currency = "USD"): CardRef {
  return { id, name: `Card ${id}`, price: price === null ? null : { amount: price, currency, asOf } };
}

const community: OutcomeSource = { type: "community", name: "Test sample", confidence: "medium" };
const official: OutcomeSource = { type: "official", name: "Publisher", url: "https://example.com", confidence: "high" };

function cardOutcome(id: string, p: string | null, c: CardRef, source = community): OutcomeInput {
  return { id, label: id, kind: "card", probability: p, card: c, source };
}
function poolOutcome(
  id: string,
  p: string | null,
  pool: CardRef[],
  source = community,
  isRemainder = false,
): OutcomeInput {
  return { id, label: id, kind: "rarity_pool", probability: p, pool, source, isRemainder };
}
function slot(
  id: string,
  occurrences: string | number,
  outcomes: OutcomeInput[],
  kind: SlotInput["kind"] = "random",
): SlotInput {
  return { id, name: id, kind, occurrences, outcomes };
}
const model = (slots: SlotInput[]): PullModelInput => ({ currency: "USD", slots });

describe("calculateEv", () => {
  it("computes a simple probability-weighted EV", () => {
    // One slot, once: 0.5 x $10 + 0.5 x $2 = $6
    const r = calculateEv(
      model([slot("s", 1, [cardOutcome("a", "0.5", card("a", "10")), cardOutcome("b", "0.5", card("b", "2"))])]),
      { now: NOW },
    );
    expect(r.status).toBe("complete");
    expect(r.grossEv?.toString()).toBe("6");
    expect(r.probabilityCoverage).toBe(1);
    expect(r.priceCoverage).toBe(1);
  });

  it("sums independent slots, each multiplied by its occurrences", () => {
    // 36 packs x (4 commons at $0.05) + 36 packs x 1 rare slot (0.1 x $20 + 0.9 x $0.25)
    const commons = [card("c1", "0.04"), card("c2", "0.06")];
    const r = calculateEv(
      model([
        slot("common", 144, [poolOutcome("common", "1", commons)]),
        slot("rare", 36, [
          cardOutcome("hit", "0.1", card("hit", "20")),
          poolOutcome("rare", null, [card("r", "0.25")], community, true),
        ]),
      ]),
      { now: NOW },
    );
    // 144 x 0.05 = 7.2 ; 36 x (2 + 0.225) = 80.1
    expect(r.grossEv?.toFixed(4)).toBe("87.3000");
    expect(r.slots.map((s) => s.ev.toFixed(2))).toEqual(["7.20", "80.10"]);
    expect(r.status).toBe("complete");
  });

  it("counts guaranteed pulls exactly once per occurrence", () => {
    const r = calculateEv(
      model([
        slot("promo", 1, [cardOutcome("promo", "1", card("promo", "4.50"))], "guaranteed"),
        slot("pack", 9, [cardOutcome("x", "1", card("x", "1"))]),
      ]),
      { now: NOW },
    );
    expect(r.grossEv?.toFixed(2)).toBe("13.50");
    const promo = r.cards.find((c) => c.card.id === "promo");
    expect(promo?.probabilityAtLeastOne).toBe(1);
    expect(promo?.expectedCount.toString()).toBe("1");
  });

  it("resolves a remainder outcome for mutually exclusive results", () => {
    const r = calculateEv(
      model([
        slot("rare", 1, [
          cardOutcome("ur", "0.0667", card("ur", "30")),
          cardOutcome("dr", "0.1694", card("dr", "3")),
          poolOutcome("base", null, [card("b1", "0.20"), card("b2", "0.30")], community, true),
        ]),
      ]),
      { now: NOW },
    );
    const base = r.slots[0].outcomes.find((o) => o.id === "base")!;
    expect(base.probability?.toString()).toBe("0.7639");
    // 0.0667x30 + 0.1694x3 + 0.7639x0.25 = 2.001 + 0.5082 + 0.190975
    expect(r.grossEv?.toFixed(6)).toBe("2.700175");
  });

  it("rejects mutually exclusive outcomes whose probabilities exceed 1", () => {
    const r = calculateEv(
      model([slot("s", 1, [cardOutcome("a", "0.7", card("a", "1")), cardOutcome("b", "0.4", card("b", "1"))])]),
      { now: NOW },
    );
    expect(r.status).toBe("insufficient");
    expect(r.grossEv).toBeNull();
    expect(r.issues.some((i) => i.code === "probability_exceeds_one")).toBe(true);
  });

  it("rejects probabilities outside 0..1", () => {
    const r = calculateEv(model([slot("s", 1, [cardOutcome("a", "-0.1", card("a", "1"))])]), { now: NOW });
    expect(r.status).toBe("insufficient");
    expect(r.issues.some((i) => i.code === "invalid_probability")).toBe(true);
  });

  it("excludes outcomes with unknown probability and marks the estimate partial", () => {
    const r = calculateEv(
      model([
        slot("s", 1, [
          cardOutcome("known", "0.9", card("known", "1")),
          cardOutcome("unknown", null, card("unknown", "500")),
        ]),
      ]),
      { now: NOW },
    );
    expect(r.status).toBe("partial");
    expect(r.grossEv?.toFixed(2)).toBe("0.90"); // the $500 card is not guessed in
    expect(r.issues.some((i) => i.code === "missing_probability")).toBe(true);
    expect(r.cards.find((c) => c.card.id === "unknown")?.probabilityAtLeastOne).toBeNull();
  });

  it("leaves a remainder unresolved when another rate is unknown", () => {
    const r = calculateEv(
      model([
        slot("s", 1, [
          cardOutcome("a", "0.5", card("a", "2")),
          cardOutcome("b", null, card("b", "2")),
          poolOutcome("rest", null, [card("c", "1")], community, true),
        ]),
      ]),
      { now: NOW },
    );
    expect(r.issues.some((i) => i.code === "unresolved_remainder")).toBe(true);
    expect(r.slots[0].probabilityCovered.toString()).toBe("0.5");
    expect(r.status).toBe("partial");
  });

  it("declines to estimate when too little probability is known", () => {
    const r = calculateEv(
      model([slot("s", 1, [cardOutcome("a", "0.2", card("a", "2")), cardOutcome("b", null, card("b", "2"))])]),
      { now: NOW },
    );
    expect(r.status).toBe("insufficient");
    expect(r.confidence).toBe("insufficient");
    expect(r.grossEv).toBeNull();
  });

  it("returns insufficient for an empty model", () => {
    const r = calculateEv(model([]), { now: NOW });
    expect(r.status).toBe("insufficient");
    expect(r.issues[0].code).toBe("no_slots");
  });

  it("excludes unpriced cards rather than valuing them at zero or guessing", () => {
    const r = calculateEv(
      model([
        slot("s", 1, [cardOutcome("priced", "0.95", card("p", "1")), cardOutcome("unpriced", "0.05", card("u", null))]),
      ]),
      { now: NOW },
    );
    expect(r.status).toBe("partial");
    expect(r.grossEv?.toFixed(2)).toBe("0.95");
    expect(r.priceCoverage).toBeCloseTo(0.95, 10);
    expect(r.issues.some((i) => i.code === "missing_price")).toBe(true);
  });

  it("averages a rarity pool over priced cards and flags low pool coverage", () => {
    const pool = [card("a", "10"), card("b", "20"), card("c", null), card("d", null)];
    const r = calculateEv(model([slot("s", 1, [poolOutcome("pool", "1", pool)])]), { now: NOW });
    const o = r.slots[0].outcomes[0];
    expect(o.unitValue?.toString()).toBe("15");
    expect(o.pricedCount).toBe(2);
    expect(o.totalCount).toBe(4);
    expect(r.issues.some((i) => i.code === "low_pool_coverage")).toBe(true);
    expect(r.status).toBe("partial");
  });

  it("flags stale prices and lowers confidence", () => {
    const fresh = calculateEv(model([slot("s", 1, [cardOutcome("a", "1", card("a", "10", FRESH), official)])]), {
      now: NOW,
    });
    const stale = calculateEv(model([slot("s", 1, [cardOutcome("a", "1", card("a", "10", OLD), official)])]), {
      now: NOW,
    });
    const undated = calculateEv(model([slot("s", 1, [cardOutcome("a", "1", card("a", "10", null), official)])]), {
      now: NOW,
    });
    expect(fresh.confidence).toBe("high");
    expect(fresh.freshness.label).toBe("fresh");
    expect(stale.freshness.label).toBe("stale");
    expect(stale.freshness.staleCount).toBe(1);
    expect(stale.confidence).toBe("low");
    expect(stale.grossEv?.toString()).toBe("10"); // still shown, but flagged
    expect(undated.freshness.label).toBe("stale");
  });

  it("ignores prices in another currency instead of mixing them", () => {
    const r = calculateEv(
      model([
        slot("s", 1, [
          cardOutcome("a", "0.5", card("a", "10")),
          cardOutcome("b", "0.5", card("b", "10", FRESH, "EUR")),
        ]),
      ]),
      { now: NOW },
    );
    expect(r.grossEv?.toString()).toBe("5");
    expect(r.issues.some((i) => i.code === "currency_mismatch")).toBe(true);
  });

  it("supports duplicate pulls of the same card across slots", () => {
    const pikachu = card("pika", "100");
    const r = calculateEv(
      model([
        slot("rev1", 10, [
          cardOutcome("p1", "0.01", pikachu),
          poolOutcome("r1", null, [card("x", "0")], community, true),
        ]),
        slot("rev2", 10, [
          cardOutcome("p2", "0.01", pikachu),
          poolOutcome("r2", null, [card("y", "0")], community, true),
        ]),
      ]),
      { now: NOW },
    );
    expect(r.status).toBe("complete");
    const c = r.cards.find((x) => x.card.id === "pika")!;
    expect(c.expectedCount.toString()).toBe("0.2"); // 2 slots x 10 occurrences x 1%
    expect(c.ev?.toString()).toBe("20");
    expect(c.probabilityAtLeastOne).toBeCloseTo(1 - Math.pow(0.99, 20), 12);
    expect(r.grossEv?.toString()).toBe("20");
  });

  it("refuses to double count a card listed individually and inside a pool in one slot", () => {
    const pika = card("pika", "240");
    const r = calculateEv(
      model([
        slot("hit", 36, [
          cardOutcome("pika-sir", "0.001", pika),
          poolOutcome("sir-pool", "0.0115", [pika, card("latias", "80")]),
          poolOutcome("rest", null, [card("bulk", "0.1")], community, true),
        ]),
      ]),
      { now: NOW },
    );
    expect(r.status).toBe("insufficient");
    expect(r.grossEv).toBeNull();
    expect(r.issues.find((i) => i.code === "double_counted_card")?.message).toContain("Card pika");
  });

  it("does not equal the sum of all card prices in the set", () => {
    const set = [card("a", "200"), card("b", "50"), card("c", "1"), card("d", "0.1")];
    const r = calculateEv(model([slot("s", 1, [poolOutcome("all", "1", set)])]), { now: NOW });
    // One pull from the set is worth the average (62.775), not the total (251.10).
    expect(r.grossEv?.toString()).toBe("62.775");
  });

  it("de-duplicates a pool that lists the same card twice", () => {
    const a = card("a", "10");
    const r = calculateEv(model([slot("s", 1, [poolOutcome("pool", "1", [a, a, card("b", "20")])])]), { now: NOW });
    expect(r.grossEv?.toString()).toBe("15");
    expect(r.status).toBe("complete");
  });

  it("treats zero-probability outcomes as contributing nothing", () => {
    const r = calculateEv(
      model([slot("s", 1, [cardOutcome("zero", "0", card("z", "1000")), cardOutcome("one", "1", card("o", "1"))])]),
      { now: NOW },
    );
    expect(r.grossEv?.toString()).toBe("1");
    expect(r.cards.find((c) => c.card.id === "z")?.probabilityAtLeastOne).toBe(0);
  });

  it("uses pool-uniform per-card odds for top-hit display", () => {
    const pool = [card("a", "100"), card("b", "10")];
    const r = calculateEv(
      model([
        slot("s", 36, [poolOutcome("sir", "0.02", pool), poolOutcome("rest", null, [card("x", "0")], community, true)]),
      ]),
      { now: NOW },
    );
    const a = r.cards.find((c) => c.card.id === "a")!;
    expect(a.basis).toBe("pool_uniform");
    expect(a.expectedCount.toString()).toBe("0.36"); // 36 x 0.02 / 2
  });

  it("classifies pull-rate confidence by source type", () => {
    const off = calculateEv(model([slot("s", 1, [cardOutcome("a", "1", card("a", "5"), official)])]), { now: NOW });
    const com = calculateEv(model([slot("s", 1, [cardOutcome("a", "1", card("a", "5"), community)])]), { now: NOW });
    const assumed = calculateEv(
      model([slot("s", 1, [cardOutcome("a", "1", card("a", "5"), { type: "user_assumption", confidence: "low" })])]),
      { now: NOW },
    );
    expect(off.pullRateConfidence).toBe("high");
    expect(com.pullRateConfidence).toBe("medium");
    expect(com.confidence).toBe("medium");
    expect(assumed.pullRateConfidence).toBe("low");
    expect(assumed.confidence).toBe("low");
  });
});

describe("calculateReturns", () => {
  const ev = new Decimal("120.50");

  it("keeps gross EV separate from net return", () => {
    const r = calculateReturns({ grossEv: ev, purchasePrice: "100", openingCosts: "5" });
    expect(r.status).toBe("ok");
    expect(r.netEv?.toString()).toBe("15.5");
    expect(r.netReturnPct?.toString()).toBe("15.5");
    expect(r.evToPrice?.toString()).toBe("1.205");
    expect(ev.toString()).toBe("120.5");
  });

  it("reports negative expected net returns", () => {
    const r = calculateReturns({ grossEv: new Decimal("80"), purchasePrice: "130" });
    expect(r.netEv?.toString()).toBe("-50");
    expect(r.netReturnPct?.toFixed(4)).toBe("-38.4615");
  });

  it("rejects zero, negative and invalid purchase prices", () => {
    for (const p of ["0", "-10", "abc", null]) {
      const r = calculateReturns({ grossEv: ev, purchasePrice: p });
      expect(r.status).toBe("invalid_price");
      expect(r.netReturnPct).toBeNull();
      expect(r.evToPrice).toBeNull();
    }
  });

  it("returns no_ev without inventing a value", () => {
    const r = calculateReturns({ grossEv: null, purchasePrice: "100" });
    expect(r.status).toBe("no_ev");
    expect(r.netEv).toBeNull();
  });

  it("compares purchase-price scenarios without changing EV", () => {
    const rows = compareScenarios(new Decimal("110"), ["90", "110", "130"]);
    expect(rows.map((r) => r.netEv?.toString())).toEqual(["20", "0", "-20"]);
    expect(rows.map((r) => r.netReturnPct?.toFixed(2))).toEqual(["22.22", "0.00", "-15.38"]);
    expect(breakEvenPrice(new Decimal("110"), "10")?.toString()).toBe("100");
    expect(breakEvenPrice(new Decimal("5"), "10")).toBeNull();
  });
});
