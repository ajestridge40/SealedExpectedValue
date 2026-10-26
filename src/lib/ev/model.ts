import { Decimal, decOrNull } from "../money";
import type { CardRef, ConfidenceLevel, OutcomeInput, PriceKind, PullModelInput, PullRateSourceType } from "./types";

/*
 * Maps database rows (product_pull_models / pull_model_slots /
 * pull_rate_estimates / cards) to the provider- and UI-independent engine
 * input. No Supabase imports here so it stays unit-testable.
 */

type Num = number | string | null;

export interface ModelRow {
  id: string;
  packs_per_product: number;
}

export interface SlotRow {
  id: string;
  model_id: string;
  name: string;
  kind: "random" | "guaranteed";
  occurrences_per_pack: Num;
  occurrences_per_product: Num;
  position: number;
}

export interface EstimateRow {
  id: string;
  slot_id: string;
  set_id: string | null;
  label: string;
  outcome_kind: "card" | "rarity_pool";
  card_id: string | null;
  rarities: string[] | null;
  printing: string | null;
  probability: Num;
  is_remainder: boolean;
  probability_basis: "per_slot" | "per_pack" | "per_box";
  source_type: PullRateSourceType;
  source_name: string | null;
  source_url: string | null;
  sample_size: number | null;
  last_verified_at: string | null;
  confidence: ConfidenceLevel;
  notes: string | null;
  position: number;
}

export interface CardRow {
  id: string;
  set_id: string | null;
  name: string;
  number: string | null;
  rarity: string | null;
  printing: string;
  image_url: string | null;
  tcgplayer_product_id: number | null;
  current_price: Num;
  current_price_currency: string | null;
  current_price_kind: PriceKind | null;
  price_updated_at: string | null;
}

export function slotOccurrences(slot: SlotRow, packsPerProduct: number): Decimal {
  const perProduct = decOrNull(slot.occurrences_per_product);
  if (perProduct !== null) return perProduct;
  const perPack = decOrNull(slot.occurrences_per_pack) ?? new Decimal(0);
  return perPack.times(packsPerProduct);
}

/**
 * Convert a stored probability into "chance per single occurrence of the slot".
 *   per_slot  already per occurrence
 *   per_pack  expected count per pack     -> x packs / occurrences
 *   per_box   expected count per product  -> / occurrences
 */
export function toPerOccurrence(
  probability: Num,
  basis: EstimateRow["probability_basis"],
  occurrences: Decimal,
  packsPerProduct: number,
): Decimal | null {
  const p = decOrNull(probability);
  if (p === null) return null;
  if (basis === "per_slot") return p;
  if (occurrences.isZero()) return null;
  if (basis === "per_pack") return p.times(packsPerProduct).div(occurrences);
  return p.div(occurrences);
}

/** Order in which printings are chosen when a pool does not name one. */
const PRINTING_PREFERENCE = ["Holofoil", "Normal", "1st Edition Holofoil", "1st Edition", "Foil"];

function printingRank(printing: string): number {
  const i = PRINTING_PREFERENCE.indexOf(printing);
  if (i >= 0) return i;
  if (/reverse/i.test(printing)) return 1000; // reverse holos have their own slot
  return 100;
}

function cardIdentity(c: CardRow): string {
  return c.tcgplayer_product_id !== null
    ? `tcg:${c.tcgplayer_product_id}`
    : `${c.set_id}|${c.number ?? ""}|${c.name.toLowerCase()}`;
}

/**
 * Cards in a rarity pool. With an explicit printing, only that printing. Without
 * one, a single printing per card (base printing preferred) so the same card is
 * never in the pool twice.
 */
export function selectPoolCards(cards: CardRow[], rarities: string[], printing: string | null): CardRow[] {
  const wanted = new Set(rarities.map((r) => r.toLowerCase()));
  const matching = cards.filter((c) => c.rarity !== null && wanted.has(c.rarity.toLowerCase()));
  if (printing) return matching.filter((c) => c.printing.toLowerCase() === printing.toLowerCase());
  const best = new Map<string, CardRow>();
  for (const c of matching) {
    const key = cardIdentity(c);
    const prev = best.get(key);
    if (!prev || printingRank(c.printing) < printingRank(prev.printing)) best.set(key, c);
  }
  return [...best.values()];
}

export function toCardRef(c: CardRow): CardRef {
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity,
    printing: c.printing,
    imageUrl: c.image_url,
    price:
      c.current_price === null
        ? null
        : {
            amount: String(c.current_price),
            currency: c.current_price_currency ?? "USD",
            asOf: c.price_updated_at,
            kind: c.current_price_kind,
          },
  };
}

export function buildModelInput(args: {
  model: ModelRow;
  slots: SlotRow[];
  estimates: EstimateRow[];
  /** All cards of the sets referenced by the model (keyed by set id). */
  cardsBySet: Map<string, CardRow[]>;
  cardsById: Map<string, CardRow>;
  productSetId: string | null;
  currency: string;
}): PullModelInput {
  const packs = args.model.packs_per_product;
  const slots = [...args.slots].sort((a, b) => a.position - b.position);
  return {
    currency: args.currency,
    slots: slots.map((slot) => {
      const occurrences = slotOccurrences(slot, packs);
      const outcomes: OutcomeInput[] = args.estimates
        .filter((e) => e.slot_id === slot.id)
        .sort((a, b) => a.position - b.position)
        .map((e) => {
          const source = {
            type: e.source_type,
            name: e.source_name,
            url: e.source_url,
            sampleSize: e.sample_size,
            lastVerifiedAt: e.last_verified_at,
            confidence: e.confidence,
            notes: e.notes,
          };
          const probability = e.is_remainder
            ? null
            : toPerOccurrence(e.probability, e.probability_basis, occurrences, packs);
          if (e.outcome_kind === "card") {
            const card = e.card_id ? args.cardsById.get(e.card_id) : undefined;
            return {
              id: e.id,
              label: e.label,
              kind: "card" as const,
              probability,
              isRemainder: e.is_remainder,
              // A missing card row behaves like an empty pool (excluded, flagged).
              ...(card ? { card: toCardRef(card) } : { kind: "rarity_pool" as const, pool: [] }),
              source,
            };
          }
          const setId = e.set_id ?? args.productSetId;
          const pool = setId
            ? selectPoolCards(args.cardsBySet.get(setId) ?? [], e.rarities ?? [], e.printing).map(toCardRef)
            : [];
          return {
            id: e.id,
            label: e.label,
            kind: "rarity_pool" as const,
            probability,
            isRemainder: e.is_remainder,
            pool,
            source,
          };
        });
      return { id: slot.id, name: slot.name, kind: slot.kind, occurrences, outcomes };
    }),
  };
}
