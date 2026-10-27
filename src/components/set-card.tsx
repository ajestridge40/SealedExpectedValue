import Link from "next/link";
import type { SetOverview } from "@/lib/data/sets";
import { formatRatio } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { CatalogImage } from "./catalog-image";
import { Money } from "./money";

/** Set tile: logo (or its booster box / top card when there is no logo) and value profile. */
export function SetCard({ s }: { s: SetOverview }) {
  return (
    <Link
      href={`/sets/${s.id}`}
      className="group border-border bg-surface hover:border-border-strong flex flex-col overflow-hidden rounded-xl border transition-colors"
    >
      <div className="bg-surface-2/60 p-4">
        <CatalogImage
          src={s.cover_image_url}
          alt={s.name}
          aspect="square"
          className="mx-auto max-h-36 bg-transparent"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="text-subtle flex flex-wrap items-center gap-1.5 text-[11px]">
            <span>{s.game_name}</span>
            {s.release_date ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatDate(s.release_date)}</span>
              </>
            ) : null}
          </div>
          <h3 className="group-hover:text-accent mt-1 flex items-center gap-1.5 leading-snug font-medium">
            {s.symbol_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- tiny set symbol from the source CDN
              <img
                src={s.symbol_url}
                alt=""
                className="size-4 object-contain"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null}
            {s.name}
          </h3>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div>
            <dt className="text-subtle text-[11px]">Top-5 cards</dt>
            <dd className="font-medium">{s.top5_value > 0 ? <Money value={s.top5_value} /> : "—"}</dd>
          </div>
          <div>
            <dt className="text-subtle text-[11px]">Booster box</dt>
            <dd className="font-medium">
              <Money value={s.box_price} />
            </dd>
          </div>
          <div title="Top-5 card value divided by the booster box price. A quick set-strength indicator, not an EV.">
            <dt className="text-subtle text-[11px]">Top-5 / box</dt>
            <dd className="tabular font-medium">{formatRatio(s.box_top5_ratio)}</dd>
          </div>
          <div>
            <dt className="text-subtle text-[11px]">Cards · sealed</dt>
            <dd className="tabular font-medium">
              {s.total_cards.toLocaleString()} · {s.sealed_products.toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}
