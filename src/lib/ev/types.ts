import type { Decimal, DecimalInput } from "../money";

export type PullRateSourceType = "official" | "community" | "user_assumption" | "unknown";
export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";
export type PriceKind = "provider" | "csv_import" | "manual";

export interface PricePoint {
  amount: DecimalInput | null;
  currency: string;
  /** When the price was observed (provider timestamp or entry time). */
  asOf: Date | string | null;
  kind?: PriceKind | null;
  sourceName?: string | null;
}

export interface CardRef {
  id: string;
  name: string;
  number?: string | null;
  rarity?: string | null;
  printing?: string | null;
  imageUrl?: string | null;
  price: PricePoint | null;
}

export interface OutcomeSource {
  type: PullRateSourceType;
  name?: string | null;
  url?: string | null;
  sampleSize?: number | null;
  lastVerifiedAt?: string | null;
  /** Curator's confidence in this particular estimate. */
  confidence?: ConfidenceLevel | null;
  notes?: string | null;
}

/**
 * One mutually exclusive outcome of a slot. `probability` is the chance that a
 * single occurrence of the slot produces this outcome (convert per-pack or
 * per-box rates with toPerOccurrence() in model.ts before calling the engine).
 */
export interface OutcomeInput {
  id: string;
  label: string;
  kind: "card" | "rarity_pool";
  probability: DecimalInput | null;
  /** Takes whatever probability the slot's other outcomes leave. */
  isRemainder?: boolean;
  card?: CardRef;
  pool?: CardRef[];
  source: OutcomeSource;
}

/**
 * An independent slot. Outcomes inside a slot are mutually exclusive; slots
 * are summed. `occurrences` is how many times the slot appears in one product
 * (e.g. 36 packs x 1 rare slot = 36).
 */
export interface SlotInput {
  id: string;
  name: string;
  kind: "random" | "guaranteed";
  occurrences: DecimalInput;
  outcomes: OutcomeInput[];
}

export interface PullModelInput {
  currency: string;
  slots: SlotInput[];
}

export interface EvOptions {
  now?: Date;
  /** Prices older than this are stale (default 72h). */
  staleAfterHours?: number;
  /** Pools with a smaller share of priced cards make the result partial (default 0.8). */
  minPoolPriceCoverage?: number;
}

export type IssueLevel = "error" | "warning";

export interface EvIssue {
  level: IssueLevel;
  code:
    | "invalid_occurrences"
    | "invalid_probability"
    | "probability_exceeds_one"
    | "multiple_remainders"
    | "unresolved_remainder"
    | "missing_probability"
    | "double_counted_card"
    | "empty_pool"
    | "missing_price"
    | "low_pool_coverage"
    | "stale_price"
    | "currency_mismatch"
    | "no_slots"
    | "low_coverage";
  message: string;
  slotId?: string;
  outcomeId?: string;
}

export interface OutcomeResult {
  id: string;
  label: string;
  kind: OutcomeInput["kind"];
  /** Resolved per-occurrence probability (null when unknown). */
  probability: Decimal | null;
  /** Expected number of times this outcome appears in one product. */
  expectedCount: Decimal | null;
  /** Value of one pull of this outcome (pool: mean of priced cards). */
  unitValue: Decimal | null;
  ev: Decimal | null;
  pricedCount: number;
  totalCount: number;
  staleCount: number;
  source: OutcomeSource;
}

export interface SlotResult {
  id: string;
  name: string;
  kind: SlotInput["kind"];
  occurrences: Decimal;
  ev: Decimal;
  /** Sum of resolved probabilities (0..1). */
  probabilityCovered: Decimal;
  outcomes: OutcomeResult[];
}

export interface CardContribution {
  card: CardRef;
  /** Expected copies per product. */
  expectedCount: Decimal;
  /** Chance of at least one copy per product (null when a probability is unknown). */
  probabilityAtLeastOne: number | null;
  ev: Decimal | null;
  /** "exact" = listed individually; "pool_uniform" = pool rate split evenly. */
  basis: "exact" | "pool_uniform";
}

export interface PricingFreshness {
  label: "fresh" | "aging" | "stale" | "unknown";
  /** EV-weighted share of value backed by non-stale prices (0..1). */
  freshShare: number;
  staleCount: number;
  oldestAsOf: Date | null;
  newestAsOf: Date | null;
}

export interface EvResult {
  status: "complete" | "partial" | "insufficient";
  currency: string;
  /** Gross expected card value per product. Null when status is insufficient. */
  grossEv: Decimal | null;
  /** Like grossEv but also reported when insufficient, for diagnostics only. */
  computedEv: Decimal;
  slots: SlotResult[];
  /** Occurrence-weighted share of slot probability that is known (0..1). */
  probabilityCoverage: number;
  /** Share of known probability mass whose value is priced (0..1). */
  priceCoverage: number;
  pullRateConfidence: ConfidenceLevel;
  confidence: ConfidenceLevel;
  freshness: PricingFreshness;
  cards: CardContribution[];
  issues: EvIssue[];
}
