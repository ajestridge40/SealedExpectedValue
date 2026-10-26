"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const input = z.object({
  kind: z.enum(["sealed", "card"]),
  id: z.string().uuid(),
  path: z.string().startsWith("/").max(300),
});

/** Add or remove a product/card on the signed-in user's watchlist. */
export async function toggleWatch(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = input.safeParse({ kind: formData.get("kind"), id: formData.get("id"), path: formData.get("path") });
  if (!parsed.success) return;
  const { kind, id, path } = parsed.data;
  const column = kind === "sealed" ? "sealed_product_id" : "card_id";
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("watchlist_items")
    .select("id")
    .eq("user_id", user.id)
    .eq(column, id)
    .maybeSingle();
  if (existing) {
    await supabase.from("watchlist_items").delete().eq("id", existing.id).eq("user_id", user.id);
  } else {
    await supabase.from("watchlist_items").insert({ user_id: user.id, [column]: id });
  }
  revalidatePath(path);
  revalidatePath("/watchlist");
}

export async function removeWatch(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase.from("watchlist_items").delete().eq("id", id.data).eq("user_id", user.id);
  revalidatePath("/watchlist");
}
