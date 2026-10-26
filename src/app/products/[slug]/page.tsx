import { AlertTriangle, ExternalLink, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfidenceBadge, EvStatusBadge, FreshnessBadge, PriceKindBadge, SourceTypeBadge } from "@/components/badges";
import { CatalogImage } from "@/components/catalog-image";
import { EvBreakdown } from "@/components/ev-breakdown";
import { ManualPriceForm } from "@/components/manual-price-form";
import { Money, Percent } from "@/components/money";
import { Notice } from "@/components/page";
import { PriceChart } from "@/components/price-chart";
import { ScenarioCalculator } from "@/components/scenario-calculator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { WatchButton } from "@/components/watch-button";
import { getProfile, getUser, staleAfterHours } from "@/lib/auth";
import { getDataSources, getGames, getPriceHistory, getProductBySlug, getSets } from "@/lib/data/catalog";
import { getProductEvs } from "@/lib/data/ev";
import { PRODUCT_TYPE_LABELS } from "@/lib/data/types";
import { isWatching } from "@/lib/data/user";
import type { CardContribution, EvResult, OutcomeSource } from "@/lib/ev";
import { formatMoney, formatRatio } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  return { title: product?.name ?? "Product not found" };
}

function chanceLabel(c: CardContribution, unit: string) {
  if (c.probabilityAtLeastOne === null) return "Pull rate unknown";
  const p = c.probabilityAtLeastOne;
  if (p <= 0) return "Not in this product";
  if (p >= 0.995) return `≈ every ${unit}`;
  return `${(p * 100).toFixed(p < 0.1 ? 2 : 1)}% per ${unit} (≈1 in ${Math.max(1, Math.round(1 / p)).toLocaleString()})`;
}

