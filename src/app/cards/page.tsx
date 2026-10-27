import { Layers } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FreshnessBadge, PriceKindBadge } from "@/components/badges";
import { CatalogImage } from "@/components/catalog-image";
import { Money } from "@/components/money";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { staleAfterHours } from "@/lib/auth";
import { getGames, getRarities, getSetsForGame, searchCards } from "@/lib/data/catalog";
import { param } from "@/lib/utils";

export const metadata: Metadata = { title: "Cards" };

const SORTS = ["price_desc", "price_asc", "name", "number"] as const;

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const sortParam = param(sp, "sort");
  const s = {
    q: param(sp, "q"),
    gameId: uuid(param(sp, "game")),
    setId: uuid(param(sp, "set")),
    rarity: param(sp, "rarity"),
    sort: (SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as (typeof SORTS)[number]) : "price_desc",
    page: Math.min(500, Math.max(1, Number(param(sp, "page")) || 1)),
  };
  const [{ rows, total }, games, sets, rarities, stale] = await Promise.all([
    searchCards(s),
    getGames(),
    s.gameId ? getSetsForGame(s.gameId) : Promise.resolve([]),
    getRarities(s.setId),
    staleAfterHours(),
  ]);
  const pages = Math.max(1, Math.ceil(total / 48));
  const qs = (page: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: s.q, game: s.gameId, set: s.setId, rarity: s.rarity, sort: s.sort }))
      if (v) u.set(k, v);
    u.set("page", String(page));
    return `?${u}`;
  };

  return (
    <>
      <PageHeader
        title="Card explorer"
        description="Single-card market prices. No account needed to look up a price."
      />
      <form
        method="get"
        className="border-border bg-surface grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <Field label="Search" htmlFor="q" className="col-span-2">
          <Input id="q" name="q" defaultValue={s.q} placeholder="Card name" />
        </Field>
        <Field label="Game" htmlFor="game">
          <Select id="game" name="game" defaultValue={s.gameId ?? ""}>
            <option value="">All games</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Set" htmlFor="set">
          <Select id="set" name="set" defaultValue={s.setId ?? ""} disabled={!sets.length && !s.setId}>
            <option value="">{sets.length ? "All sets" : "Pick a game first"}</option>
            {sets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rarity" htmlFor="rarity">
          <Select id="rarity" name="rarity" defaultValue={s.rarity ?? ""}>
            <option value="">All rarities</option>
            {rarities.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sort" htmlFor="sort">
          <Select id="sort" name="sort" defaultValue={s.sort}>
            <option value="price_desc">Highest price</option>
            <option value="price_asc">Lowest price</option>
            <option value="name">Name</option>
            <option value="number">Card number</option>
          </Select>
        </Field>
        <div className="col-span-2 flex gap-2 sm:col-span-3 lg:col-span-6">
          <Button type="submit" variant="primary">
            Search
          </Button>
          <Button asChild variant="ghost">
            <Link href="/cards">Reset</Link>
          </Button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={total === 0 && !s.q && !s.setId ? "No cards in the catalog yet" : "No cards match"}
          className="mt-6"
        >
          {total === 0 && !s.q
            ? "Cards are added by the catalog import (npm run catalog:import or Admin → Import catalog)."
            : "Try a different search."}
        </EmptyState>
      ) : (
        <>
          <p className="text-muted mt-6 mb-3 text-sm">{total.toLocaleString()} card printings</p>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/cards/${c.id}`} className="group flex flex-col gap-2">
                  <CatalogImage src={c.image_url} alt={`${c.name} ${c.number ?? ""}`} />
                  <div>
                    <div className="group-hover:text-accent text-sm leading-tight font-medium">{c.name}</div>
                    <div className="text-muted text-xs">
                      {c.number ? `${c.number} · ` : ""}
                      {c.rarity ?? "—"}
                    </div>
                    <div className="text-subtle text-xs">{c.printing}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">
                      <Money value={c.current_price} currency={c.current_price_currency ?? "USD"} />
                    </span>
                    <FreshnessBadge asOf={c.price_updated_at} staleAfterHours={stale} />
                    {c.current_price_kind && c.current_price_kind !== "provider" ? (
                      <PriceKindBadge kind={c.current_price_kind} />
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-2 text-sm">
              {s.page > 1 ? (
                <Button asChild size="sm">
                  <Link href={qs(s.page - 1)}>Previous</Link>
                </Button>
              ) : null}
              <span className="text-muted">
                Page {s.page} of {pages}
              </span>
              {s.page < pages ? (
                <Button asChild size="sm">
                  <Link href={qs(s.page + 1)}>Next</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
