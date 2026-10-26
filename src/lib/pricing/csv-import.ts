import Papa from "papaparse";
import { z } from "zod";

/*
 * Validation for admin price CSV uploads. Imported prices are stored with
 * source_kind = 'csv_import' and are never presented as live provider data.
 *
 * Columns (header row required):
 *   item_type             sealed | card
 *   item_id               internal uuid  (or tcgplayer_product_id)
 *   tcgplayer_product_id  integer        (or item_id)
 *   printing              card printing when matching by tcgplayer id (default Normal)
 *   market_price          decimal, required
 *   currency              ISO code, default USD
 *   as_of                 ISO date/time the price was observed, required
 *   note                  optional, e.g. where the price came from
 */

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 5_000;

const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "must be a non-negative amount with at most 2 decimals");

export const priceCsvRowSchema = z
  .object({
    item_type: z.enum(["sealed", "card"]),
    item_id: z.string().trim().uuid().optional().or(z.literal("").transform(() => undefined)),
    tcgplayer_product_id: z
      .string()
      .trim()
      .regex(/^\d{1,10}$/)
      .transform(Number)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    printing: z.string().trim().max(60).optional().default("Normal").transform((s) => s || "Normal"),
    market_price: decimalString,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional()
      .default("USD")
      .or(z.literal("").transform(() => "USD")),
    as_of: z
      .string()
      .trim()
      .refine((s) => !Number.isNaN(Date.parse(s)), "must be a date")
      .refine((s) => Date.parse(s) <= Date.now() + 86_400_000, "cannot be in the future"),
    note: z.string().trim().max(500).optional(),
  })
  .refine((r) => r.item_id || r.tcgplayer_product_id, "item_id or tcgplayer_product_id is required");

export type PriceCsvRow = z.infer<typeof priceCsvRowSchema>;

export interface ParseResult {
  rows: PriceCsvRow[];
  errors: { line: number; message: string }[];
}

export function parsePriceCsv(text: string): ParseResult {
  if (text.length > MAX_CSV_BYTES) return { rows: [], errors: [{ line: 0, message: "File is larger than 1 MB." }] };
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const errors: ParseResult["errors"] = parsed.errors.map((e) => ({ line: (e.row ?? 0) + 2, message: e.message }));
  if (parsed.data.length > MAX_CSV_ROWS) {
    return { rows: [], errors: [{ line: 0, message: `At most ${MAX_CSV_ROWS} rows per file.` }] };
  }
  const required = ["item_type", "market_price", "as_of"];
  const missing = required.filter((h) => !parsed.meta.fields?.includes(h));
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}` }] };

  const rows: PriceCsvRow[] = [];
  parsed.data.forEach((raw, i) => {
    const r = priceCsvRowSchema.safeParse(raw);
    if (r.success) rows.push(r.data);
    else errors.push({ line: i + 2, message: r.error.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`).join("; ") });
  });
  return { rows, errors };
}
