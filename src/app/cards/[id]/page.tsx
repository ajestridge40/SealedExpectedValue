import { ExternalLink, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FreshnessBadge, PriceKindBadge } from "@/components/badges";
import { CatalogImage } from "@/components/catalog-image";
import { ManualPriceForm } from "@/components/manual-price-form";
import { Money } from "@/components/money";
import { PriceChart } from "@/components/price-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WatchButton } from "@/components/watch-button";
import { getProfile, getUser, staleAfterHours } from "@/lib/auth";
import { getCardById, getDataSources, getGames, getPriceHistory, getSet } from "@/lib/data/catalog";
import { isWatching } from "@/lib/data/user";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const card = await getCardById((await params).id);
  return { title: card ? `${card.name} ${card.number ?? ""}`.trim() : "Card not found" };
}

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await getCardById(id);
  if (!card) notFound();
  const path = `/cards/${card.id}`;
  const supabase = await createClient();
  const [history, sources, set, games, user, profile, watching, stale, latest, siblings] = await Promise.all([
    getPriceHistory({ cardId: card.id }),
    getDataSources(),
    getSet(card.set_id),
    getGames(),
    getUser(),
    getProfile(),
    isWatching("card", card.id),
    staleAfterHours(),
    supabase
      .from("price_snapshots")
      .select("low_price, mid_price, high_price, market_price, currency, source_kind, captured_at, note")
      .eq("card_id", card.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    card.tcgplayer_product_id
      ? supabase
          .from("cards")
          .select("id, printing, current_price, current_price_currency")
          .eq("tcgplayer_product_id", card.tcgplayer_product_id)
          .neq("id", card.id)
      : Promise.resolve({
          data: [] as {
            id: string;
            printing: string;
            current_price: number | null;
            current_price_currency: string | null;
          }[],
        }),
  ]);
  const game = games.find((g) => g.id === card.game_id);
  const currency = card.current_price_currency ?? "USD";
  const source = card.current_price_source_id ? sources.get(card.current_price_source_id) : undefined;
  const snap = latest.data;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-muted text-xs">
        <Link href="/cards" className="hover:text-fg">
          Cards
        </Link>{" "}
        / <span className="text-fg">{card.name}</span>
      </nav>
      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        <CatalogImage
          src={card.image_url?.replace("_200w", "_400w")}
          alt={`${card.name} ${card.number ?? ""}`}
          className="w-full"
        />
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-muted text-xs">
              {game?.name}
              {set ? ` · ${set.name}` : ""}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">{card.name}</h1>
            <p className="text-muted text-sm">
              {card.number ? `#${card.number} · ` : ""}
              {card.rarity ?? "Unknown rarity"} · {card.printing}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="text-muted text-xs">Market price</div>
              <div className="text-3xl font-semibold">
                <Money value={card.current_price} currency={currency} />
              </div>
            </div>
            {snap ? (
              <dl className="flex gap-4 text-sm">
                <div>
                  <dt className="text-muted text-xs">Low</dt>
                  <dd>
                    <Money value={snap.low_price} currency={snap.currency} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted text-xs">Mid</dt>
                  <dd>
                    <Money value={snap.mid_price} currency={snap.currency} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted text-xs">High</dt>
                  <dd>
                    <Money value={snap.high_price} currency={snap.currency} />
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <PriceKindBadge kind={card.current_price_kind} sourceName={source?.name} />
            <FreshnessBadge asOf={card.price_updated_at} staleAfterHours={stale} />
          </div>
          <p className="text-subtle text-xs">
            Last price update: {formatDateTime(card.price_updated_at)}
            {source ? ` · ${source.name}` : ""}
            {source?.attribution ? ` · ${source.attribution}` : ""}
            {card.tcgplayer_product_id ? (
              <>
                {" · "}
                <a
                  className="hover:text-fg inline-flex items-center gap-1"
                  href={`https://www.tcgplayer.com/product/${card.tcgplayer_product_id}`}
                  target="_blank"
                  rel="noreferrer nofollow"
                >
                  TCGplayer listing <ExternalLink className="size-3" />
                </a>
              </>
            ) : null}
          </p>
          {siblings.data && siblings.data.length ? (
            <div className="text-sm">
              <span className="text-muted">Other printings: </span>
              {siblings.data.map((s, i) => (
                <span key={s.id}>
                  {i ? ", " : ""}
                  <Link href={`/cards/${s.id}`} className="text-accent hover:underline">
                    {s.printing}
                  </Link>{" "}
                  (<Money value={s.current_price} currency={s.current_price_currency ?? "USD"} />)
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <Link
                href={user ? `/collection/add?type=card&item=${card.id}` : `/login?next=${encodeURIComponent(path)}`}
              >
                <Plus /> Add to collection
              </Link>
            </Button>
            <WatchButton kind="card" id={card.id} path={path} watching={watching} signedIn={Boolean(user)} />
          </div>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Price history</CardTitle>
          <CardDescription>
            From SealedEV&apos;s stored daily snapshots
            {card.current_price_kind && card.current_price_kind !== "provider"
              ? "; includes imported/manual prices"
              : ""}
            . Ungraded, near-mint market price.
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
      {profile?.is_admin ? (
        <Card>
          <CardHeader>
            <CardTitle>Admin: record a manual price</CardTitle>
          </CardHeader>
          <CardContent>
            <ManualPriceForm kind="card" id={card.id} path={path} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
