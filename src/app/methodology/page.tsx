import type { Metadata } from "next";
import { DISCLAIMER, PageHeader } from "@/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Methodology" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm leading-relaxed text-muted [&_code]:text-fg [&_strong]:text-fg">{children}</CardContent>
    </Card>
  );
}

export default function MethodologyPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Methodology" description="How SealedEV estimates expected value, assigns confidence, and handles prices." />
      <Section title="Expected value">
        <p>
          A product is modelled as a set of <strong>slots</strong> (e.g. “rare slot × 36 packs”). Within a slot the
          possible outcomes are <strong>mutually exclusive</strong> and their probabilities add up to at most 1:
        </p>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs text-fg">{`EV(slot)    = occurrences × Σ  p(outcome) × value(outcome)
EV(product) = Σ over slots EV(slot)
Net return  = EV − purchase price − extra costs
Return %    = net return ÷ purchase price × 100
EV / price  = EV ÷ purchase price`}</pre>
        <p>
          A card can appear in several slots (duplicates are possible), but never in two outcomes of the same slot;
          the engine refuses such a model rather than count the card twice. EV is never the sum of all card prices in
          a set, and the “top five pulls” shown on product pages are for display only: the EV uses the full outcome
          distribution.
        </p>
        <p>
          <strong>Rarity pools.</strong> Where sources only report a rate per rarity (“1 in 87 packs has a Special
          Illustration Rare”), the outcome is valued at the <strong>average price of the priced cards</strong> of that
          rarity in the set, i.e. every card in the rarity is assumed equally likely. When evidence shows otherwise,
          the cards are listed individually instead. Per-card odds shown for top pulls use the same equal-likelihood
          assumption.
        </p>
        <p>
          <strong>Missing data is never filled in.</strong> An outcome with an unknown rate, or with no priced cards, is
          excluded and the result is labelled a <strong>partial estimate</strong>. If less than half of the slot
          probability is known, or less than half of it is priced, or the model is invalid, the product shows{" "}
          <strong>“Insufficient pull-rate data”</strong> instead of an EV.
        </p>
      </Section>
      <Section title="Pull-rate sources">
        <p>Every rate is stored with its source, sample size, date last checked and one of four labels:</p>
        <ul className="list-disc pl-5">
          <li><strong>Official</strong>: published by the manufacturer; a source link is required.</li>
          <li><strong>Community estimate</strong>: from public pack-opening samples (e.g. TCGplayer&apos;s pull-rate studies).</li>
          <li><strong>Assumption</strong>: entered by an administrator without a published source.</li>
          <li><strong>Unknown</strong>: no defensible rate; excluded from EV.</li>
        </ul>
        <p>
          The Pokémon Company does not publish pull rates, so Pokémon products here rely on community estimates. Those
          are never labelled official.
        </p>
      </Section>
      <Section title="Confidence labels">
        <p>These are documented rules of thumb, not statistically validated measures.</p>
        <ul className="list-disc pl-5">
          <li>
            <strong>High</strong>: every rate is official, every outcome is priced (≥ 95% of probability mass), the
            calculation is complete and prices are fresh.
          </li>
          <li>
            <strong>Medium</strong>: official or community rates carry ≥ 90% of the EV with no material low-confidence
            estimate, ≥ 95% of slot probability is known, ≥ 80% is priced and prices are not stale.
          </li>
          <li><strong>Low</strong>: an estimate can be shown but rests on sparse samples, assumptions or substantial gaps.</li>
          <li><strong>Insufficient data</strong>: no EV is shown.</li>
        </ul>
      </Section>
      <Section title="Prices">
        <p>
          Market prices are TCGplayer market prices (USD) from <a className="text-accent hover:underline" href="https://tcgcsv.com" rel="noreferrer">TCGCSV</a>,
          a free community mirror updated once a day. A scheduled job stores one snapshot per item per day; pages read
          those stored prices and never call a provider while rendering. Prices imported from CSV or entered manually
          are labelled as such. A price older than your staleness setting (default 3 days) is marked stale; if a
          provider is unavailable, the last known price stays in place with its original timestamp.
        </p>
        <p>
          Card prices are for ungraded, near-mint copies. There is no currency conversion: values in different
          currencies are reported separately.
        </p>
      </Section>
      <Section title="Collection valuation">
        <p>
          Each purchase is a separate lot. Cost basis = quantity × price paid + recorded fees, shipping and grading
          costs. Market value = quantity × latest market price (or your own manual valuation, which is labelled).
          Unrealized gain = market value − cost basis, and the percentage uses only lots that have a price. Lots
          without a usable price are counted in cost but flagged and left out of gain/loss.
        </p>
      </Section>
      <p className="text-xs text-subtle">{DISCLAIMER}</p>
    </div>
  );
}