function distinctSources(ev: EvResult): OutcomeSource[] {
  const map = new Map<string, OutcomeSource>();
  for (const o of ev.slots.flatMap((s) => s.outcomes)) {
    const key = `${o.source.type}|${o.source.name ?? ""}|${o.source.url ?? ""}`;
    if (!map.has(key)) map.set(key, o.source);
  }
  return [...map.values()];
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const path = `/products/${product.slug}`;
  const [evs, history, sources, sets, games, user, profile, watching, stale] = await Promise.all([
    getProductEvs([product.id]),
    getPriceHistory({ productId: product.id }),
    getDataSources(),
    getSets(),
    getGames(),
    getUser(),
    getProfile(),
    isWatching("sealed", product.id),
    staleAfterHours(),
  ]);
  const pe = evs.get(product.id)!;
  const ev = pe.ev;
  const set = sets.find((s) => s.id === product.set_id);
  const game = games.find((g) => g.id === product.game_id);
  const currency = product.current_price_currency ?? "USD";
  const source = product.current_price_source_id ? sources.get(product.current_price_source_id) : undefined;
  const showEv = ev && ev.status !== "insufficient";

  const topCards = (ev?.cards ?? [])
    .filter((c) => c.card.price?.amount != null && (c.probabilityAtLeastOne === null || c.probabilityAtLeastOne > 0))
    .sort((a, b) => Number(b.card.price!.amount) - Number(a.card.price!.amount))
    .slice(0, 5);
  const allCards = (ev?.cards ?? []).slice().sort((a, b) => (b.ev?.toNumber() ?? -1) - (a.ev?.toNumber() ?? -1));
  const unit = product.product_type === "booster_pack" ? "pack" : "product";

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-muted text-xs">
        <Link href="/products" className="hover:text-fg">
          Sealed products
        </Link>{" "}
        / <span className="text-fg">{product.name}</span>
      </nav>

      {/* Header */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="p-4">
          <CatalogImage
            src={product.image_url?.replace("_200w", "_400w")}
            alt={product.name}
            aspect="square"
            className="bg-transparent"
          />
        </Card>
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-muted flex flex-wrap gap-1.5 text-xs">
              <span>{game?.name}</span>·<span>{PRODUCT_TYPE_LABELS[product.product_type]}</span>
              {product.release_date ? (
                <>
                  ·<span>Released {formatDate(product.release_date)}</span>
                </>
              ) : null}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{product.name}</h1>
            {set ? <p className="text-muted text-sm">Set: {set.name}</p> : null}
            {product.description ? <p className="text-muted mt-3 max-w-2xl text-sm">{product.description}</p> : null}
            {product.pack_configuration ? (
              <p className="text-muted mt-1 text-sm">
                <span className="text-fg">Contents:</span> {product.pack_configuration}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border-border bg-surface rounded-lg border p-3">
              <div className="text-muted text-xs">Market price</div>
              <div className="text-xl font-semibold">
                <Money value={product.current_price} currency={currency} />
              </div>
            </div>
            <div className="border-border bg-surface rounded-lg border p-3">
              <div className="text-muted text-xs">Est. gross EV</div>
              <div className="text-xl font-semibold">
                {showEv ? <Money value={ev!.grossEv} currency={currency} /> : "—"}
              </div>
            </div>
            <div className="border-border bg-surface rounded-lg border p-3">
              <div className="text-muted text-xs">Est. net return</div>
              <div className="text-xl font-semibold">
                <Money value={pe.returns.netEv} currency={currency} signed />
              </div>
              <div className="text-xs">
                <Percent value={pe.returns.netReturnPct} />
              </div>
            </div>
            <div className="border-border bg-surface rounded-lg border p-3">
              <div className="text-muted text-xs">EV / price</div>
              <div className="tabular text-xl font-semibold">{formatRatio(pe.returns.evToPrice)}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <EvStatusBadge status={ev ? ev.status : "no_model"} />
            {ev && ev.status !== "insufficient" ? <ConfidenceBadge level={ev.confidence} /> : null}
            <PriceKindBadge kind={product.current_price_kind} sourceName={source?.name} />
            <FreshnessBadge asOf={product.price_updated_at} staleAfterHours={stale} />
            {product.is_sample ? <Badge tone="warn">Sample data</Badge> : null}
          </div>
          <p className="text-subtle text-xs">
            Last price update: {formatDateTime(product.price_updated_at)}
            {source ? ` · ${source.name}` : ""}
            {product.tcgplayer_product_id ? (
              <>
                {" · "}
                <a
                  className="hover:text-fg inline-flex items-center gap-1"
                  href={`https://www.tcgplayer.com/product/${product.tcgplayer_product_id}`}
                  rel="noreferrer nofollow"
                  target="_blank"
                >
                  View on TCGplayer <ExternalLink className="size-3" />
                </a>
              </>
            ) : null}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <Link
                href={
                  user ? `/collection/add?type=sealed&item=${product.id}` : `/login?next=${encodeURIComponent(path)}`
                }
              >
                <Plus /> Add to collection
              </Link>
            </Button>
            <WatchButton kind="sealed" id={product.id} path={path} watching={watching} signedIn={Boolean(user)} />
            <Button asChild variant="ghost">
              <Link href={`/compare?ids=${product.id}`}>Compare</Link>
            </Button>
          </div>
        </div>
      </div>

      <Notice tone="warn">
        <AlertTriangle className="mr-1 inline size-4 align-text-bottom" aria-hidden />
        EV is a long-run statistical average from estimated pull rates and current single-card prices. A single box
        usually returns much less or much more, and selling cards costs fees and time that EV does not include.
      </Notice>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Price history</CardTitle>
            <CardDescription>
              Daily snapshots stored by SealedEV. Imported and manual prices are labelled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PriceChart
              currency={currency}
              points={history
                .filter((h) => h.currency === currency)
                .map((h) => ({
                  t: h.provider_as_of ?? h.captured_at,
                  price: Number(h.market_price),
                  kind: h.source_kind,
                }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Scenario calculator</CardTitle>
            <CardDescription>
              Try different purchase prices. The underlying EV and market data do not change.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScenarioCalculator
              ev={showEv ? ev!.grossEv!.toFixed(2) : null}
              currency={currency}
              marketPrice={product.current_price === null ? null : String(product.current_price)}
            />
          </CardContent>
        </Card>
      </div>

      {/* Top hits */}
      <Card>
        <CardHeader>
          <CardTitle>Top five most valuable pulls</CardTitle>
          <CardDescription>
            For display only. EV uses every outcome in the model, not just these cards. Per-card odds inside a rarity
            assume every card of that rarity is equally likely.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topCards.length === 0 ? (
            <p className="text-muted text-sm">
              No priced cards are linked to this product&apos;s pull model yet. Run the catalog import and price
              refresh.
            </p>
          ) : (
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {topCards.map((c, i) => (
                <li key={c.card.id} className="flex flex-col gap-2">
                  <Link href={`/cards/${c.card.id}`} className="group">
                    <div className="relative">
                      <CatalogImage src={c.card.imageUrl?.replace("_200w", "_400w")} alt={c.card.name} />
                      <span className="bg-bg/85 text-accent absolute top-1.5 left-1.5 rounded px-1.5 text-xs font-semibold">
                        #{i + 1}
                      </span>
                    </div>
                    <div className="group-hover:text-accent mt-2 text-sm font-medium">{c.card.name}</div>
                  </Link>
                  <div className="text-muted text-xs">
                    {c.card.rarity}
                    {c.card.number ? ` · ${c.card.number}` : ""}
                  </div>
                  <div className="text-sm font-semibold">
                    <Money value={c.card.price?.amount} currency={c.card.price?.currency} />
                  </div>
                  <div className="text-muted text-xs">{chanceLabel(c, unit)}</div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* EV calculation */}
      <Card>
        <CardHeader>
          <CardTitle>How this EV is calculated</CardTitle>
          <CardDescription>
            EV = Σ over slots of (occurrences × Σ probability × value). Outcomes within a slot are mutually exclusive.{" "}
            <Link href="/methodology" className="text-accent hover:underline">
              Full methodology
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!ev ? (
            <Notice tone="info">No pull-rate model has been entered for this product, so no EV is shown.</Notice>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted text-xs">Pull-rate confidence</dt>
                  <dd className="mt-1">
                    <ConfidenceBadge level={ev.pullRateConfidence} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted text-xs">Probability known</dt>
                  <dd className="mt-1 font-medium">{(ev.probabilityCoverage * 100).toFixed(1)}%</dd>
                </div>
                <div>
                  <dt className="text-muted text-xs">Probability mass priced</dt>
                  <dd className="mt-1 font-medium">{(ev.priceCoverage * 100).toFixed(1)}%</dd>
                </div>
                <div>
                  <dt className="text-muted text-xs">Pricing freshness</dt>
                  <dd className="mt-1 font-medium capitalize">
                    {ev.freshness.label}
                    {ev.freshness.staleCount ? (
                      <span className="text-warn text-xs"> · {ev.freshness.staleCount} stale</span>
                    ) : null}
                  </dd>
                </div>
              </dl>

              {ev.status === "insufficient" ? (
                <Notice tone="warn">
                  Insufficient pull-rate data: no EV is shown. The partial calculation below totals{" "}
                  {formatMoney(ev.computedEv, currency)} and is for diagnosis only.
                </Notice>
              ) : ev.status === "partial" ? (
                <Notice tone="warn">
                  Partial estimate: some outcomes lack a rate or a price and are excluded, so the true EV is likely
                  higher than shown.
                </Notice>
              ) : null}

              {ev.issues.length ? (
                <details className="border-border rounded-lg border p-3 text-sm">
                  <summary className="text-muted cursor-pointer">{ev.issues.length} data note(s)</summary>
                  <ul className="text-muted mt-2 list-disc space-y-1 pl-5">
                    {ev.issues.map((i, n) => (
                      <li key={n} className={i.level === "error" ? "text-loss" : undefined}>
                        {i.message}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {pe.model ? (
                <div className="bg-surface-2 rounded-lg p-3 text-sm">
                  <div className="font-medium">
                    {pe.model.name}{" "}
                    <span className="text-muted text-xs font-normal">
                      v{pe.model.version} · {pe.model.packs_per_product} packs
                    </span>
                  </div>
                  {pe.model.description ? <p className="text-muted mt-1">{pe.model.description}</p> : null}
                  {pe.model.assumptions ? (
                    <p className="text-muted mt-1">
                      <span className="text-fg">Assumptions:</span> {pe.model.assumptions}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <EvBreakdown ev={ev} />

              <section>
                <h3 className="mb-2 text-sm font-medium">Pull-rate sources</h3>
                <ul className="flex flex-col gap-2 text-sm">
                  {distinctSources(ev).map((s, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <SourceTypeBadge type={s.type} />
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer nofollow"
                          className="text-accent hover:underline"
                        >
                          {s.name ?? s.url}
                        </a>
                      ) : (
                        <span>{s.name ?? "Unsourced"}</span>
                      )}
                      {s.sampleSize ? (
                        <span className="text-muted text-xs">sample ≈ {s.sampleSize.toLocaleString()} packs</span>
                      ) : null}
                      {s.lastVerifiedAt ? (
                        <span className="text-muted text-xs">checked {formatDate(s.lastVerifiedAt)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="text-subtle mt-2 text-xs">
                  Community estimates come from public pack-opening samples; they are not probabilities published by the
                  manufacturer.
                </p>
              </section>

              <details className="border-border rounded-lg border">
                <summary className="cursor-pointer p-3 text-sm font-medium">
                  All {allCards.length} cards included in the calculation
                </summary>
                <Table>
                  <thead>
                    <tr>
                      <Th>Card</Th>
                      <Th>Rarity</Th>
                      <Th>Printing</Th>
                      <Th>Price</Th>
                      <Th>Expected per {unit}</Th>
                      <Th>EV contribution</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {allCards.slice(0, 400).map((c) => (
                      <tr key={c.card.id}>
                        <Td>
                          <Link href={`/cards/${c.card.id}`} className="hover:text-accent">
                            {c.card.name}
                          </Link>{" "}
                          <span className="text-subtle text-xs">{c.card.number}</span>
                        </Td>
                        <Td className="text-muted">{c.card.rarity}</Td>
                        <Td className="text-muted">{c.card.printing}</Td>
                        <Td>
                          {c.card.price ? (
                            <Money value={c.card.price.amount} currency={c.card.price.currency} />
                          ) : (
                            <span className="text-muted">no price</span>
                          )}
                        </Td>
                        <Td>{c.expectedCount.toDecimalPlaces(4).toString()}</Td>
                        <Td>{c.ev ? formatMoney(c.ev, currency) : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {allCards.length > 400 ? (
                  <p className="text-muted p-3 text-xs">Showing the 400 largest contributions.</p>
                ) : null}
              </details>
            </>
          )}
        </CardContent>
      </Card>

      {profile?.is_admin ? (
        <Card>
          <CardHeader>
            <CardTitle>Admin: record a manual price</CardTitle>
            <CardDescription>Stored as a manual price snapshot and labelled as such everywhere.</CardDescription>
          </CardHeader>
          <CardContent>
            <ManualPriceForm kind="sealed" id={product.id} path={path} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
