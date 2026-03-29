/**
 * Phase 5 — React Query hooks replacing manual useState/useEffect fetching.
 * Automatic caching, background refetch, retry, and stale-while-revalidate.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { supabase, isSupabaseReady } from "../lib/supabase";
import type { Model } from "../types";

// ── Query keys (centralised so invalidation is consistent) ───────────────────
export const modelKeys = {
  all:     ["models"] as const,
  list:    (params: object) => ["models", "list", params] as const,
  detail:  (id: number)     => ["models", "detail", id] as const,
  reviews: (id: number)     => ["models", "reviews", id] as const,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const DEMO_MODELS: Model[] = [
  { id: 1, name: "Sentiment Analyzer Pro", description: "Fine-tuned BERT for real-time sentiment classification across 12 languages.", price: "0.08", priceWei: ethers.parseEther("0.08"), creator: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", ipfsHash: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco", version: "2.1.0", license: "MIT", category: "NLP", royaltyPercent: 10, purchases: 142 },
  { id: 2, name: "VisionNet Edge", description: "Lightweight object detection optimized for edge deployment. Runs at 60fps on mobile GPUs.", price: "0.14", priceWei: ethers.parseEther("0.14"), creator: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B", ipfsHash: "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o", version: "1.3.2", license: "Apache 2.0", category: "Computer Vision", royaltyPercent: 8, purchases: 89 },
  { id: 3, name: "LLM Mini 7B", description: "Quantized 7B language model fine-tuned for code generation and debugging.", price: "0.22", priceWei: ethers.parseEther("0.22"), creator: "0x1db3439a222c519ab44bb1144fC28167b4Fa6EE6", ipfsHash: "QmSiTko9JZyabH56y2fussEt1A5oDqsFXB3CkvAqraFryz", version: "1.0.0", license: "CC BY-NC 4.0", category: "LLM", royaltyPercent: 15, purchases: 311 },
  { id: 4, name: "AudioClip Transcriber", description: "Whisper-based transcription with speaker diarization. 98.1% accuracy on clean audio.", price: "0.06", priceWei: ethers.parseEther("0.06"), creator: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", ipfsHash: "QmfM2r8seH2GiRaC4esTjeraXEachRt8ZsSeGaWTPLyMoG", version: "3.0.1", license: "MIT", category: "Audio", royaltyPercent: 12, purchases: 204 },
  { id: 5, name: "TabularNet Regressor", description: "XGBoost-neural hybrid for tabular regression. 18% improvement on benchmarks.", price: "0.05", priceWei: ethers.parseEther("0.05"), creator: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B", ipfsHash: "QmNLei78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8z", version: "1.1.0", license: "MIT", category: "Tabular", royaltyPercent: 5, purchases: 57 },
  { id: 6, name: "DiffusionXL Fine-Tuner", description: "SDXL LoRA trained on 50k curated art images. Stunning photorealistic renders.", price: "0.35", priceWei: ethers.parseEther("0.35"), creator: "0x1db3439a222c519ab44bb1144fC28167b4Fa6EE6", ipfsHash: "QmYwAPJzv5CZsnAzt8auV39s1XRd9a6PqXqjS8Zs6jPBp4", version: "2.0.0", license: "CC BY 4.0", category: "Generative", royaltyPercent: 20, purchases: 478 },
];

function rowToModel(row: any): Model {
  return {
    id: row.id, name: row.name, description: row.description,
    price: String(row.price_eth), priceWei: ethers.parseEther(String(row.price_eth)),
    creator: row.creator_address, ipfsHash: row.ipfs_hash,
    version: row.version, license: row.license, category: row.category,
    royaltyPercent: row.royalty_percent, purchases: row.purchases ?? 0,
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export interface ModelListParams {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
  min_price?: number;
  max_price?: number;
  sort_by?: string;
  order?: "asc" | "desc";
  /** Filter to a specific creator wallet address — returns ALL their models (no pagination cap). */
  creator?: string;
}

export function useModels(params: ModelListParams = {}) {
  const { token } = useAuth();
  const { page = 0, limit = 20, category, search, min_price, max_price, creator } = params;

  return useQuery({
    queryKey: modelKeys.list(params),
    queryFn: async () => {
      // Try backend API first (has search + caching)
      try {
        const qs = new URLSearchParams({
          page: String(page), limit: String(creator ? 200 : limit),
          ...(category  && { category }),
          ...(search    && { search }),
          ...(creator   && { creator }),
          ...(min_price != null && { min_price: String(min_price) }),
          ...(max_price != null && { max_price: String(max_price) }),
        });
        const result = await api.get<{ data: any[]; total: number }>(`/api/models?${qs}`, token);
        console.log("API RESULT:", result);
        const rows = Array.isArray(result?.data) ? result.data : [];
        return { models: rows.map(rowToModel), total: result?.total ?? rows.length };
      } catch { /* backend unavailable */ }

      // Supabase fallback
      if (isSupabaseReady()) {
        const from = page * limit;
        let query = supabase.from("models").select("*", { count: "exact" })
          .order("created_at", { ascending: false });
        if (creator) {
          query = query.eq("creator_address", creator.toLowerCase());
        } else {
          query = query.range(from, from + limit - 1);
        }
        if (category) query = query.eq("category", category);
        if (search) query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
        const { data, count } = await query;
        return { models: (data ?? []).map(rowToModel), total: count ?? 0 };
      }

      // Demo data fallback
      let filtered = DEMO_MODELS;
      if (creator) filtered = filtered.filter(m => m.creator.toLowerCase() === creator.toLowerCase());
      if (category) filtered = filtered.filter(m => m.category === category);
      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(m => m.name.toLowerCase().includes(s) || m.description.toLowerCase().includes(s));
      }
      return { models: creator ? filtered : filtered.slice(page * limit, (page + 1) * limit), total: filtered.length };
    },
    placeholderData: (prev) => prev,
  });
}

export function useModel(id: number) {
  const { token } = useAuth();
  return useQuery({
    queryKey: modelKeys.detail(id),
    queryFn: async () => {
      try {
        return await api.get<any>(`/api/models/${id}`, token);
      } catch { /* fallback */ }

      if (isSupabaseReady()) {
        const { data } = await supabase.from("models").select("*").eq("id", id).single();
        return data ? rowToModel(data) : null;
      }
      return DEMO_MODELS.find(m => m.id === id) ?? null;
    },
    enabled: id > 0,
  });
}

export function useModelReviews(modelId: number) {
  const { token } = useAuth();
  return useQuery({
    queryKey: modelKeys.reviews(modelId),
    queryFn: () => api.get<any[]>(`/api/models/${modelId}/reviews`, token).catch(() => []),
    enabled: modelId > 0,
  });
}

export function useSubmitReview(modelId: number) {
  const { token } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { rating: number; comment?: string }) =>
      api.post(`/api/models/${modelId}/reviews`, body, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: modelKeys.reviews(modelId) });
      qc.invalidateQueries({ queryKey: modelKeys.detail(modelId) });
      qc.invalidateQueries({ queryKey: modelKeys.all });
    },
  });
}
