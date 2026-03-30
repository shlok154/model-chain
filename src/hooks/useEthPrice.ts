import { useQuery } from "@tanstack/react-query";

export function useEthPrice() {
  const { data: ethPrice, isLoading } = useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error("Price fetch failed");
      const data = await res.json();
      return data?.ethereum?.usd ?? null;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false,
  });

  const toUsd = (ethAmount: string | number): string => {
    if (!ethPrice) return "";
    const usd = parseFloat(String(ethAmount)) * ethPrice;
    if (isNaN(usd)) return "";
    return `≈ $${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  };

  return { ethPrice: ethPrice ?? null, isLoading, toUsd };
}
