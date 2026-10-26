import { Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { removeWatch } from "@/app/actions/watchlist";
import { FreshnessBadge } from "@/components/badges";
import { CatalogImage } from "@/components/catalog-image";
import { Money, Percent } from "@/components/money";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { requireUser, staleAfterHours } from "@/lib/auth";
import { getProductSummaries } from "@/lib/data/products";
import { formatRatio } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Watchlist" };

export default async function WatchlistPage() {
  await requireUser("/watchlist");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("id, sealed_product_id, card_id, created_at, cards(id, name, number, printing, image_url, current_price, current_price_currency, price_updated_at)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const items = data ?? [];
  const productIds = items.map((i) => i.sealed_product_id).filter((x): x is string => Boolean(x));
  const [products, stale] = await Promise.all([productIds.length ? getProductSummaries(productIds) : Promise.resolve([]), staleAfterHours()]);

  if (items.length === 0) {
    return (
      <>
        <PageHeader title="Watchlist" />
        <EmptyState icon={Eye} title="Nothing on your watchlist yet" action={<Button asChild variant="primary"><Link href="/products">Browse sealed products</Link></Button>}>
          Use “Watch” on any product or card to keep an eye on its price and EV.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Watchlist" description="Products and cards you are following." />
      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th className="text-right">Price</Th>
              <Th className="text-right">Est. EV</Th>
              <Th className="text-right">EV / price</Th>
              <Th className="text-right">Net return</Th>
              <Th>Updated</Th>
              <Th><span className="sr-only">Remove</span></Th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const p = products.find((x) => x.id === i.sealed_product_id);
              const c = i.cards as unknown as { id: string; name: string; number: string | null; printing: string; image_url: string | null; current_price: number | null; current_price_currency: string | null; price_updated_at: string | null } | null;
              return (
                <tr key={i.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <CatalogImage src={p?.imageUrl ?? c?.image_url} alt="" aspect={p ? "square" : "card"} className="w-9 shrink-0" />
                      {p ? (
                        <Link href={`/products/${p.slug}`} className="font-medium hover:text-accent">{p.name}</Link>
                      ) : c ? (
                        <Link href={`/cards/${c.id}`} className="font-medium hover:text-accent">{c.name} <span className="text-xs text-muted">{c.number} · {c.printing}</span></Link>
                      ) : null}
                    </div>
                  </Td>
                  <Td className="text-right"><Money value={p ? p.price : c?.current_price} currency={p?.currency ?? c?.current_price_currency ?? "USD"} /></Td>
                  <Td className="text-right">{p?.ev ? <Money value={p.ev} currency={p.currency} /> : "—"}</Td>
                  <Td className="text-right tabular">{p ? formatRatio(p.ratio) : "—"}</Td>
                  <Td className="text-right">{p?.net ? <><Money value={p.net} currency={p.currency} signed /> <Percent value={p.netPct} /></> : "—"}</Td>
                  <Td><FreshnessBadge asOf={p ? p.priceUpdatedAt : (c?.price_updated_at ?? null)} staleAfterHours={stale} /></Td>
                  <Td>
                    <form action={removeWatch}>
                      <input type="hidden" name="id" value={i.id} />
                      <Button type="submit" variant="ghost" size="sm">Remove</Button>
                    </form>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </>
  );
}
