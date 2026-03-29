/**
 * Profile hooks — all authenticated reads and writes go through the FastAPI
 * backend (/api/users/me) rather than directly to Supabase.
 *
 * Why: the frontend uses the app's own JWT, not a Supabase auth session.
 * The Supabase JS client sends the anon key without the app JWT in the
 * postgrest-jwt header, so RLS policies keyed on
 *   current_setting('request.jwt.claims')
 * always see NULL for wallet_address and reject all authenticated operations.
 *
 * FastAPI validates the JWT, extracts the wallet, and uses the service key
 * with an explicit WHERE clause — this is the correct access-control path.
 *
 * Public profile reads still fall back to direct Supabase (anon key) since
 * those rows are covered by the "Public read users" policy (using true).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { api, API_BASE } from "../lib/api";
import { supabase, isSupabaseReady } from "../lib/supabase";
import type { UserProfile } from "../types";

export const profileKeys = {
  own:    (address: string) => ["profile", address] as const,
  public: (address: string) => ["profile", "public", address] as const,
};

function demoProfile(address: string): UserProfile {
  return {
    wallet_address: address, display_name: null, bio: null,
    avatar_url: null, twitter: null, github: null,
    is_verified: false, created_at: new Date().toISOString(),
  };
}

// ── Own profile (authenticated) ────────────────────────────────────────────────

export function useOwnProfile(address: string | null) {
  const { token } = useAuth();

  return useQuery({
    queryKey: profileKeys.own(address ?? ""),
    queryFn: async (): Promise<UserProfile> => {
      if (!address) return demoProfile("");

      // Primary path: backend API (JWT-authenticated, uses service key)
      if (token) {
        try {
          return await api.get<UserProfile>("/api/users/me", token);
        } catch { /* fall through to Supabase */ }
      }

      // Fallback: direct Supabase public read (only works because "Public read users" allows it)
      if (isSupabaseReady()) {
        const { data, error } = await supabase
          .from("users").select("*")
          .eq("wallet_address", address.toLowerCase()).single();
        if (!error && data) return data;

        // Row absent — create via backend if we have a token, else return demo
        if (error?.code === "PGRST116" && token) {
          try {
            return await api.get<UserProfile>("/api/users/me", token);
          } catch { /* give up */ }
        }
      }

      return demoProfile(address);
    },
    enabled: !!address,
    staleTime: 60_000,
  });
}

// ── Public profile (no auth required) ─────────────────────────────────────────

export function usePublicProfile(address: string | null) {
  const { token } = useAuth();

  return useQuery({
    queryKey: profileKeys.public(address ?? ""),
    queryFn: async () => {
      if (!address) return null;

      // Try backend first (returns more reliable data)
      try {
        return await api.get<UserProfile>(`/api/users/${address}`, token);
      } catch { /* fallback */ }

      // Supabase anon read — covered by "Public read users" policy
      if (isSupabaseReady()) {
        const { data } = await supabase.from("users").select("*")
          .eq("wallet_address", address.toLowerCase()).single();
        if (data) return data as UserProfile;
      }

      return demoProfile(address);
    },
    enabled: !!address,
    staleTime: 120_000,
  });
}

// ── Save own profile ───────────────────────────────────────────────────────────

export function useSaveProfile(address: string | null) {
  const qc = useQueryClient();
  const { token } = useAuth();

  return useMutation({
    mutationFn: async (
      updates: Partial<Pick<UserProfile, "display_name" | "bio" | "avatar_url" | "twitter" | "github">>
    ): Promise<UserProfile> => {
      if (!address) throw new Error("Not connected");

      // Backend route (PATCH /api/users/me) — uses service key after JWT verify.
      // This is the ONLY safe path: direct supabase.update() would hit the
      // "Users update own profile" RLS policy which needs the JWT claim injected
      // into the Supabase client header — we don't do that, so it always fails.
      if (token) {
        return await fetch(`${API_BASE}/api/users/me`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updates),
        }).then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(body.detail ?? "Profile update failed");
          }
          return res.json() as Promise<UserProfile>;
        });
      }

      // Demo / unauthenticated — return the updates as-is (no persistence)
      return { ...demoProfile(address), ...updates };
    },

    onSuccess: (data) => {
      if (address) {
        // Update the cache immediately so UI reflects the change without refetch
        qc.setQueryData(profileKeys.own(address), (old: UserProfile | undefined) =>
          old ? { ...old, ...data } : data
        );
        // Also invalidate so next mount gets the freshest server copy
        qc.invalidateQueries({ queryKey: profileKeys.own(address) });
      }
    },
  });
}
