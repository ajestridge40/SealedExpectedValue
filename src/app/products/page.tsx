import { GitCompareArrows, PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/page";
import { ProductCard } from "@/components/product-card";
import { ProductFiltersForm } from "@/components/product-filters";
import { Button } from "@/components/ui/button";
import { getProfile, staleAfterHours } from "@/lib/auth";
import { getGames, getSets } from "@/lib/data/catalog";
import { parseProductFilters } from "@/lib/data/parse-filters";
import { getProductSummaries } from "@/lib/data/products";
import { filterProducts } from "@/lib/data/summaries";

export const metadata: Metadata = { title: "Sealed products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const f = parseProductFilters(sp);
  const [all, games, sets, stale, profile] = await Promise.all([
    getProductSummaries(),
    getGames(),
    getSets(),
    staleAfterHours(),
    getProfile(),
  ]);
  // Preferred game applies until the visitor picks a game filter themselves.
  if (!("game" in sp) && profile?.preferred_game_id) f.game = profile.preferred_game_id;
  const items = filterProducts(all, f);

  return (
    <>
      <PageHeader
        title="Sealed product explorer"
        description="Market price versus estimated expected value of opening. EV is an average over many openings, not a prediction for one box."
      />
      <ProductFiltersForm f={f} games={games} sets={sets} />

      {all.length === 0 ? (
        <EmptyState icon={PackageSearch} title="The catalog is empty" className="mt-6">
          Run <code>npm run db:seed</code> and <code>npm run catalog:import</code> (see README) to load products.
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState icon={PackageSearch} title="No products match these filters" className="mt-6">
          Try widening the price range or lowering the minimum confidence.
        </EmptyState>
      ) : (
        <form action="/compare" method="get" className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-muted text-sm">
              {items.length} of {all.length} products
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
        </form>
      )}
    </>
  );
}
