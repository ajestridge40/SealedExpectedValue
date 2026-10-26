"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { safeNext } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export interface FormState {
  error?: string;
  message?: string;
}

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const password = z.string().min(8, "Use at least 8 characters.").max(72);

async function siteUrl(): Promise<string> {
  const configured = publicEnv()?.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signIn(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: z.string().min(1).max(72) }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Incorrect email or password, or the email is not confirmed yet." };
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.object({ email, password }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${await siteUrl()}/auth/callback?next=/` },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/");
  return { message: "Check your inbox to confirm your email address, then sign in." };
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(safeNext(formData.get("next")))}` },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = email.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/auth/update-password`,
  });
  // Same response whether or not the account exists.
  return { message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePassword(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, "Passwords do not match.")
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Could not update the password. The reset link may have expired; request a new one." };
  redirect("/settings?updated=password");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
