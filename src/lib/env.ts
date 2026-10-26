import { z } from "zod";

/*
 * Environment configuration, validated with Zod.
 *
 * NEXT_PUBLIC_* values are embedded in the browser bundle. The Supabase URL
 * and publishable (anon) key are designed to be public: Row Level Security is
 * what protects the data. Everything else here is server-only and must never
 * be prefixed with NEXT_PUBLIC_.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/** Public config, or null when Supabase is not configured yet (setup screen). */
export function publicEnv(): PublicEnv | null {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Supabase now calls this the "publishable" key; accept either name.
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
  return parsed.success ? parsed.data : null;
}

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

/** Server-only secrets. Throws if missing; call only from server code that needs them. */
export function serverEnv() {
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!parsed.success) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is not set.");
  }
  return parsed.data;
}

export const config = {
  cronSecret: () => process.env.CRON_SECRET || null,
  enableTcgcsv: () => process.env.ENABLE_TCGCSV !== "0",
  enablePokemonTcg: () => process.env.ENABLE_POKEMONTCG === "1",
  /** Skip a scheduled refresh if the last successful one is newer than this. */
  refreshMinIntervalHours: () => Number(process.env.PRICE_REFRESH_MIN_INTERVAL_HOURS ?? 12),
  defaultStaleAfterHours: 72,
};
