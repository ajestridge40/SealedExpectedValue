import { GitCompareArrows } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConfidenceBadge, EvStatusBadge, FreshnessBadge, PriceKindBadge } from "@/components/badges";
import { CatalogImage } from "@/components/catalog-image";
import { CompareScenario } from "@/components/compare-scenario";
import { Money, Percent } from "@/components/money";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { staleAfterHours } from "@/lib/auth";
import { getProductSummaries } from "@/lib/data/products";
import { PRODUCT_TYPE_LABELS } from "@/lib/data/types";
import { formatRatio } from "@/lib/money";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Compare products" };

const MAX = 4;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = [sp.ids]
    .flat()
    .filter(Boolean)
    .flatMap((v) => String(v).split(","));
  const ids = [...new Set(raw.filter((v) => /^[0-9a-f-]{36}$/i.test(v)))].slice(0, MAX);
  const [all, stale] = await Promise.all([getProductSummaries(), staleAfterHours()]);
  const selected = ids.map((id) => all.find((p) => p.id === id)).filter((p) => p !== undefined);
  const others = all.filter((p) => !ids.includes(p.id));

  const rows: { label: string; render: (p: (typeof selected)[number]) => React.ReactNode }[] = [
    { label: "Set", render: (p) => p.setName ?? "—" },
    { label: "Type", render: (p) => PRODUCT_TYPE_LABELS[p.productType] },
    { label: "Packs", render: (p) => p.packCount ?? "—" },
    { label: "Released", render: (p) => formatDate(p.releaseDate) },
    { label: "Market price", render: (p) => <Money value={p.price} currency={p.currency} /> },
    {
      label: "Price per pack",
      render: (p) =>
        p.price && p.packCount ? (
          <Money value={(Number(p.price) / p.packCount).toFixed(2)} currency={p.currency} />
        ) : (
          "—"
        ),
    },
    { label: "Est. gross EV", render: (p) => (p.ev ? <Money value={p.ev} currency={p.currency} /> : "—") },
    { label: "EV / price", render: (p) => <span className="tabular">{formatRatio(p.ratio)}</span> },
    { label: "Est. net return", render: (p) => <Money value={p.net} currency={p.currency} signed /> },
    { label: "Net return %", render: (p) => <Percent value={p.netPct} /> },
    {
      label: "Confidence",
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          <EvStatusBadge status={p.evStatus} />
          {p.evStatus === "complete" || p.evStatus === "partial" ? <ConfidenceBadge level={p.confidence} /> : null}
        </div>
      ),
    },
    { label: "Probability known", render: (p) => `${(p.probabilityCoverage * 100).toFixed(0)}%` },
    { label: "Probability priced", render: (p) => `${(p.priceCoverage * 100).toFixed(0)}%` },
    {
      label: "Price source",
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          <PriceKindBadge kind={p.priceKind} sourceName={p.priceSourceName} />
          <FreshnessBadge asOf={p.priceUpdatedAt} staleAfterHours={stale} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Compare sealed products" description={`Side by side, up to ${MAX} products.`} />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        {ids.map((id) => (
          <input key={id} type="hidden" name="ids" value={id} />
        ))}
        <label className="text-muted flex flex-col gap-1.5 text-xs" htmlFor="add">
          Add a product
          <Select id="add" name="ids" className="w-72" defaultValue="" disabled={ids.length >= MAX}>
            <option value="" disabled>
              Choose…
            </option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" disabled={ids.length >= MAX}>
          Add
        </Button>
        {ids.length ? (
          <Button asChild variant="ghost">
            <Link href="/compare">Clear</Link>
          </Button>
        ) : null}
      </form>

      {selected.length === 0 ? (
        <EmptyState
          icon={GitCompareArrows}
          title="Pick products to compare"
          action={
            <Button asChild variant="primary">
              <Link href="/products">Browse products</Link>
            </Button>
          }
        >
          Select products with the “Compare” checkbox in the explorer, or add them above.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="border-border bg-surface overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th className="w-40 p-3" />
                  {selected.map((p) => (
                    <th key={p.id} className="p-3 text-left align-top font-normal">
                      <CatalogImage src={p.imageUrl} alt={p.name} aspect="square" className="mb-2 h-28 w-28" />
                      <Link href={`/products/${p.slug}`} className="hover:text-accent font-medium">
                        {p.name}
                      </Link>
                      <div className="mt-1">
                        <Link
                          className="text-muted hover:text-loss text-xs"
                          href={`/compare?${ids
                            .filter((x) => x !== p.id)
                            .map((x) => `ids=${x}`)
                            .join("&")}`}
                        >
                          Remove
                        </Link>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-border/60 border-t">
                    <th scope="row" className="text-muted p-3 text-left text-xs font-medium">
                      {r.label}
                    </th>
                    {selected.map((p) => (
                      <td key={p.id} className="tabular p-3">
                        {r.render(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CompareScenario
            products={selected.map((p) => ({
              id: p.id,
              name: p.name,
              ev: p.evStatus === "insufficient" || p.evStatus === "no_model" ? null : p.ev,
              price: p.price,
              currency: p.currency,
            }))}
          />
        </div>
      )}
    </>
  );
}
