"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

export interface LotFormState extends FormState {
  fieldErrors?: Record<string, string>;
  /** Submitted values, echoed back so a failed submission keeps the user's input. */
  values?: Record<string, string>;
  /** Incremented on each failed submission; the form remounts so selects keep the echoed values. */
  attempt?: number;
}

const money = (label: string) =>
  z
    .string()
    .trim()
    .transform((s) => (s === "" ? "0" : s))
    .pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, `${label}: enter an amount like 12.50`));
const optionalMoney = z
  .string()
  .trim()
  .optional()
  .transform((s) => (s ? s : null))
  .pipe(
    z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 12.50")
      .nullable(),
  );
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));
const date = z
  .string()
  .trim()
  .optional()
  .transform((s) => (s ? s : null))
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((s) => Date.parse(s) <= Date.now() + 86_400_000, "Purchase date cannot be in the future")
      .nullable(),
  );

const common = {
  id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  item_id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  custom_name: text(200),
  custom_set_name: text(200),
  quantity: z.coerce.number().int("Quantity must be a whole number").min(1, "Quantity must be at least 1").max(100000),
  purchase_price_per_unit: money("Purchase price"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
  purchase_date: date,
  notes: text(2000),
  manual_unit_value: optionalMoney,
};

const sealedSchema = z
  .object({
    ...common,
    fees: money("Fees"),
    shipping: money("Shipping"),
    condition: text(60),
    storage_location: text(200),
  })
  .refine((v) => v.item_id || v.custom_name, {
    message: "Choose a product or enter a custom name",
    path: ["custom_name"],
  });

const cardSchema = z
  .object({
    ...common,
    condition: text(60),
    language: z.string().trim().min(1).max(40).default("English"),
    grading_company: text(40),
    grade: text(20),
    grading_fees: money("Grading fees"),
    acquisition_fees: money("Acquisition fees"),
  })
  .refine((v) => v.item_id || v.custom_name, { message: "Choose a card or enter a custom name", path: ["custom_name"] })
  .refine((v) => !v.grading_company || v.grading_company === "None" || v.grade, {
    message: "Enter the grade for a graded card",
    path: ["grade"],
  });

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}

export async function saveLot(type: "sealed" | "card", prev: LotFormState, formData: FormData): Promise<LotFormState> {
  const attempt = (prev.attempt ?? 0) + 1;
  const user = await requireUser("/collection");
  const raw = Object.fromEntries(
    [...formData.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]),
  );
  const supabase = await createClient();

  let id: string | undefined;
  let error: { message: string } | null;
  if (type === "sealed") {
    const parsed = sealedSchema.safeParse(raw);
    if (!parsed.success)
      return {
        error: "Please fix the highlighted fields.",
        fieldErrors: fieldErrors(parsed.error),
        values: raw,
        attempt,
      };
    const { id: lotId, item_id, ...v } = parsed.data;
    id = lotId;
    const row = {
      ...v,
      user_id: user.id,
      sealed_product_id: item_id ?? null,
      custom_name: item_id ? null : v.custom_name,
      custom_set_name: item_id ? null : v.custom_set_name,
      manual_value_as_of: v.manual_unit_value ? new Date().toISOString() : null,
    };
    ({ error } = id
      ? await supabase.from("collection_sealed_positions").update(row).eq("id", id).eq("user_id", user.id)
      : await supabase.from("collection_sealed_positions").insert(row));
  } else {
    const parsed = cardSchema.safeParse(raw);
    if (!parsed.success)
      return {
        error: "Please fix the highlighted fields.",
        fieldErrors: fieldErrors(parsed.error),
        values: raw,
        attempt,
      };
    const { id: lotId, item_id, ...v } = parsed.data;
    id = lotId;
    const graded = v.grading_company && v.grading_company !== "None";
    const row = {
      ...v,
      user_id: user.id,
      card_id: item_id ?? null,
      custom_name: item_id ? null : v.custom_name,
      custom_set_name: item_id ? null : v.custom_set_name,
      grading_company: graded ? v.grading_company : null,
      grade: graded ? v.grade : null,
      manual_value_as_of: v.manual_unit_value ? new Date().toISOString() : null,
    };
    ({ error } = id
      ? await supabase.from("collection_card_positions").update(row).eq("id", id).eq("user_id", user.id)
      : await supabase.from("collection_card_positions").insert(row));
  }
  if (error) return { error: "Could not save this entry. Please try again.", values: raw, attempt };
  revalidatePath("/collection");
  revalidatePath("/");
  redirect(`/collection?type=${type}&saved=1`);
}

export async function deleteLot(formData: FormData): Promise<void> {
  const user = await requireUser("/collection");
  const parsed = z
    .object({ type: z.enum(["sealed", "card"]), id: z.string().uuid() })
    .safeParse({ type: formData.get("type"), id: formData.get("id") });
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from(parsed.data.type === "sealed" ? "collection_sealed_positions" : "collection_card_positions")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);
  revalidatePath("/collection");
  revalidatePath("/");
}
