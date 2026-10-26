import { z } from "zod";
import type { ProductFilters } from "./summaries";
import { param } from "../utils";

const num = z.coerce.number().finite().nonnegative().max(1_000_000);

export function parseProductFilters(sp: Record<string, string | string[] | undefined>): ProductFilters {
  const opt = <T>(schema: z.ZodType<T>, v: string | undefined) => {
    if (v === undefined) return undefined;
    const r = schema.safeParse(v);
    return r.success ? r.data : undefined;
  };
  return {
    q: param(sp, "q"),
    game: opt(z.string().uuid(), param(sp, "game")),
    set: opt(z.string().uuid(), param(sp, "set")),
    type: param(sp, "type"),
    minPrice: opt(num, param(sp, "minPrice")),
    maxPrice: opt(num, param(sp, "maxPrice")),
    minRatio: opt(num, param(sp, "minRatio")),
    net: opt(z.enum(["positive", "negative"]), param(sp, "net")),
    confidence: opt(z.enum(["high", "medium", "low", "insufficient"]), param(sp, "confidence")),
    sort: opt(z.enum(["ratio", "ev", "price", "net", "release", "top5", "change"]), param(sp, "sort")),
  };
}
