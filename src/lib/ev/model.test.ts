import { describe, expect, it } from "vitest";
import { Decimal } from "../money";
import { calculateEv } from "./engine";
import { buildModelInput, selectPoolCards, toPerOccurrence, type CardRow, type EstimateRow, type SlotRow } from "./model";

const base = {
  set_id: "set1",
  number: null,
  image_url: null,
  tcgplayer_product_id: null,
  current_price_currency: "USD",
  current_price_kind: "provider" as const,
  price_updated_at: "2026-10-26T00:00:00Z",
};
const c = (id: string, rarity: string, printing: string, price: number | null, tcg: number | null = null): CardRow => ({
  ...base,
  id,
  name: id,
  rarity,
  printing,
  current_price: price,
  tcgplayer_product_id: tcg,
});

describe("toPerOccurrence", () => {
  it("converts per-pack expected counts into per-slot probabilities", () => {
    // 1 in 87 packs, a slot that appears once per pack in a 36-pack box
    expect(toPerOccurrence("0.0115", "per_pack", new Decimal(36), 36)?.toString()).toBe("0.0115");
    // 2 reverse slots per pack: per-pack rate is shared over 72 occurrences
    expect(toPerOccurrence("0.5", "per_pack", new Decimal(72), 36)?.toString()).toBe("0.25");
    // per-box rate over 36 occurrences
    expect(toPerOccurrence("1", "per_box", new Decimal(36), 36)?.toFixed(6)).toBe("0.027778");
    expect(toPerOccurrence("0.3", "per_slot", new Decimal(5), 36)?.toString()).toBe("0.3");
    expect(toPerOccurrence(null, "per_pack", new Decimal(36), 36)).toBeNull();
  });
});

describe("selectPoolCards", () => {
  const cards = [
    c("pika-holo", "Special Illustration Rare", "Holofoil", 240, 1),
    c("common-normal", "Common", "Normal", 0.05, 2),
    c("common-reverse", "Common", "Reverse Holofoil", 0.2, 2),
    c("rare-holo", "Rare", "Holofoil", 0.3, 3),
    c("rare-reverse", "Rare", "Reverse Holofoil", 0.4, 3),
  ];

  it("filters by rarity case-insensitively", () => {
    expect(selectPoolCards(cards, ["special illustration rare"], null).map((x) => x.id)).toEqual(["pika-holo"]);
  });

  it("uses one printing per card when no printing is named", () => {
    expect(selectPoolCards(cards, ["Common", "Rare"], null).map((x) => x.id).sort()).toEqual([
      "common-normal",
      "rare-holo",
    ]);
  });

  it("applies name filters for pattern variants", () => {
    const pattern = [...cards, c("eevee-mb", "Common", "Normal", 30, 9)];
    pattern[pattern.length - 1].name = "Eevee (Master Ball Pattern)";
    expect(selectPoolCards(pattern, ["Common"], null, { contains: "master ball" }).map((x) => x.id)).toEqual(["eevee-mb"]);
    expect(selectPoolCards(pattern, ["Common"], null, { excludes: "pattern" }).map((x) => x.id)).toEqual(["common-normal"]);
  });

  it("restricts to a named printing", () => {
    expect(selectPoolCards(cards, ["Common", "Rare"], "Reverse Holofoil").map((x) => x.id).sort()).toEqual([
      "common-reverse",
      "rare-reverse",
    ]);
  });
});

describe("buildModelInput", () => {
  it("builds engine input from database rows and computes EV", () => {
    const slots: SlotRow[] = [
      { id: "hit", model_id: "m", name: "Hit slot", kind: "random", occurrences_per_pack: 1, occurrences_per_product: null, position: 1 },
      { id: "promo", model_id: "m", name: "Promo", kind: "guaranteed", occurrences_per_pack: null, occurrences_per_product: 1, position: 0 },
    ];
    const est = (e: Partial<EstimateRow> & Pick<EstimateRow, "id" | "slot_id" | "label" | "outcome_kind">): EstimateRow => ({
      set_id: null,
      card_id: null,
      rarities: null,
      printing: null,
      probability: null,
      is_remainder: false,
      probability_basis: "per_pack",
      source_type: "community",
      source_name: "test",
      source_url: null,
      sample_size: 1000,
      last_verified_at: null,
      confidence: "medium",
      notes: null,
      position: 0,
      ...e,
    });
    const cards = [c("sir1", "SIR", "Holofoil", 100), c("sir2", "SIR", "Holofoil", 50), c("r1", "Rare", "Holofoil", 0.5), c("promo", "Promo", "Normal", 4)];
    const estimates: EstimateRow[] = [
      est({ id: "e1", slot_id: "hit", label: "SIR", outcome_kind: "rarity_pool", rarities: ["SIR"], probability: "0.01", position: 0 }),
      est({ id: "e2", slot_id: "hit", label: "Rare", outcome_kind: "rarity_pool", rarities: ["Rare"], is_remainder: true, position: 1 }),
      est({ id: "e3", slot_id: "promo", label: "Promo", outcome_kind: "card", card_id: "promo", probability: "1", probability_basis: "per_box", source_type: "official", source_url: "https://example.com" }),
    ];
    const input = buildModelInput({
      model: { id: "m", packs_per_product: 9 },
      slots,
      estimates,
      cardsBySet: new Map([["set1", cards]]),
      cardsById: new Map(cards.map((x) => [x.id, x])),
      productSetId: "set1",
      currency: "USD",
    });
    expect(input.slots.map((s) => s.name)).toEqual(["Promo", "Hit slot"]);
    const r = calculateEv(input, { now: new Date("2026-10-26T12:00:00Z") });
    // promo 4 + 9 x (0.01 x 75 + 0.99 x 0.5) = 4 + 9 x 1.245 = 15.205
    expect(r.grossEv?.toString()).toBe("15.205");
    expect(r.status).toBe("complete");
  });
});
