import type { ProductType } from "../data/types";

/**
 * Classify a sealed product from its TCGplayer name. Returns null for things
 * that are not tracked as sealed products (cases of boxes, code cards, etc.).
 */
export function classifySealed(name: string): { type: ProductType; packs: number | null } | null {
  const n = name.toLowerCase();
  if (/\bcase\b|code card|\bdigital\b|\bsleeves?\b|deck box|playmat|binder|portfolio|\bdice\b/.test(n)) return null;
  const packs = (() => {
    const m = n.match(/(\d+)\s*(?:booster\s*)?packs?\b/);
    return m ? Number(m[1]) : null;
  })();
  if (/elite trainer box|\betb\b/.test(n)) return { type: "elite_trainer_box", packs: packs ?? 9 };
  if (/booster (box|display)|display box|play booster display|draft booster display/.test(n))
    return { type: "booster_box", packs };
  if (/booster bundle|\bbundle\b/.test(n)) return { type: "booster_bundle", packs: packs ?? 6 };
  if (/\btin\b/.test(n)) return { type: "tin", packs };
  if (/blister|checklane|3 pack|three pack/.test(n)) return { type: "blister", packs };
  if (/collection|premium|box set|gift set|trove|chest|starter|deck/.test(n)) return { type: "collection_box", packs };
  if (/booster pack|\bpack\b|sleeved booster/.test(n)) return { type: "booster_pack", packs: 1 };
  return { type: "other", packs };
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}
