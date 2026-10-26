"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { runCatalogImport } from "@/lib/catalog/import";
import { parsePriceCsv } from "@/lib/pricing/csv-import";
import { runPriceRefresh } from "@/lib/pricing/refresh";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

const manualPrice = z.object({
  kind: z.enum(["sealed", "card"]),
  id: z.string().uuid(),
  path: z.string().startsWith("/").max(300),
  price: z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 129.99"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
});

/** Record an admin-observed price. RLS also enforces admin-only writes. */
export async function setManualPrice(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = manualPrice.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const asOf = new Date(`${v.as_of}T12:00:00Z`);
  if (asOf.getTime() > Date.now() + 86_400_000) return { error: "The date cannot be in the future." };

  const supabase = await createClient();
  const { data: source } = await supabase.from("data_sources").select("id").eq("slug", "manual").single();
  if (!source) return { error: "The 'manual' data source is missing. Run the seed." };
  const { error } = await supabase.from("price_snapshots").upsert(
    {
      [v.kind === "sealed" ? "sealed_product_id" : "card_id"]: v.id,
      source_id: source.id,
      source_kind: "manual",
      currency: v.currency,
      market_price: v.price,
      provider_as_of: asOf.toISOString(),
      snapshot_date: v.as_of,
      note: v.note || null,
      created_by: user.id,
    },
    {
      onConflict: v.kind === "sealed" ? "sealed_product_id,source_id,snapshot_date" : "card_id,source_id,snapshot_date",
    },
  );
  if (error) return { error: error.message };
  revalidatePath(v.path);
  return { message: "Saved. Manual prices are labelled as such." };
}

export interface CsvImportState extends FormState {
  imported?: number;
  rowErrors?: { line: number; message: string }[];
}

/** Import prices from an uploaded CSV (validated row by row). */
export async function importPriceCsv(_: CsvImportState, formData: FormData): Promise<CsvImportState> {
  const user = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 1_000_000) return { error: "File is larger than 1 MB." };
  if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return { error: "Upload a .csv file." };

  const { rows, errors } = parsePriceCsv(await file.text());
  if (rows.length === 0) return { error: "No valid rows found.", rowErrors: errors.slice(0, 50) };

  const supabase = await createClient();
  const { data: source } = await supabase.from("data_sources").select("id").eq("slug", "csv_import").single();
  if (!source) return { error: "The 'csv_import' data source is missing. Run the seed." };

  // Resolve tcgplayer ids to internal ids.
  const tcgIds = [
    ...new Set(rows.filter((r) => !r.item_id && r.tcgplayer_product_id).map((r) => r.tcgplayer_product_id!)),
  ];
  const [{ data: prods }, { data: cards }] = await Promise.all([
    supabase.from("sealed_products").select("id, tcgplayer_product_id").in("tcgplayer_product_id", tcgIds),
    supabase.from("cards").select("id, tcgplayer_product_id, printing").in("tcgplayer_product_id", tcgIds),
  ]);

  const unresolved: { line: number; message: string }[] = [];
  const snapshots = rows.flatMap((r, i) => {
    let id = r.item_id;
    if (!id && r.item_type === "sealed") id = prods?.find((p) => p.tcgplayer_product_id === r.tcgplayer_product_id)?.id;
    if (!id && r.item_type === "card")
      id = cards?.find(
        (c) =>
          c.tcgplayer_product_id === r.tcgplayer_product_id && c.printing.toLowerCase() === r.printing.toLowerCase(),
      )?.id;
    if (!id) {
      unresolved.push({ line: i + 2, message: "No catalog item with that id" });
      return [];
    }
    const asOf = new Date(r.as_of);
    return [
      {
        sealed_product_id: r.item_type === "sealed" ? id : null,
        card_id: r.item_type === "card" ? id : null,
        source_id: source.id,
        source_kind: "csv_import" as const,
        currency: r.currency,
        market_price: r.market_price,
        provider_as_of: asOf.toISOString(),
        snapshot_date: asOf.toISOString().slice(0, 10),
        note: r.note || null,
        created_by: user.id,
      },
    ];
  });

  let imported = 0;
  for (const kind of ["sealed", "card"] as const) {
    const batch = snapshots.filter((s) => (kind === "sealed" ? s.sealed_product_id : s.card_id));
    // De-duplicate per item+day (last row wins) so one upsert batch has no conflicts with itself.
    const unique = [
      ...new Map(batch.map((s) => [`${s.sealed_product_id ?? s.card_id}|${s.snapshot_date}`, s])).values(),
    ];
    if (unique.length === 0) continue;
    const { error } = await supabase.from("price_snapshots").upsert(unique, {
      onConflict: kind === "sealed" ? "sealed_product_id,source_id,snapshot_date" : "card_id,source_id,snapshot_date",
    });
    if (error) return { error: error.message, imported, rowErrors: [...errors, ...unresolved].slice(0, 50) };
    imported += unique.length;
  }
  revalidatePath("/", "layout");
  return {
    message: `Imported ${imported} price(s) as "CSV import".`,
    imported,
    rowErrors: [...errors, ...unresolved].sort((a, b) => a.line - b.line).slice(0, 50),
  };
}

export async function refreshPricesNow(_: FormState): Promise<FormState> {
  await requireAdmin();
  try {
    const report = await runPriceRefresh(createAdminClient(), { force: true });
    revalidatePath("/", "layout");
    if (report.status === "skipped") return { message: `Skipped: ${report.reason}` };
    const summary =
      `${report.status}: ${report.snapshotsWritten} prices saved from ${report.setsProcessed} set(s).` +
      (report.allPrintings === false ? " Your TCG API plan returns only each card's main printing." : "") +
      (report.requestsRemainingToday != null ? ` TCG API requests left today: ${report.requestsRemainingToday}.` : "");
    return report.errors.length
      ? { error: `${summary} Errors: ${report.errors.slice(0, 5).join(" | ")}` }
      : { message: summary };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function importCatalogNow(_: FormState): Promise<FormState> {
  await requireAdmin();
  try {
    const r = await runCatalogImport(createAdminClient());
    revalidatePath("/", "layout");
    const parts = [
      `${r.setsLinked.length} set(s) linked`,
      `${r.productsLinked.length} product(s) linked`,
      `${r.cardsUpserted} card printings saved`,
    ];
    const attention = [...r.needsAttention, ...r.errors];
    return attention.length
      ? { error: `${parts.join(", ")}. Needs attention: ${attention.slice(0, 8).join(" | ")}` }
      : { message: `${parts.join(", ")}. Now run a price refresh.` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
