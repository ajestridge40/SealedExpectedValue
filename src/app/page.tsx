import { ArrowRight, Calculator, Library, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";
import { FreshnessBadge } from "@/components/badges";
import { CatalogImage } from "@/components/catalog-image";
import { Money, Percent } from "@/components/money";
import { Notice, Stat } from "@/components/page";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUser, staleAfterHours } from "@/lib/auth";
import { getLastRefresh } from "@/lib/data/catalog";
import { getCollection } from "@/lib/data/collection";
import { getProductSummaries } from "@/lib/data/products";
import { filterProducts } from "@/lib/data/summaries";
import { groupPositions } from "@/lib/portfolio/valuation";
import { formatDateTime, isStale, param } from "@/lib/utils";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getUser();
  const [products, stale, lastRefresh, collection] = await Promise.all([
    getProductSummaries(),
    staleAfterHours(),
    getLastRefresh(),
    user ? getCollection() : Promise.resolve(null),
  ]);

  const shortlist = filterProducts(
    products.filter((p) => (p.evStatus === "complete" || p.evStatus === "partial") && p.ratio !== null),
    { sort: "ratio" },
  ).slice(0, 4);
  const recentlyPriced = products
    .filter((p) => p.priceUpdatedAt)
    .sort((a, b) => Date.parse(b.priceUpdatedAt!) - Date.parse(a.priceUpdatedAt!))
    .slice(0, 6);
  const hasCollection = collection && collection.entries.length > 0;

  return (
    <div className="flex flex-col gap-8">
      {param(sp, "deleted") ? <Notice tone="success">Your account and data have been deleted.</Notice> : null}
      {lastRefresh?.finished_at && isStale(lastRefresh.finished_at, 48) ? (
        <Notice tone="warn">
          Prices were last refreshed {formatDateTime(lastRefresh.finished_at)}. Values may be out of date until the next
          scheduled refresh.
        </Notice>
      ) : null}

      {hasCollection ? <CollectionOverview collection={collection} /> : <Onboarding signedIn={Boolean(user)} />}

      <section aria-labelledby="shortlist">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="shortlist" className="text-lg font-semibold">
              Favorable EV-to-price
            </h2>
            <p className="text-muted text-sm">
              Highest estimated EV relative to market price. Estimates, not guarantees.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/products">
              All products <ArrowRight />
            </Link>
          </Button>
        </div>
        {shortlist.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shortlist.map((p) => (
              <ProductCard key={p.id} p={p} staleAfterHours={stale} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-muted py-6 text-sm">
              No product has both a market price and an EV estimate yet. Once the catalog import and first price refresh
              have run, the best EV-to-price ratios appear here.
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="recent-prices">
        <h2 id="recent-prices" className="mb-3 text-lg font-semibold">
          Recently updated prices
        </h2>
        {recentlyPriced.length ? (
          <Card>
            <ul className="divide-border divide-y">
              {recentlyPriced.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <CatalogImage src={p.imageUrl} alt="" aspect="square" className="w-10 shrink-0" />
                  <Link
                    href={`/products/${p.slug}`}
                    className="hover:text-accent min-w-0 flex-1 truncate text-sm font-medium"
                  >
                    {p.name}
                  </Link>
                  <Money value={p.price} currency={p.currency} className="text-sm font-medium" />
                  <FreshnessBadge asOf={p.priceUpdatedAt} staleAfterHours={stale} />
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-muted text-sm">No prices stored yet.</p>
        )}
      </section>
    </div>
  );
}

function Onboarding({ signedIn }: { signedIn: boolean }) {
  const steps = [
    {
      icon: Sparkles,
      title: "Research sealed products",
      text: "Compare market prices with the estimated expected value of opening, with sources and confidence for every pull rate.",
      href: "/products",
      cta: "Explore products",
    },
    {
      icon: Calculator,
      title: "Run your own numbers",
      text: "Plug in the price you'd actually pay and see how the expected net return changes.",
      href: "/compare",
      cta: "Compare boxes",
    },
    {
      icon: Library,
      title: "Track your collection",
      text: "Record each purchase with fees and shipping and watch unrealized gains and losses at current prices.",
      href: signedIn ? "/collection/add" : "/signup",
      cta: signedIn ? "Add your first item" : "Create a free account",
    },
  ];
  return (
    <section className="border-border from-surface via-surface to-surface-3 rounded-2xl border bg-gradient-to-br p-6 sm:p-8">
      <h1 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
        Is that booster box worth opening? <span className="text-accent">Check the math first.</span>
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm">
        SealedEV estimates the expected card value of sealed TCG products from documented pull rates and current
        single-card prices, and tracks what your collection is worth.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.title} className="border-border bg-bg/40 flex flex-col gap-2 rounded-xl border p-4">
            <s.icon className="text-accent size-5" aria-hidden />
            <h2 className="font-medium">{s.title}</h2>
            <p className="text-muted flex-1 text-sm">{s.text}</p>
            <Link href={s.href} className="text-accent text-sm font-medium hover:underline">
              {s.cta} →
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

function CollectionOverview({ collection }: { collection: NonNullable<Awaited<ReturnType<typeof getCollection>>> }) {
  const t = collection.totals.find((x) => x.currency === collection.currency) ?? collection.totals[0];
  const positions = groupPositions(collection.entries.map((e) => e.valuation)).filter((p) => p.currency === t.currency);
  const top = positions
    .filter((p) => p.gainPct !== null)
    .sort((a, b) => b.gainPct!.toNumber() - a.gainPct!.toNumber())
    .slice(0, 5);
  const recent = collection.entries
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5);
  return (
    <section aria-labelledby="portfolio" className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <h1 id="portfolio" className="text-xl font-semibold tracking-tight">
          Your collection
        </h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/collection">
            Open collection <ArrowRight />
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Market value"
          value={<Money value={t.marketValue} currency={t.currency} />}
          sub={`${t.lotCount} lots`}
        />
        <Stat
          label="Acquisition cost"
          value={<Money value={t.costBasis} currency={t.currency} />}
          sub="Incl. fees and shipping"
        />
        <Stat
          label="Unrealized P/L"
          value={<Money value={t.unrealizedGain} currency={t.currency} signed />}
          sub={<Percent value={t.unrealizedGainPct} />}
        />
        <Stat
          label="Holdings"
          value={`${t.sealedQuantity} sealed · ${t.cardQuantity} cards`}
          sub={
            <>
              Sealed <Money value={t.sealedValue} currency={t.currency} /> · Cards{" "}
              <Money value={t.cardValue} currency={t.currency} />
            </>
          }
        />
      </div>
      {t.missingPriceLots || t.stalePriceLots ? (
        <Notice tone="warn">
          {t.missingPriceLots ? `${t.missingPriceLots} lot(s) have no price and are excluded from value. ` : ""}
          {t.stalePriceLots ? `${t.stalePriceLots} lot(s) use stale prices.` : ""}
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="text-gain size-4" aria-hidden /> Top performers
            </CardTitle>
            <CardDescription>By unrealized return on cost.</CardDescription>
          </CardHeader>
          <CardContent>
            {top.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {top.map((p) => (
                  <li key={p.itemKey} className="flex items-center justify-between gap-3">
                    <span className="truncate">{p.itemName}</span>
                    <span className="shrink-0">
                      <Money value={p.gain} currency={p.currency} signed />{" "}
                      <Percent value={p.gainPct} className="text-xs" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted text-sm">No priced positions yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recently added</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {recent.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    {e.valuation.lot.quantity} × {e.name}
                  </span>
                  <Money
                    value={e.valuation.costBasis}
                    currency={e.valuation.lot.currency}
                    className="text-muted shrink-0"
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
