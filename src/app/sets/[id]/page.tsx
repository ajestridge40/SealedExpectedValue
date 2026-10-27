import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FreshnessBadge } from "@/components/badges";
import { CatalogImage } from "@/components/catalog-image";
import { Money } from "@/components/money";
import { PageHeader, Stat } from "@/components/page";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { staleAfterHours } from "@/lib/auth";
import { searchCards } from "@/lib/data/catalog";
import { queryProducts } from "@/lib/data/products";
import { getSetOverview } from "@/lib/data/sets";
import { formatRatio } from "@/lib/money";
import { formatDate, timeAgo } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const set = await getSetOverview((await params).id);
  return { title: set ? set.name : "Set not found" };
}

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const set = await getSetOverview((await params).id);
  if (!set) notFound();
  const [sealed, cards, stale] = await Promise.all([
    queryProducts({ game: set.game_id, set: set.id, sort: "price" }, { page: 1, pageSize: 12 }),
    searchCards({ setId: set.id, sort: "price_desc", pageSize: 18 }),
    staleAfterHours(),
  ]);

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <CatalogImage
          src={set.cover_image_url}
          alt={set.name}
          aspect="square"
          className="w-32 shrink-0 bg-transparent sm:w-40"
        />
        <PageHeader
          title={set.name}
          description={
            <>
              {set.game_name}
              {set.code ? ` · ${set.code}` : ""}
              {set.release_date ? ` · Released ${formatDate(set.release_date)}` : ""}
              {set.prices_synced_at ? ` · Prices updated ${timeAgo(set.prices_synced_at)}` : ""}
            </>
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Top-5 card value" value={set.top5_value > 0 ? <Money value={set.top5_value} /> : "—"} />
        <Stat
          label="Booster box"
          value={<Money value={set.box_price} />}
          sub={`Top-5 / box ${formatRatio(set.box_top5_ratio)}`}
        />
        <Stat
          label="Cards"
          value={set.total_cards.toLocaleString()}
          sub={`${set.priced_cards.toLocaleString()} priced · ${set.chase_cards} worth $25+`}
        />
        <Stat label="Most valuable card" value={<Money value={set.top_card_price} />} />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Sealed products</h2>
          {sealed.total > sealed.rows.length ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/products?game=${set.game_id}&set=${set.id}`}>
                All {sealed.total} <ArrowRight />
              </Link>
            </Button>
          ) : null}
        </div>
        {sealed.rows.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sealed.rows.map((p) => (
              <ProductCard key={p.id} p={p} staleAfterHours={stale} />
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm">No sealed products for this set in the catalog.</p>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Most valuable cards</h2>
          {cards.total > cards.rows.length ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/cards?game=${set.game_id}&set=${set.id}`}>
                All {cards.total.toLocaleString()} printings <ArrowRight />
              </Link>
            </Button>
          ) : null}
        </div>
        {cards.rows.length ? (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {cards.rows.map((c) => (
              <li key={c.id}>
                <Link href={`/cards/${c.id}`} className="group flex flex-col gap-2">
                  <CatalogImage src={c.image_url} alt={`${c.name} ${c.number ?? ""}`} />
                  <div>
                    <div className="group-hover:text-accent text-sm leading-tight font-medium">{c.name}</div>
                    <div className="text-subtle text-[11px]">
                      {[c.number, c.rarity, c.printing].filter(Boolean).join(" · ")}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                      <Money value={c.current_price} currency={c.current_price_currency ?? "USD"} />
                      <FreshnessBadge asOf={c.price_updated_at} staleAfterHours={stale} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted text-sm">No cards for this set in the catalog yet.</p>
        )}
      </section>
    </>
  );
}
