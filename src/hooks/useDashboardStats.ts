import { useState, useCallback } from "react";
import { supabase, isSupabaseReady } from "../lib/supabase";

export interface DashboardStats {
  totalEarned: string;
  modelsListed: number;
  totalSales: number;
  avgRoyalty: string;
  monthlyRevenue: { month: string; eth: number }[];
}

const DEMO_STATS: DashboardStats = {
  totalEarned: "3.47",
  modelsListed: 4,
  totalSales: 892,
  avgRoyalty: "11.25",
  monthlyRevenue: [
    { month: "Oct", eth: 0.18 },
    { month: "Nov", eth: 0.31 },
    { month: "Dec", eth: 0.52 },
    { month: "Jan", eth: 0.44 },
    { month: "Feb", eth: 0.78 },
    { month: "Mar", eth: 1.24 },
  ],
};

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchStats = useCallback(async (address: string) => {
    setIsLoading(true);
    try {
      if (!isSupabaseReady()) {
        await new Promise((r) => setTimeout(r, 400));
        setStats(DEMO_STATS);
        return;
      }

      // Fetch all models by this creator
      const { data: models, error } = await supabase
        .from("models")
        .select("price_eth, royalty_percent, purchases, created_at")
        .eq("creator_address", address.toLowerCase());

      if (error) throw error;

      if (!models || models.length === 0) {
        setStats({ totalEarned: "0", modelsListed: 0, totalSales: 0, avgRoyalty: "0", monthlyRevenue: [] });
        return;
      }

      const modelsListed = models.length;
      const totalSales = models.reduce((sum, m) => sum + (m.purchases ?? 0), 0);
      const avgRoyalty = (models.reduce((sum, m) => sum + m.royalty_percent, 0) / modelsListed).toFixed(2);

      // Estimate total earned: sum of (price * purchases) for each model
      const totalEarned = models
        .reduce((sum, m) => sum + parseFloat(m.price_eth) * (m.purchases ?? 0), 0)
        .toFixed(4);

      // Build monthly revenue: group models by month of creation (approximation)
      const monthMap: Record<string, number> = {};
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toLocaleDateString("en-US", { month: "short" });
        monthMap[key] = 0;
      }
      models.forEach((m) => {
        const month = new Date(m.created_at).toLocaleDateString("en-US", { month: "short" });
        if (month in monthMap) {
          monthMap[month] += parseFloat(m.price_eth) * (m.purchases ?? 0);
        }
      });
      const monthlyRevenue = Object.entries(monthMap).map(([month, eth]) => ({
        month,
        eth: parseFloat(eth.toFixed(4)),
      }));

      setStats({ totalEarned, modelsListed, totalSales, avgRoyalty, monthlyRevenue });
    } catch {
      setStats(DEMO_STATS);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { stats, isLoading, fetchStats };
}
