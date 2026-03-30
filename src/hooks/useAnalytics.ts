/**
 * Phase 4 — Creator analytics hook (React Query)
 * v5: extended with period_comparison, buyer_retention, weekly_revenue_mtd,
 *     consistency_warnings, and actual_purchases per model.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { supabase, isSupabaseReady } from "../lib/supabase";

export interface PeriodComparison {
  current_30d_revenue: number;
  prior_30d_revenue:   number;
  revenue_change_pct:  number | null;
  current_30d_sales:   number;
  prior_30d_sales:     number;
  sales_change_pct:    number | null;
}

export interface BuyerRetention {
  repeat_buyers:  number;
  retention_rate: number;
}

export interface DashboardStats {
  wallet?:            string;
  total_earned:       number;
  models_listed:      number;
  total_sales:        number;
  unique_buyers:      number;
  avg_royalty:        number;
  avg_rating:         number | null;
  total_reviews:      number;
  period_comparison?: PeriodComparison;
  buyer_retention?:   BuyerRetention;
  monthly_revenue:    { month: string; eth: number }[];
  weekly_revenue_mtd?: { week: string; eth: number }[];
  top_models:         {
    id: number; name: string; category?: string; price_eth?: number;
    revenue: number; revenue_share_pct?: number;
    purchases: number; actual_purchases?: number;
    avg_rating: number | null; review_count: number;
  }[];
  category_breakdown: Record<string, number>;
  consistency_warnings?: string[];
}

const DEMO_STATS: DashboardStats = {
  total_earned: 3.47, models_listed: 4, total_sales: 892, unique_buyers: 341,
  avg_royalty: 11.25, avg_rating: 4.3, total_reviews: 127,
  period_comparison: {
    current_30d_revenue: 1.24, prior_30d_revenue: 0.78,
    revenue_change_pct: 59.0,
    current_30d_sales: 210, prior_30d_sales: 182, sales_change_pct: 15.4,
  },
  buyer_retention: { repeat_buyers: 47, retention_rate: 13.8 },
  monthly_revenue: [
    { month: "Oct", eth: 0.18 }, { month: "Nov", eth: 0.31 },
    { month: "Dec", eth: 0.52 }, { month: "Jan", eth: 0.44 },
    { month: "Feb", eth: 0.78 }, { month: "Mar", eth: 1.24 },
  ],
  weekly_revenue_mtd: [
    { week: "W1", eth: 0.31 }, { week: "W2", eth: 0.44 },
    { week: "W3", eth: 0.28 }, { week: "W4", eth: 0.21 },
  ],
  top_models: [
    { id: 6, name: "DiffusionXL Fine-Tuner", category: "Generative", price_eth: 0.35,
      revenue: 1.67, revenue_share_pct: 48.1, purchases: 478, actual_purchases: 478,
      avg_rating: 4.6, review_count: 89 },
    { id: 3, name: "LLM Mini 7B", category: "LLM", price_eth: 0.22,
      revenue: 0.68, revenue_share_pct: 19.6, purchases: 311, actual_purchases: 311,
      avg_rating: 4.1, review_count: 38 },
  ],
  category_breakdown: { NLP: 1, LLM: 1, Audio: 1, Generative: 1 },
  consistency_warnings: [],
};

export function useDashboardStats(address: string | null) {
  const { token } = useAuth();

  return useQuery({
    queryKey: ["analytics", "dashboard", address],
    queryFn: async (): Promise<DashboardStats> => {
      if (!address) return DEMO_STATS;

      // Try backend analytics API first (full data)
      try {
        return await api.get<DashboardStats>("/api/analytics/dashboard", token);
      } catch { /* fallback */ }

      // Supabase direct fallback (reduced data — no period comparison or retention)
      if (isSupabaseReady()) {
        const { data: models } = await supabase
          .from("models")
          .select("id, name, price_eth, royalty_percent, purchases, created_at, category")
          .eq("creator_address", address.toLowerCase());

        if (!models?.length) {
          return {
            total_earned: 0, models_listed: 0, total_sales: 0, unique_buyers: 0,
            avg_royalty: 0, avg_rating: null, total_reviews: 0,
            monthly_revenue: [], top_models: [], category_breakdown: {},
          };
        }

        const totalSales  = models.reduce((s, m) => s + (m.purchases ?? 0), 0);
        const totalEarned = models.reduce((s, m) => s + parseFloat(m.price_eth) * (m.purchases ?? 0), 0);
        const avgRoyalty  = models.reduce((s, m) => s + m.royalty_percent, 0) / models.length;

        const now = new Date();
        const monthMap: Record<string, number> = {};
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthMap[d.toLocaleDateString("en-US", { month: "short" })] = 0;
        }
        models.forEach(m => {
          const key = new Date(m.created_at).toLocaleDateString("en-US", { month: "short" });
          if (key in monthMap) monthMap[key] += parseFloat(m.price_eth) * (m.purchases ?? 0);
        });

        const categories: Record<string, number> = {};
        models.forEach(m => { categories[m.category] = (categories[m.category] ?? 0) + 1; });

        return {
          total_earned:    parseFloat(totalEarned.toFixed(4)),
          models_listed:   models.length,
          total_sales:     totalSales,
          unique_buyers:   0,
          avg_royalty:     parseFloat(avgRoyalty.toFixed(2)),
          avg_rating:      null,
          total_reviews:   0,
          monthly_revenue: Object.entries(monthMap).map(([month, eth]) => ({ month, eth: parseFloat(eth.toFixed(4)) })),
          top_models:      (models ?? []).sort((a, b) => (b.purchases ?? 0) - (a.purchases ?? 0))
                             .slice(0, 5).map(m => ({
                               id: m.id, name: m.name, category: m.category,
                               price_eth: parseFloat(m.price_eth),
                               revenue: parseFloat((parseFloat(m.price_eth) * (m.purchases ?? 0)).toFixed(4)),
                               purchases: m.purchases ?? 0,
                               avg_rating: null, review_count: 0,
                             })),
          category_breakdown: categories,
        };
      }

      return DEMO_STATS;
    },
    enabled: !!address,
    staleTime: 60_000 * 5, // 5 mins
  });
}

// ── Telemetry Insights ───────────────────────────────────────────────────────

export interface TelemetryInsights {
  conversion_funnel: {
    viewed: number;
    clicked: number;
    purchased: number;
    downloaded: number;
  };
  failure_reasons: { reason: string; count: number }[];
  rpc_health: {
    total_calls: number;
    errors: number;
    success_rate: number;
    avg_latency_ms: number;
  };
  tx_success_rate: number;
  tx_failure_rate: number;
  tx_total: number;
}

const DEMO_INSIGHTS: TelemetryInsights = {
  conversion_funnel: { viewed: 1200, clicked: 400, purchased: 120, downloaded: 100 },
  failure_reasons: [
    { reason: "User rejected transaction", count: 45 },
    { reason: "Insufficient funds", count: 18 },
    { reason: "RPC timeout", count: 7 },
  ],
  rpc_health: { total_calls: 2400, errors: 42, success_rate: 98.2, avg_latency_ms: 320 },
  tx_success_rate: 82,
  tx_failure_rate: 18,
  tx_total: 138,
};

export function useTelemetryInsights() {
  const { token } = useAuth();

  return useQuery({
    queryKey: ["analytics", "telemetry-summary"],
    queryFn: async (): Promise<TelemetryInsights> => {
      try {
        return await api.get<TelemetryInsights>("/api/analytics/telemetry-summary", token);
      } catch {
        return DEMO_INSIGHTS;
      }
    },
    enabled: true,
    staleTime: 30_000,
  });
}
