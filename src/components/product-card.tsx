import Link from "next/link";
import { PRODUCT_TYPE_LABELS } from "@/lib/data/types";
import type { ProductSummary } from "@/lib/data/summaries";
import { formatRatio } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { ConfidenceBadge, EvStatusBadge, FreshnessBadge, PriceKindBadge } from "./badges";
import { CatalogImage } from "./catalog-image";
import { Money, Percent } from "./money";
import { Badge } from "./ui/badge";

export function ProductCard({
  p,
  staleAfterHours,
  compareSelectable,
}: {
  p: ProductSummary;
  staleAfterHours: number;
  compareSelectable?: boolean;
}) {
  const showEv = p.evStatus === "complete" || p.evStatus === "partial";
  return (
    <article className="group border-border bg-surface hover:border-border-strong relative flex flex-col overflow-hidden rounded-xl border transition-colors">
      {compareSelectable ? (
        <label className="bg-bg/85 text-muted absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] backdrop-blur">
          <input type="checkbox" name="ids" value={p.id} className="accent-[var(--color-accent)]" />
          Compare
        </label>
      ) : null}
      <Link href={`/products/${p.slug}`} className="flex flex-1 flex-col focus-visible:outline-none">
        <div className="bg-surface-2/60 p-4">
          <CatalogImage src={p.imageUrl} alt={p.name} aspect="square" className="mx-auto max-h-44 bg-transparent" />
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div>
            <div className="text-subtle flex flex-wrap items-center gap-1.5 text-[11px]">
              <span>{p.gameName}</span>
              <span aria-hidden>·</span>
              <span>{PRODUCT_TYPE_LABELS[p.productType]}</span>
              {p.releaseDate ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{formatDate(p.releaseDate)}</span>
                </>
              ) : null}
            </div>
            <h3 className="group-hover:text-accent mt-1 leading-snug font-medium">{p.name}</h3>
            {p.setName ? <p className="text-muted text-xs">{p.setName}</p> : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div>
              <dt className="text-subtle text-[11px]">Market price</dt>
              <dd className="font-medium">
                <Money value={p.price} currency={p.currency} />
              </dd>
            </div>
            <div>
              <dt className="text-subtle text-[11px]">Est. EV</dt>
              <dd className="font-medium">{showEv ? <Money value={p.ev} currency={p.currency} /> : "—"}</dd>
            </div>
            <div>
              <dt className="text-subtle text-[11px]">EV / price</dt>
              <dd className="tabular font-medium">{formatRatio(p.ratio)}</dd>
            </div>
            <div>
              <dt className="text-subtle text-[11px]">Est. net return</dt>
              <dd className="font-medium">
                {p.net !== null ? (
                  <>
                    <Money value={p.net} currency={p.currency} signed />{" "}
                    <span className="text-xs">
                      (<Percent value={p.netPct} />)
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-auto flex flex-wrap gap-1.5">
            <EvStatusBadge status={p.evStatus} />
            {p.evStatus !== "insufficient" && p.evStatus !== "no_model" ? (
              <ConfidenceBadge level={p.confidence} />
            ) : null}
            <PriceKindBadge kind={p.priceKind} sourceName={p.priceSourceName} />
            <FreshnessBadge asOf={p.priceUpdatedAt} staleAfterHours={staleAfterHours} />
            {p.isSample ? <Badge tone="warn">Sample data</Badge> : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
