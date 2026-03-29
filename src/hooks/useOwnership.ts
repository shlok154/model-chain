/**
 * useOwnership — cached set of model IDs the current user owns.
 *
 * Uses React Query so ownership data is cached, deduplicated, and
 * automatically refreshed after purchases. Components can call
 * `owns(modelId)` for an O(1) lookup without extra fetches.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { useWallet } from "../context/WalletContext";
import { api } from "../lib/api";

export const ownershipKeys = {
  all: ["ownership"] as const,
  user: (addr: string) => ["ownership", addr] as const,
};

interface PurchaseRow {
  model_id: number;
}

export function useOwnership() {
  const { address } = useWallet();
  const { token } = useAuth();
  const qc = useQueryClient();

  const { data: ownedIds = [] } = useQuery({
    queryKey: ownershipKeys.user(address ?? ""),
    queryFn: async (): Promise<number[]> => {
      if (!address || !token) return [];
      try {
        const rows = await api.get<PurchaseRow[]>("/api/users/me/purchases", token);
        return (rows ?? []).map((p) => p.model_id);
      } catch {
        return [];
      }
    },
    enabled: !!address && !!token,
    staleTime: 5 * 60_000, // ownership rarely changes mid-session — cache 5 min
  });

  /** O(1) ownership check */
  const owns = (modelId: number) => ownedIds.includes(modelId);

  /** Call after a successful purchase to instantly update the cache */
  const markOwned = (modelId: number) => {
    qc.setQueryData(ownershipKeys.user(address ?? ""), (prev: number[] | undefined) => {
      const current = prev ?? [];
      return current.includes(modelId) ? current : [...current, modelId];
    });
  };

  /** Force refresh from backend */
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ownershipKeys.user(address ?? "") });
  };

  return { ownedIds, owns, markOwned, refresh };
}
