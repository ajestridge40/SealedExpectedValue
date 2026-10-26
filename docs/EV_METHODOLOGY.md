# EV methodology

The calculation engine lives in `src/lib/ev/` and has no dependency on the UI, the database client or any pricing
provider. Tests: `src/lib/ev/*.test.ts`. The `/methodology` page explains the same rules to users.

## Model

A product's **pull model** (`product_pull_models`) is a list of independent **slots** (`pull_model_slots`). Each slot
occurs a number of times per product: `occurrences_per_pack × packs_per_product` or `occurrences_per_product`. A slot
has mutually exclusive **outcomes** (`pull_rate_estimates`), each either:

- a specific **card**, or
- a **rarity pool**: all cards in a set with the given rarities, optionally restricted to one printing
  (`Reverse Holofoil`) and/or by name (`name_contains`, `name_excludes`, e.g. pattern variants).

Within one slot, probabilities must add up to at most 1. One outcome may be marked `is_remainder` and takes
`1 − Σ(other outcomes)`.

```
EV(slot)    = occurrences × Σ p(outcome) × value(outcome)
EV(product) = Σ EV(slot)
Net EV      = EV − purchase price − extra costs
Return %    = Net EV ÷ purchase price × 100
EV / price  = EV ÷ purchase price
```

This is linearity of expectation: it holds whether or not slots are statistically independent. Gross EV and net return
are computed separately (`calculateEv` vs `calculateReturns`); changing the purchase price never changes EV.

### Probability basis

Stored probabilities are converted to a per-slot-occurrence probability (`toPerOccurrence`):

| basis      | meaning                    | per occurrence            |
| ---------- | -------------------------- | ------------------------- |
| `per_slot` | chance for one slot        | `p`                       |
| `per_pack` | expected count per pack    | `p × packs / occurrences` |
| `per_box`  | expected count per product | `p / occurrences`         |

Published “1 in 87 packs” rates are `per_pack` with `p = 1/87`.

### Values

- Card outcome: the card's latest stored market price.
- Rarity pool: the **mean price of the priced cards** in the pool. This assumes every card in the rarity is equally
  likely. Where evidence says otherwise, list those cards as individual card outcomes and remove them from the pool.
- When a pool names no printing, one printing per card is used (Holofoil, then Normal; reverse holos last) so a card is
  never in a pool twice.
- Prices in another currency than the product's are ignored (no FX conversion) and flagged.

### Double counting

A card may appear in several slots (duplicates are possible), but **never in two outcomes of the same slot**. The
engine reports `double_counted_card` as an error and declines to produce an EV. A pool that contains the same card row
twice is de-duplicated. EV is never the sum of all card prices in a set.

### Missing data

| situation                                   | handling                                                     |
| ------------------------------------------- | ------------------------------------------------------------ |
| outcome rate unknown (`probability = null`) | excluded; remainder in that slot cannot be resolved; partial |
| no priced card in an outcome                | excluded; partial                                            |
| pool less than 80% priced                   | averaged over priced cards; partial                          |
| price older than the stale window / undated | used, flagged, lowers freshness and confidence               |
| probabilities > 1 in a slot, invalid values | error → insufficient                                         |
| < 50% of slot probability known or priced   | insufficient: no EV is shown                                 |

`status` is `complete`, `partial` (EV shown, labelled “Partial estimate”, likely understated) or `insufficient` (UI
shows “Insufficient pull-rate data”).

## Confidence rules

Heuristics, not statistically validated measures. Implemented in `src/lib/ev/confidence.ts`.

**Pull-rate confidence** (weighted by each outcome's share of EV):

- **High**: every outcome with a non-zero rate is `official` (database requires a source URL for official rates).
- **Medium**: official + community estimates carry ≥ 90% of EV, and no outcome carrying ≥ 5% of EV is marked low
  confidence by its curator.
- **Low**: anything else (assumptions, unknown sources, small samples).
- **Insufficient**: status insufficient.

**Overall confidence**:

- **High**: pull-rate confidence high, status complete, ≥ 95% of probability mass priced, prices fresh.
- **Medium**: pull-rate confidence ≥ medium, ≥ 95% of slot probability known, ≥ 80% priced, prices not stale.
- **Low**: an EV can be shown but with substantial gaps.
- **Insufficient**: no EV.

Freshness: `fresh` when ≥ 95% of EV is backed by prices inside the stale window (default 72 h, user-configurable),
`aging` at ≥ 50%, otherwise `stale`.

## Seeded models

`supabase/seed.sql` contains models for Surging Sparks (booster box, ETB, bundle) and Prismatic Evolutions (ETB,
bundle). The Pokémon Company does not publish pull rates; hit rates come from TCGplayer's published pack-opening studies
(Surging Sparks: 8,000+ packs with 95% confidence intervals; Prismatic Evolutions: ~1,200 packs) and are labelled
**community**. Pack composition (4 commons, 3 uncommons, 1 rare slot, 2 reverse-holo slots) is labelled as community
documentation. Prismatic Evolutions has no sourced Double Rare rate, so it is intentionally a **partial** estimate.

Slot assignment of hits (e.g. which reverse-holo slot an Illustration Rare replaces) only changes which low-value filler
card is displaced; the EV is driven by the per-pack rates.

## Not modelled

- Liquidation costs (marketplace fees, shipping, grading) and the spread between market and realizable price.
- God packs / special pack variants beyond their contribution to published averages.
- Promo cards and accessories in ETBs (excluded; noted in model assumptions).
- Variance. EV is a long-run average; individual boxes vary widely.
