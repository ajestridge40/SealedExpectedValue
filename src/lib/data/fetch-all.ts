/** PostgREST returns at most ~1000 rows per request; page through larger reads. */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/**
 * Run a filtered query in batches. Filters like `.in("id", ids)` go into the
 * request URL, so a long id list can exceed URL limits; this splits the list
 * and concatenates the results.
 */
export async function inBatches<T, K>(
  ids: K[],
  query: (batch: K[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  batchSize = 100,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const { data, error } = await query(ids.slice(i, i + batchSize));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}
