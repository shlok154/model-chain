import { createClient } from "@supabase/supabase-js";

// These come from your Supabase project dashboard → Settings → API
// Copy them into a .env file at the root of your project:
//
//   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
//
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && import.meta.env.DEV) {
  console.warn(
    "[ModelChain] Supabase env vars not set. " +
    "Create a .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(
  SUPABASE_URL ?? "https://placeholder.supabase.co",
  SUPABASE_ANON_KEY ?? "placeholder"
);

// Helper: check if Supabase is properly configured
export function isSupabaseReady(): boolean {
  return (
    !!SUPABASE_URL &&
    !!SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes("placeholder")
  );
}
