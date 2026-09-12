// BYO external Supabase: admin client for the external project.
// Replaces the generated client.server.ts admin client for the exposure cache
// write, which must never target the managed Lovable Cloud database.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/**
 * Admin client for the external Supabase project. Reads the external secret key
 * from EXTERNAL_SUPABASE_SERVICE_KEY (never from the managed project's vars).
 * Returns null when the key is not configured yet, so callers can degrade
 * gracefully instead of writing to the wrong database.
 */
export function getExternalAdminClient() {
  const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"];
  const SERVICE_KEY = process.env["EXTERNAL_SUPABASE_SERVICE_KEY"];

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "[Supabase] Admin access to the external project unavailable: EXTERNAL_SUPABASE_SERVICE_KEY is not set. Skipping privileged write.",
    );
    return null;
  }

  return createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    global: {
      fetch: createSupabaseFetch(SERVICE_KEY),
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
