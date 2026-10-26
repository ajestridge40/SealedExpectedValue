import {
  cleanCardName,
  isCardProduct,
  type TcgGroup,
  type TcgPrice,
  type TcgProduct,
} from "../pricing/providers/tcgtracking";
import { safeImageUrl } from "../pricing/types";

/*
 * Strict name matching between our catalog and TCGplayer (via TCGTracking).
 * Only exact matches after normalization are accepted; anything ambiguous is
 * reported for a human to resolve by setting the id by hand.
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

export function matchGroup(setName: string, groups: TcgGroup[]): MatchResult<TcgGroup> {
  const target = normalizeName(stripSetPrefix(setName));
  const exact = groups.filter((g) => normalizeName(stripSetPrefix(g.name)) === target);
  if (exact.length === 1) return { match: exact[0], candidates: exact };
  const words = target.split(" ").filter((w) => w.length > 3);
  const candidates =
    exact.length > 1 ? exact : groups.filter((g) => words.some((w) => normalizeName(g.name).includes(w))).slice(0, 5);
  return { match: null, candidates };
}

export function matchSealedProduct(name: string, products: TcgProduct[]): MatchResult<TcgProduct> {
  const sealed = products.filter((p) => !isCardProduct(p));
  const target = normalizeName(name);
  const exact = sealed.filter((p) => normalizeName(p.name) === target);
  if (exact.length === 1) return { match: exact[0], candidates: exact };
  const words = target.split(" ").filter((w) => w.length > 3);
  const candidates =
    exact.length > 1
      ? exact
      : sealed.filter((p) => words.filter((w) => normalizeName(p.name).includes(w)).length >= 2).slice(0, 5);
  return { match: null, candidates };
}

export interface CardUpsert {
  name: string;
  number: string | null;
  rarity: string | null;
  printing: string;
  image_url: string | null;
  tcgplayer_product_id: number;
}

/** One catalog row per card x printing that TCGplayer prices separately. */
export function cardRowsFromGroup(products: TcgProduct[], prices: TcgPrice[]): CardUpsert[] {
  const printingsById = new Map<number, Set<string>>();
  for (const p of prices) {
    const set = printingsById.get(p.productId) ?? new Set<string>();
    set.add(p.subTypeName ?? "Normal");
    printingsById.set(p.productId, set);
  }
  const rows: CardUpsert[] = [];
  for (const p of products) {
    if (!isCardProduct(p)) continue;
    const ext = (k: string) => p.extendedData?.find((e) => e.name === k)?.value ?? null;
    for (const printing of printingsById.get(p.productId) ?? new Set(["Normal"])) {
      rows.push({
        name: cleanCardName(p.name),
        number: ext("Number"),
        rarity: ext("Rarity"),
        printing,
        image_url: safeImageUrl(p.imageUrl),
        tcgplayer_product_id: p.productId,
      });
    }
  }
  return rows;
}
