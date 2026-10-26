/*
 * Outbound HTTP for pricing providers: fixed base URLs only (never a URL
 * supplied by a user), per-host pacing, timeouts and one retry on 429/5xx.
 */

const ALLOWED_HOSTS = new Set(["tcgcsv.com", "api.pokemontcg.io"]);

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const lastRequestAt = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchJsonOptions {
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Minimum gap between requests to the same host. */
  minIntervalMs?: number;
  retries?: number;
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new ProviderError(`Refusing to fetch non-allowlisted URL host: ${parsed.hostname}`);
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 1;
  const minInterval = opts.minIntervalMs ?? 100;

  for (let attempt = 0; ; attempt++) {
    const wait = (lastRequestAt.get(parsed.hostname) ?? 0) + minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(parsed.hostname, Date.now());

    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "SealedEV/1.0 (+price refresh)", ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        cache: "no-store",
      });
    } catch (err) {
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new ProviderError(`${parsed.hostname}: ${(err as Error).message}`);
    }

    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000, 10_000));
      continue;
    }
    if (!res.ok) throw new ProviderError(`${parsed.hostname}${parsed.pathname}: HTTP ${res.status}`, res.status);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ProviderError(`${parsed.hostname}${parsed.pathname}: invalid JSON`);
    }
  }
}

export async function fetchText(url: string, opts: FetchJsonOptions = {}): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new ProviderError(`Refusing to fetch non-allowlisted URL host: ${parsed.hostname}`);
  }
  const res = await (opts.fetchImpl ?? fetch)(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new ProviderError(`${parsed.hostname}${parsed.pathname}: HTTP ${res.status}`, res.status);
  return res.text();
}
