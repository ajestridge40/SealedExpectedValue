import { GitCompareArrows, PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/page";
import { ProductCard } from "@/components/product-card";
import { ProductFiltersForm } from "@/components/product-filters";
import { Button } from "@/components/ui/button";
import { getProfile, staleAfterHours } from "@/lib/auth";
import { getGames, getSetsForGame } from "@/lib/data/catalog";
import { parseProductFilters } from "@/lib/data/parse-filters";
import { Pagination } from "@/components/pagination";
import { queryProducts } from "@/lib/data/products";

export const metadata: Metadata = { title: "Sealed products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const f = parseProductFilters(sp);
  const [games, stale, profile] = await Promise.all([getGames(), staleAfterHours(), getProfile()]);
  // Preferred game applies until the visitor picks a game filter themselves.
  if (!("game" in sp) && profile?.preferred_game_id) f.game = profile.preferred_game_id;
  const sets = f.game ? await getSetsForGame(f.game) : [];
  const page = Math.min(10_000, Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1));
  const { rows: items, total } = await queryProducts(f, { page, pageSize: 48 });
  const filtered = Boolean(f.q || f.set || f.type || f.minPrice || f.maxPrice || f.minRatio || f.net || f.confidence);

  return (
    <>
      <PageHeader
        title="Sealed product explorer"
        description="Market price versus estimated expected value of opening. EV is an average over many openings, not a prediction for one box."
      />
      <ProductFiltersForm f={f} games={games} sets={sets} />

      {total === 0 && !filtered && !f.game ? (
        <EmptyState icon={PackageSearch} title="The catalog is empty" className="mt-6">
          Run <code>npm run setup</code> (see README) to create the catalog and load prices.
        </EmptyState>
      ) : total === 0 ? (
        <EmptyState icon={PackageSearch} title="No products match these filters" className="mt-6">
          Try widening the price range or lowering the minimum confidence.
        </EmptyState>
      ) : (
        <form action="/compare" method="get" className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-muted text-sm">
              {total.toLocaleString()} product{total === 1 ? "" : "s"}
            </p>
            <Button type="submit" size="sm">
              <GitCompareArrows /> Compare selected
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} p={p} staleAfterHours={stale} compareSelectable />
            ))}
          </div>
          <Pagination page={page} pages={Math.ceil(total / 48)} params={sp} />
        </form>
      )}
    </>
  );
}
