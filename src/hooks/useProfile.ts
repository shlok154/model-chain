import { useState, useCallback } from "react";
import { supabase, isSupabaseReady } from "../lib/supabase";
import type { UserProfile } from "../types";

// Fallback demo profile when Supabase is not configured
function demoProfile(address: string): UserProfile {
  return {
    wallet_address: address,
    display_name: null,
    bio: null,
    avatar_url: null,
    twitter: null,
    github: null,
    is_verified: false,
    created_at: new Date().toISOString(),
  };
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch a profile by wallet address.
  // If the row doesn't exist yet, create it automatically (upsert on first load).
  const fetchProfile = useCallback(async (address: string) => {
    setIsLoading(true);
    setError(null);

    if (!isSupabaseReady()) {
      // Demo mode — no Supabase configured
      await new Promise((r) => setTimeout(r, 300));
      setProfile(demoProfile(address));
      setIsLoading(false);
      return;
    }

    try {
      const { data, error: fetchErr } = await supabase
        .from("users")
        .select("*")
        .eq("wallet_address", address.toLowerCase())
        .single();

      if (fetchErr && fetchErr.code === "PGRST116") {
        // Row doesn't exist — create it
        const { data: created, error: insertErr } = await supabase
          .from("users")
          .insert({ wallet_address: address.toLowerCase() })
          .select()
          .single();

        if (insertErr) throw insertErr;
        setProfile(created);
      } else if (fetchErr) {
        throw fetchErr;
      } else {
        setProfile(data);
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to load profile");
      setProfile(demoProfile(address));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch any public profile by wallet address (for viewing other creators)
  const fetchPublicProfile = useCallback(
    async (address: string): Promise<UserProfile | null> => {
      if (!isSupabaseReady()) return demoProfile(address);
      try {
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("wallet_address", address.toLowerCase())
          .single();
        if (error) return null;
        return data;
      } catch {
        return null;
      }
    },
    []
  );

  // Save profile updates
  const saveProfile = useCallback(
    async (
      address: string,
      updates: Partial<Pick<UserProfile, "display_name" | "bio" | "avatar_url" | "twitter" | "github">>
    ) => {
      setIsSaving(true);
      setError(null);
      setSaveSuccess(false);

      if (!isSupabaseReady()) {
        await new Promise((r) => setTimeout(r, 800));
        setProfile((prev) => prev ? { ...prev, ...updates } : null);
        setSaveSuccess(true);
        setIsSaving(false);
        return;
      }

      try {
        const { data, error: updateErr } = await supabase
          .from("users")
          .update(updates)
          .eq("wallet_address", address.toLowerCase())
          .select()
          .single();

        if (updateErr) throw updateErr;
        setProfile(data);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } catch (err: any) {
        setError(err.message ?? "Failed to save profile");
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  return {
    profile,
    isLoading,
    isSaving,
    error,
    saveSuccess,
    fetchProfile,
    fetchPublicProfile,
    saveProfile,
    isDemo: !isSupabaseReady(),
  };
}
