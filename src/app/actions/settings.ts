"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(80)
    .transform((s) => s || null),
  default_currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as USD"),
  preferred_game_id: z
    .string()
    .uuid()
    .or(z.literal("").transform(() => null)),
  price_stale_after_hours: z.coerce.number().int().min(24).max(720),
});

export async function updateProfile(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/settings");
  const parsed = profileSchema.safeParse({
    display_name: formData.get("display_name") ?? "",
    default_currency: formData.get("default_currency"),
    preferred_game_id: formData.get("preferred_game_id") ?? "",
    price_stale_after_hours: formData.get("price_stale_after_hours"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", user.id);
  if (error) return { error: "Could not save settings." };
  revalidatePath("/", "layout");
  return { message: "Settings saved." };
}

/**
 * Permanently delete the account. Deleting the auth user cascades to the
 * profile, collection lots and watchlist (ON DELETE CASCADE).
 */
export async function deleteAccount(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/settings");
  if (String(formData.get("confirm") ?? "").trim() !== "DELETE") {
    return { error: "Type DELETE to confirm." };
  }
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: "Could not delete the account. Please try again or contact the site owner." };
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}
