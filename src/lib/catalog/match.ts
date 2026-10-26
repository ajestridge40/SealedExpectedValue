import { cleanCardName, type TcgApiCard, type TcgApiPriceRow } from "../pricing/providers/tcgapi";
import { safeImageUrl } from "../pricing/types";

/*
 * Strict name matching between our catalog and the pricing provider's
 * catalog (TCG API, which mirrors TCGplayer's names and ids). Only exact
 * matches after normalization are accepted; anything ambiguous is reported for
 * a human to resolve by setting the id by hand.
 */

export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[—–-]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "SV08: Surging Sparks" -> "Surging Sparks"; "Scarlet & Violet—Surging Sparks" -> "Surging Sparks". */
export function stripSetPrefix(name: string): string {
  return name.replace(/^[^:]{1,24}:\s*/, "").replace(/^(scarlet & violet|sword & shield|sun & moon)\s*[—–-]\s*/i, "");
}

export interface MatchResult<T> {
  match: T | null;
  candidates: T[];
}

function closeCandidates<T extends { name: string }>(target: string, items: T[], minWords: number): T[] {
  const words = target.split(" ").filter((w) => w.length > 3);
  return items.filter((i) => words.filter((w) => normalizeName(i.name).includes(w)).length >= minWords).slice(0, 5);
}

/** Match a set by TCGplayer group id when known, otherwise by exact (prefix-stripped) name. */
export function matchSet<T extends { name: string; tcgplayer_id?: number | null }>(
  set: { name: string; tcgplayerGroupId?: number | null },
  sets: T[],
): MatchResult<T> {
  if (set.tcgplayerGroupId) {
    const byId = sets.find((s) => s.tcgplayer_id === set.tcgplayerGroupId);
    if (byId) return { match: byId, candidates: [byId] };
  }
  const target = normalizeName(stripSetPrefix(set.name));
  const exact = sets.filter((s) => normalizeName(stripSetPrefix(s.name)) === target);
  if (exact.length === 1) return { match: exact[0], candidates: exact };
  return { match: null, candidates: exact.length > 1 ? exact : closeCandidates(target, sets, 1) };
}

export function matchSealedProduct<T extends { name: string }>(name: string, products: T[]): MatchResult<T> {
  const target = normalizeName(name);
  const exact = products.filter((p) => normalizeName(p.name) === target);
  if (exact.length === 1) return { match: exact[0], candidates: exact };
  return { match: null, candidates: exact.length > 1 ? exact : closeCandidates(target, products, 2) };
}

export interface CardUpsert {
  name: string;
  number: string | null;
  rarity: string | null;
  printing: string;
  image_url: string | null;
  tcgplayer_product_id: number;
  tcgapi_id: number;
}

/**
 * One catalog row per card x printing. Printings come from the set's price
 * rows when available (every printing), otherwise each card's primary printing.
 */
export function cardRowsFromSet(cards: TcgApiCard[], priceRows: TcgApiPriceRow[] | null): CardUpsert[] {
  const printings = new Map<number, Set<string>>();
  for (const r of priceRows ?? []) {
    if (!r.tcgplayer_id) continue;
    const set = printings.get(r.tcgplayer_id) ?? new Set<string>();
    set.add(r.printing ?? "Normal");
    printings.set(r.tcgplayer_id, set);
  }
  const rows: CardUpsert[] = [];
  for (const c of cards) {
    if (!c.tcgplayer_id) continue;
    const forCard = printings.get(c.tcgplayer_id) ?? new Set([c.printing ?? "Normal"]);
    for (const printing of forCard) {
      rows.push({
        name: cleanCardName(c.name),
        number: c.number ?? null,
        rarity: c.rarity ?? null,
        printing,
        image_url: safeImageUrl(c.image_url),
        tcgplayer_product_id: c.tcgplayer_id,
        tcgapi_id: c.id,
      });
    }
  }
  return rows;
}
