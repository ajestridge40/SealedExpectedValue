import { Decimal, ZERO, dec, decOrNull, sum } from "../money";
import { classifyConfidence, classifyPullRateConfidence, classifyStatus } from "./confidence";
import type {
  CardContribution,
  CardRef,
  EvIssue,
  EvOptions,
  EvResult,
  OutcomeInput,
  OutcomeResult,
  PricingFreshness,
  PullModelInput,
  SlotResult,
} from "./types";

const ONE = new Decimal(1);
const EPSILON = new Decimal("1e-9");

interface PricedValue {
  value: Decimal | null;
  stale: boolean;
  asOf: Date | null;
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Price of one card in the model currency, or null if unusable. */
function priceOf(card: CardRef, currency: string, now: Date, staleMs: number): PricedValue & { mismatch: boolean } {
  const amount = card.price ? decOrNull(card.price.amount) : null;
  if (!card.price || amount === null || amount.isNegative()) {
    return { value: null, stale: false, asOf: null, mismatch: false };
  }
  if (card.price.currency.toUpperCase() !== currency.toUpperCase()) {
    return { value: null, stale: false, asOf: null, mismatch: true };
  }
  const asOf = parseDate(card.price.asOf);
  // A price without a timestamp cannot be shown as current.
  const stale = asOf === null || now.getTime() - asOf.getTime() > staleMs;
  return { value: amount, stale, asOf, mismatch: false };
}

/**
 * Calculate the expected card value of opening one product.
 *
 * Model: a product is a set of independent slots, each occurring
 * `occurrences` times. Within a slot the outcomes are mutually exclusive, so
 *
 *   EV(slot)    = occurrences x sum_i( p_i x v_i )
 *   EV(product) = sum over slots of EV(slot)
 *
 * By linearity of expectation this holds whether or not slots are
 * statistically independent. A card may appear in several slots (duplicates
 * are possible), but never in two outcomes of the same slot: that would count
 * its value twice and is rejected as an error.
 *
 * A rarity-pool outcome is valued at the mean price of the priced cards in the
 * pool, i.e. it assumes each card in the pool is equally likely. When the
 * evidence says otherwise, list those cards as individual "card" outcomes and
 * remove them from the pool.
 */
export function calculateEv(model: PullModelInput, options: EvOptions = {}): EvResult {
  const now = options.now ?? new Date();
  const staleMs = (options.staleAfterHours ?? 72) * 3_600_000;
  const minPoolCoverage = options.minPoolPriceCoverage ?? 0.8;
  const currency = model.currency.toUpperCase();
  const issues: EvIssue[] = [];

  const slotResults: SlotResult[] = [];
  const contributions = new Map<
    string,
    { card: CardRef; expected: Decimal; ev: Decimal | null; pNone: number | null; basis: CardContribution["basis"] }
  >();
  const allAsOf: Date[] = [];
  let staleCount = 0;

  let occurrenceTotal = ZERO;
  let coveredMass = ZERO; // sum(occ x resolved probability)
  let valuedMass = ZERO; // sum(occ x probability x priced share)
  let evTotal = ZERO;
  let freshEv = ZERO;

  if (model.slots.length === 0) {
    issues.push({ level: "error", code: "no_slots", message: "The pull model has no slots." });
  }

  for (const slot of model.slots) {
    let occurrences: Decimal;
    try {
      occurrences = dec(slot.occurrences);
    } catch {
      occurrences = new Decimal(-1);
    }
    if (occurrences.isNegative()) {
      issues.push({
        level: "error",
        code: "invalid_occurrences",
        slotId: slot.id,
        message: `Slot "${slot.name}" has an invalid occurrence count.`,
      });
      continue;
    }

    // --- Resolve probabilities -------------------------------------------
    const resolved = new Map<string, Decimal | null>();
    let knownSum = ZERO;
    let unknownCount = 0;
    const remainders = slot.outcomes.filter((o) => o.isRemainder);
    if (remainders.length > 1) {
      issues.push({
        level: "error",
        code: "multiple_remainders",
        slotId: slot.id,
        message: `Slot "${slot.name}" has more than one remainder outcome.`,
      });
    }

    for (const o of slot.outcomes) {
      if (o.isRemainder) continue;
      const p = o.probability === null ? null : decOrNull(o.probability);
      if (o.probability !== null && (p === null || p.isNegative() || p.gt(ONE))) {
        issues.push({
          level: "error",
          code: "invalid_probability",
          slotId: slot.id,
          outcomeId: o.id,
          message: `"${o.label}" has a probability outside 0–1 for one slot occurrence.`,
        });
        resolved.set(o.id, null);
        continue;
      }
      if (p === null) {
        unknownCount++;
        issues.push({
          level: "warning",
          code: "missing_probability",
          slotId: slot.id,
          outcomeId: o.id,
          message: `No pull rate for "${o.label}" in "${slot.name}"; it is excluded from EV.`,
        });
      } else {
        knownSum = knownSum.plus(p);
      }
      resolved.set(o.id, p);
    }

    if (knownSum.gt(ONE.plus(EPSILON))) {
      issues.push({
        level: "error",
        code: "probability_exceeds_one",
        slotId: slot.id,
        message: `Outcome probabilities in "${slot.name}" add up to ${knownSum.toSignificantDigits(6)}, more than 1.`,
      });
    }

    for (const r of remainders) {
      if (unknownCount > 0) {
        issues.push({
          level: "warning",
          code: "unresolved_remainder",
          slotId: slot.id,
          outcomeId: r.id,
          message: `"${r.label}" takes the rest of "${slot.name}", but another outcome's rate is unknown.`,
        });
        resolved.set(r.id, null);
      } else {
        resolved.set(r.id, Decimal.max(ZERO, ONE.minus(knownSum)));
      }
    }

    // --- Double counting --------------------------------------------------
    const seen = new Map<string, string>();
    for (const o of slot.outcomes) {
      const cards = o.kind === "card" ? (o.card ? [o.card] : []) : (o.pool ?? []);
      const idsInOutcome = new Set<string>();
      for (const c of cards) {
        if (idsInOutcome.has(c.id)) continue; // a pool listing the same card twice is de-duplicated
        idsInOutcome.add(c.id);
        const prior = seen.get(c.id);
        if (prior !== undefined) {
          issues.push({
            level: "error",
            code: "double_counted_card",
            slotId: slot.id,
            outcomeId: o.id,
            message: `${c.name} appears in both "${prior}" and "${o.label}" in slot "${slot.name}"; its value would be counted twice.`,
          });
        } else {
          seen.set(c.id, o.label);
        }
      }
    }

    // --- Value outcomes ---------------------------------------------------
    const outcomeResults: OutcomeResult[] = [];
    let slotCovered = ZERO;
    for (const o of slot.outcomes) {
      const p = resolved.get(o.id) ?? null;
      const r = valueOutcome(o, currency, now, staleMs, minPoolCoverage, slot.id, issues);
      const expectedCount = p === null ? null : p.times(occurrences);
      const ev = expectedCount !== null && r.unitValue !== null ? expectedCount.times(r.unitValue) : null;

      if (p !== null) {
        slotCovered = slotCovered.plus(p);
        valuedMass = valuedMass.plus(
          r.totalCount === 0 ? ZERO : p.times(occurrences).times(r.pricedCount).div(r.totalCount),
        );
      }
      if (ev !== null) {
        evTotal = evTotal.plus(ev);
        const freshShare = r.pricedCount === 0 ? 0 : (r.pricedCount - r.staleCount) / r.pricedCount;
        freshEv = freshEv.plus(ev.times(freshShare));
      }
      staleCount += r.staleCount;
      allAsOf.push(...r.asOfs);

      outcomeResults.push({
        id: o.id,
        label: o.label,
        kind: o.kind,
        probability: p,
        expectedCount,
        unitValue: r.unitValue,
        ev,
        pricedCount: r.pricedCount,
        totalCount: r.totalCount,
        staleCount: r.staleCount,
        source: o.source,
      });

      // Per-card contributions (display + top-hit pull odds).
      const members = o.kind === "card" ? (o.card ? [o.card] : []) : dedupe(o.pool ?? []);
      for (const card of members) {
        const perOcc = p === null ? null : o.kind === "card" ? p : p.div(members.length);
        const price = priceOf(card, currency, now, staleMs).value;
        const existing = contributions.get(card.id) ?? {
          card,
          expected: ZERO,
          ev: ZERO as Decimal | null,
          pNone: 1 as number | null,
          basis: "exact" as CardContribution["basis"],
        };
        if (perOcc === null) {
          existing.pNone = null;
        } else {
          existing.expected = existing.expected.plus(perOcc.times(occurrences));
          if (existing.pNone !== null) {
            existing.pNone *= Math.pow(1 - perOcc.toNumber(), occurrences.toNumber());
          }
        }
        existing.ev =
          existing.ev === null || price === null || perOcc === null
            ? null
            : existing.ev.plus(perOcc.times(occurrences).times(price));
        if (o.kind === "rarity_pool") existing.basis = "pool_uniform";
        contributions.set(card.id, existing);
      }
    }

    const slotEv = sum(outcomeResults.map((o) => o.ev ?? ZERO));
    occurrenceTotal = occurrenceTotal.plus(occurrences);
    coveredMass = coveredMass.plus(Decimal.min(slotCovered, ONE).times(occurrences));
    slotResults.push({
      id: slot.id,
      name: slot.name,
      kind: slot.kind,
      occurrences,
      ev: slotEv,
      probabilityCovered: Decimal.min(slotCovered, ONE),
      outcomes: outcomeResults,
    });
  }

  const probabilityCoverage = occurrenceTotal.isZero() ? 0 : coveredMass.div(occurrenceTotal).toNumber();
  const priceCoverage = coveredMass.isZero() ? 0 : valuedMass.div(coveredMass).toNumber();

  const freshShare = evTotal.isZero() ? 0 : freshEv.div(evTotal).toNumber();
  const sortedDates = allAsOf.sort((a, b) => a.getTime() - b.getTime());
  const freshness: PricingFreshness = {
    label: evTotal.isZero() ? "unknown" : freshShare >= 0.95 ? "fresh" : freshShare >= 0.5 ? "aging" : "stale",
    freshShare,
    staleCount,
    oldestAsOf: sortedDates[0] ?? null,
    newestAsOf: sortedDates[sortedDates.length - 1] ?? null,
  };
  if (staleCount > 0) {
    issues.push({
      level: "warning",
      code: "stale_price",
      message: `${staleCount} card price${staleCount === 1 ? " is" : "s are"} older than ${options.staleAfterHours ?? 72} hours or undated.`,
    });
  }

  const status = classifyStatus({ issues, probabilityCoverage, priceCoverage, slotResults });
  if (status === "insufficient" && (probabilityCoverage < 0.5 || priceCoverage < 0.5) && model.slots.length > 0) {
    issues.push({
      level: "warning",
      code: "low_coverage",
      message: `Only ${(probabilityCoverage * 100).toFixed(0)}% of pull probability is known and ${(priceCoverage * 100).toFixed(0)}% of it is priced.`,
    });
  }
  const pullRateConfidence = classifyPullRateConfidence(slotResults, status);
  const confidence = classifyConfidence({
    status,
    pullRateConfidence,
    probabilityCoverage,
    priceCoverage,
    freshness: freshness.label,
  });

  const cards: CardContribution[] = [...contributions.values()].map((c) => ({
    card: c.card,
    expectedCount: c.expected,
    probabilityAtLeastOne: c.pNone === null ? null : 1 - c.pNone,
    ev: c.ev,
    basis: c.basis,
  }));

  return {
    status,
    currency,
    grossEv: status === "insufficient" ? null : evTotal,
    computedEv: evTotal,
    slots: slotResults,
    probabilityCoverage,
    priceCoverage,
    pullRateConfidence,
    confidence,
    freshness,
    cards,
    issues,
  };
}

function dedupe(cards: CardRef[]): CardRef[] {
  const map = new Map<string, CardRef>();
  for (const c of cards) if (!map.has(c.id)) map.set(c.id, c);
  return [...map.values()];
}

function valueOutcome(
  o: OutcomeInput,
  currency: string,
  now: Date,
  staleMs: number,
  minPoolCoverage: number,
  slotId: string,
  issues: EvIssue[],
): { unitValue: Decimal | null; pricedCount: number; totalCount: number; staleCount: number; asOfs: Date[] } {
  const members = o.kind === "card" ? (o.card ? [o.card] : []) : dedupe(o.pool ?? []);
  if (members.length === 0) {
    issues.push({
      level: "warning",
      code: "empty_pool",
      slotId,
      outcomeId: o.id,
      message: `"${o.label}" has no cards in the catalog yet; it is excluded from EV.`,
    });
    return { unitValue: null, pricedCount: 0, totalCount: 0, staleCount: 0, asOfs: [] };
  }

  const values: Decimal[] = [];
  const asOfs: Date[] = [];
  let staleCount = 0;
  let mismatch = 0;
  for (const card of members) {
    const p = priceOf(card, currency, now, staleMs);
    if (p.mismatch) mismatch++;
    if (p.value === null) continue;
    values.push(p.value);
    if (p.stale) staleCount++;
    if (p.asOf) asOfs.push(p.asOf);
  }
  if (mismatch > 0) {
    issues.push({
      level: "warning",
      code: "currency_mismatch",
      slotId,
      outcomeId: o.id,
      message: `${mismatch} card price(s) in "${o.label}" are not in ${currency} and were ignored (no currency conversion is applied).`,
    });
  }

  if (values.length === 0) {
    issues.push({
      level: "warning",
      code: "missing_price",
      slotId,
      outcomeId: o.id,
      message: `No current price for any card in "${o.label}"; it is excluded from EV.`,
    });
    return { unitValue: null, pricedCount: 0, totalCount: members.length, staleCount: 0, asOfs };
  }

  const coverage = values.length / members.length;
  if (o.kind === "rarity_pool" && coverage < minPoolCoverage) {
    issues.push({
      level: "warning",
      code: "low_pool_coverage",
      slotId,
      outcomeId: o.id,
      message: `Only ${values.length} of ${members.length} cards in "${o.label}" have prices; the pool average uses the priced cards only.`,
    });
  }

  return {
    unitValue: sum(values).div(values.length),
    pricedCount: values.length,
    totalCount: members.length,
    staleCount,
    asOfs,
  };
}
