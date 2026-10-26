import "server-only";
import { getDataSources, getGames, getSets } from "./catalog";
import { getProductEvs } from "./ev";
import { toSummary, type ProductSummary } from "./summaries";

export async function getProductSummaries(productIds?: string[]): Promise<ProductSummary[]> {
  const [evs, sets, games, sources] = await Promise.all([getProductEvs(productIds), getSets(), getGames(), getDataSources()]);
  return [...evs.values()].map((pe) => toSummary(pe, { sets, games, sources }));
}
