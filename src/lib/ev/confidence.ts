import { ZERO } from "../money";
import type { ConfidenceLevel, EvIssue, EvResult, PricingFreshness, PullRateSourceType, SlotResult } from "./types";

/*
 * Confidence rules. These are documented heuristics, not statistically
 * validated measures. The same rules are described in docs/EV_METHODOLOGY.md
 * and on the /methodology page; keep all three in sync.
 */

const PARTIAL_CODES = new Set<EvIssue["code"]>([
  "missing_probability",
  "unresolved_remainder",
  "empty_pool",
  "missing_price",
  "low_pool_coverage",
  "currency_mismatch",
]);

/**
 * insufficient  model invalid (any error), or < 50% of slot probability known,
 *               or < 50% of the known probability mass priced.
 * partial       anything missing: a rate, a price, a pool below coverage, or
 *               slot probabilities that do not reach 100%.
 * complete      every outcome has a rate and a value.
 */
export function classifyStatus(input: {
  issues: EvIssue[];
  probabilityCoverage: number;
  priceCoverage: number;
  slotResults: SlotResult[];
}): EvResult["status"] {
  if (input.issues.some((i) => i.level === "error")) return "insufficient";
  if (input.slotResults.length === 0) return "insufficient";
  if (input.probabilityCoverage < 0.5 || input.priceCoverage < 0.5) return "insufficient";
  if (input.probabilityCoverage < 0.999) return "partial";
  if (input.issues.some((i) => PARTIAL_CODES.has(i.code))) return "partial";
  return "complete";
}

const RANK: Record<ConfidenceLevel, number> = { insufficient: 0, low: 1, medium: 2, high: 3 };
const BY_RANK: ConfidenceLevel[] = ["insufficient", "low", "medium", "high"];

export function minConfidence(...levels: ConfidenceLevel[]): ConfidenceLevel {
  return BY_RANK[Math.min(...levels.map((l) => RANK[l]))];
}

/**
 * Pull-rate confidence, weighted by each outcome's share of EV so that a rough
 * guess for bulk commons does not drag down a well-sourced hit table (and vice
 * versa).
 *
 * high    every outcome with a non-zero rate is "official" (published by the
 *         manufacturer, with a source URL).
 * medium  official + community estimates carry >= 90% of EV and no outcome
 *         contributing >= 5% of EV is marked low-confidence by its curator.
 * low     anything else (user assumptions, unknown sources, sparse samples).
 */
export function classifyPullRateConfidence(slots: SlotResult[], status: EvResult["status"]): ConfidenceLevel {
  if (status === "insufficient") return "insufficient";
  const outcomes = slots.flatMap((s) => s.outcomes).filter((o) => o.probability && !o.probability.isZero());
  if (outcomes.length === 0) return "insufficient";

  const total = outcomes.reduce((acc, o) => acc.plus(o.ev ?? ZERO), ZERO);
  const share = (types: PullRateSourceType[]) =>
    total.isZero()
      ? 0
      : outcomes
          .filter((o) => types.includes(o.source.type))
          .reduce((acc, o) => acc.plus(o.ev ?? ZERO), ZERO)
          .div(total)
          .toNumber();

  if (outcomes.every((o) => o.source.type === "official")) return "high";

  const weakMaterial = outcomes.some(
    (o) =>
      (o.source.confidence === "low" || o.source.confidence === "insufficient") &&
      !total.isZero() &&
      (o.ev ?? ZERO).div(total).toNumber() >= 0.05,
  );
  if (share(["official", "community"]) >= 0.9 && !weakMaterial) return "medium";
  return "low";
}

/**
 * Overall confidence label shown next to an EV.
 *
 * high    pull rates high, status complete, >= 95% priced, prices fresh.
 * medium  pull rates at least medium, >= 95% of probability known,
 *         >= 80% priced, prices not stale.
 * low     an EV can be shown but with substantial gaps.
 * insufficient  no EV is shown.
 */
export function classifyConfidence(input: {
  status: EvResult["status"];
  pullRateConfidence: ConfidenceLevel;
  probabilityCoverage: number;
  priceCoverage: number;
  freshness: PricingFreshness["label"];
}): ConfidenceLevel {
  if (input.status === "insufficient") return "insufficient";
  if (
    input.pullRateConfidence === "high" &&
    input.status === "complete" &&
    input.priceCoverage >= 0.95 &&
    input.freshness === "fresh"
  ) {
    return "high";
  }
  if (
    RANK[input.pullRateConfidence] >= RANK.medium &&
    input.probabilityCoverage >= 0.95 &&
    input.priceCoverage >= 0.8 &&
    input.freshness !== "stale" &&
    input.freshness !== "unknown"
  ) {
    return "medium";
  }
  return "low";
}
