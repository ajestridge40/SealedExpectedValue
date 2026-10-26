/**
 * Show what TCGTracking returns for one set (structure + a sample), to
 * diagnose "unexpected response shape" errors. Read-only; no database.
 *   npm run tcgtracking:check 3 23651      # category id, set id (3 = Pokémon)
 */
import { DEFAULT_BASES, TcgTrackingProvider } from "../src/lib/pricing/providers/tcgtracking.ts";

const [cat = "3", set = "23651"] = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const base = (process.env.TCGTRACKING_BASE_URL || DEFAULT_BASES[0]).replace(/\/$/, "");

function describe(value: unknown, depth = 0): string {
  if (Array.isArray(value))
    return `array(${value.length})${value.length ? ` of ${describe(value[0], depth + 1)}` : ""}`;
  if (value && typeof value === "object") {
    if (depth > 3) return "object";
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 6);
    return `{ ${entries.map(([k, v]) => `${k}: ${describe(v, depth + 1)}`).join(", ")}${Object.keys(value as object).length > 6 ? ", …" : ""} }`;
  }
  return value === null ? "null" : typeof value;
}

for (const path of [`${cat}/sets`, `${cat}/sets/${set}`, `${cat}/sets/${set}/pricing`]) {
  const url = `${base}/${path}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await res.json();
    console.log(`\n${url}\n  HTTP ${res.status}\n  ${describe(body)}`);
  } catch (err) {
    console.log(`\n${url}\n  failed: ${(err as Error).message}`);
  }
}

const p = new TcgTrackingProvider(fetch, base);
try {
  const rows = await p.prices(Number(cat), Number(set));
  console.log(`\nParsed ${rows.length} price rows. Sample:`, rows.slice(0, 3));
} catch (err) {
  console.log(`\nParser error: ${(err as Error).message}`);
}
