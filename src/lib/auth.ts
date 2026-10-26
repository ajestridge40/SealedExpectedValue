import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { publicEnv } from "./env";
import { createClient } from "./supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface Profile {
  id: string;
  display_name: string | null;
  default_currency: string;
  preferred_game_id: string | null;
  price_stale_after_hours: number;
  is_admin: boolean;
}

/** The signed-in user (JWT verified by Supabase), or null. Cached per request. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Session-dependent: never prerender at build time.
  await connection();
  if (!publicEnv()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: (claims.email as string | undefined) ?? null };
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, default_currency, preferred_game_id, price_stale_after_hours, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
});

export async function requireUser(next = "/"): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser("/admin");
  const profile = await getProfile();
  if (!profile?.is_admin) redirect("/");
  return user;
}

/** Stale threshold for the current viewer (profile preference or default). */
export async function staleAfterHours(): Promise<number> {
  return (await getProfile())?.price_stale_after_hours ?? 72;
}
