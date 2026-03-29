/**
 * Phase 5 — React Query client configuration
 * Centralises retry logic, stale times, and error handling.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Phase 3: retry with exponential backoff (max 3 attempts)
      retry: (failureCount, error: any) => {
        // Don't retry 4xx client errors
        if (error?.status >= 400 && error?.status < 500) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      staleTime: 30_000,     // 30s — matches backend Redis TTL
      gcTime:    5 * 60_000, // 5 min garbage collect
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0, // Never auto-retry mutations (they may have side effects)
    },
  },
});
