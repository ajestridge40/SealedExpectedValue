import "server-only";
import { getDataSources, getGames, getSets } from "./catalog";
import { getProductEvs } from "./ev";
import { getPriceChanges, getSetStats } from "./market";
import { toSummary, type ProductSummary } from "./summaries";

export async function getProductSummaries(productIds?: string[]): Promise<ProductSummary[]> {
  const [evs, sets, games, sources, setStats, changes] = await Promise.all([
    getProductEvs(productIds),
    getSets(),
    getGames(),
    getDataSources(),
    getSetStats(),
    getPriceChanges(7),
  ]);
  return [...evs.values()].map((pe) => toSummary(pe, { sets, games, sources, setStats, changes }));
}
