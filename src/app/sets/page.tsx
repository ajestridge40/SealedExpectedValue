import { Library } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page";
import { Pagination } from "@/components/pagination";
import { SetCard } from "@/components/set-card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { getProfile } from "@/lib/auth";
import { getGames } from "@/lib/data/catalog";
import { SET_SORTS, querySets, type SetSort } from "@/lib/data/sets";
import { param } from "@/lib/utils";

export const metadata: Metadata = { title: "Sets" };

const PAGE_SIZE = 48;

export default async function SetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const [games, profile] = await Promise.all([getGames(), getProfile()]);
  const gameParam = param(sp, "game");
  const game =
    gameParam && games.some((g) => g.id === gameParam)
      ? gameParam
      : !("game" in sp)
        ? (profile?.preferred_game_id ?? undefined)
        : undefined;
  const sortParam = param(sp, "sort");
  const sort: SetSort = (SET_SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as SetSort) : "release";
  const q = param(sp, "q")?.slice(0, 80);
  const page = Math.min(10_000, Math.max(1, Number(param(sp, "page")) || 1));
  const { rows, total } = await querySets({ game, q, sort, page, pageSize: PAGE_SIZE });

  return (
    <>
      <PageHeader
        title="Sets"
        description="Every set in the catalog with its card value profile. Prices are stored in the database and refreshed on a schedule."
      />
      <form
        method="get"
        className="border-border bg-surface grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-4"
      >
        <Field label="Search" htmlFor="q" className="col-span-2 sm:col-span-1">
          <Input id="q" name="q" defaultValue={q} placeholder="Set name or code" />
        </Field>
        <Field label="Game" htmlFor="game">
          <Select id="game" name="game" defaultValue={game ?? ""}>
            <option value="">All games</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sort" htmlFor="sort">
          <Select id="sort" name="sort" defaultValue={sort}>
            <option value="release">Newest</option>
            <option value="top5">Top-5 card value</option>
            <option value="ratio">Top-5 / box price</option>
            <option value="name">Name</option>
          </Select>
        </Field>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
          <Button type="submit" variant="primary">
            Apply
          </Button>
          <Button asChild variant="ghost">
            <Link href="/sets?game=">Reset</Link>
          </Button>
        </div>
      </form>

      {total === 0 ? (
        <EmptyState icon={Library} title={q || game ? "No sets match" : "No sets yet"} className="mt-6">
          {q || game ? (
            "Try a different search or game."
          ) : (
            <>
              Load sets with <code>npm run catalog:sync</code> (or <code>npm run catalog:sync:all</code> for every
              game).
            </>
          )}
        </EmptyState>
      ) : (
        <>
          <p className="text-muted mt-6 mb-3 text-sm">
            {total.toLocaleString()} set{total === 1 ? "" : "s"}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((s) => (
              <SetCard key={s.id} s={s} />
            ))}
          </div>
          <Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} params={sp} />
        </>
      )}
    </>
  );
}
