import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "../env";

/**
 * Service-role client: bypasses RLS. Use only in trusted server code (the
 * scheduled refresh, catalog import, account deletion), never with
 * user-controlled filters, and never import it from a client component.
 */
export function createAdminClient() {
  const env = publicEnv();
  if (!env) throw new Error("Supabase is not configured.");
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
