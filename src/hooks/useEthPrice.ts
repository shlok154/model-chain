import { useState, useEffect, useCallback } from "react";

const CACHE_TTL = 60_000; // 1 minute
let cachedPrice: number | null = null;
let cacheTime = 0;

export function useEthPrice() {
  const [ethPrice, setEthPrice] = useState<number | null>(cachedPrice);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPrice = useCallback(async () => {
    // Return cache if fresh
    if (cachedPrice && Date.now() - cacheTime < CACHE_TTL) {
      setEthPrice(cachedPrice);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) throw new Error("Price fetch failed");
      const data = await res.json();
      const price = data?.ethereum?.usd ?? null;
      cachedPrice = price;
      cacheTime = Date.now();
      setEthPrice(price);
    } catch {
      // Silently fail — UI handles null gracefully
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrice();
    // Refresh every minute
    const interval = setInterval(fetchPrice, CACHE_TTL);
    return () => clearInterval(interval);
  }, [fetchPrice]);

  // Format ETH amount to USD string
  const toUsd = (ethAmount: string | number): string => {
    if (!ethPrice) return "";
    const usd = parseFloat(String(ethAmount)) * ethPrice;
    if (isNaN(usd)) return "";
    return `≈ $${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  };

  return { ethPrice, isLoading, toUsd };
}
