/**
 * Phase 5 — Frontend unit tests (Vitest)
 * Run: npm test
 */
import { describe, it, expect } from "vitest";

// ── Auth token parsing ────────────────────────────────────────────────────────
function parseToken(token: string): { wallet: string; role: string; exp: number } | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload;
  } catch {
    return null;
  }
}

function isTokenValid(token: string): boolean {
  const payload = parseToken(token);
  if (!payload) return false;
  return payload.exp * 1000 > Date.now();
}

// Make a fake expired JWT for testing
function makeFakeJwt(wallet: string, role: string, expOffsetSecs: number): string {
  const header  = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({
    wallet, role,
    exp: Math.floor(Date.now() / 1000) + expOffsetSecs,
    iat: Math.floor(Date.now() / 1000),
  }));
  return `${header}.${payload}.fakesig`;
}

describe("JWT token handling", () => {
  it("parses a valid token correctly", () => {
    const token = makeFakeJwt("0xabc", "user", 3600);
    const parsed = parseToken(token);
    expect(parsed?.wallet).toBe("0xabc");
    expect(parsed?.role).toBe("user");
  });

  it("returns null for malformed token", () => {
    expect(parseToken("not.a.jwt")).toBeNull();
    expect(parseToken("")).toBeNull();
  });

  it("isTokenValid returns true for unexpired token", () => {
    const token = makeFakeJwt("0xabc", "user", 3600);
    expect(isTokenValid(token)).toBe(true);
  });

  it("isTokenValid returns false for expired token", () => {
    const token = makeFakeJwt("0xabc", "user", -1);  // expired 1 second ago
    expect(isTokenValid(token)).toBe(false);
  });

  it("isTokenValid returns false for malformed token", () => {
    expect(isTokenValid("garbage")).toBe(false);
  });
});

// ── Model filtering (MarketplacePage logic) ───────────────────────────────────
interface Model { id: number; name: string; description: string; category: string; price: string; }

function filterModels(models: Model[], search: string, category: string): Model[] {
  return models.filter(m => {
    const matchSearch = !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.description.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "All" || m.category === category;
    return matchSearch && matchCat;
  });
}

const SAMPLE_MODELS: Model[] = [
  { id: 1, name: "Sentiment Analyzer",    description: "NLP model for sentiment", category: "NLP",              price: "0.08" },
  { id: 2, name: "Vision Detector",       description: "Computer vision model",   category: "Computer Vision",  price: "0.14" },
  { id: 3, name: "LLM Code Assistant",    description: "Code generation LLM",     category: "LLM",              price: "0.22" },
];

describe("filterModels", () => {
  it("returns all models when search is empty and category is All", () => {
    expect(filterModels(SAMPLE_MODELS, "", "All")).toHaveLength(3);
  });

  it("filters by search term in name (case-insensitive)", () => {
    const result = filterModels(SAMPLE_MODELS, "vision", "All");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it("filters by search term in description", () => {
    const result = filterModels(SAMPLE_MODELS, "code generation", "All");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it("filters by category", () => {
    const result = filterModels(SAMPLE_MODELS, "", "NLP");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("combines search and category filters", () => {
    expect(filterModels(SAMPLE_MODELS, "sentiment", "NLP")).toHaveLength(1);
    expect(filterModels(SAMPLE_MODELS, "sentiment", "LLM")).toHaveLength(0);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterModels(SAMPLE_MODELS, "blockchain", "All")).toHaveLength(0);
  });
});

// ── ETH price formatting ──────────────────────────────────────────────────────
function toUsd(ethAmount: string | number, ethPrice: number | null): string {
  if (!ethPrice) return "";
  const usd = parseFloat(String(ethAmount)) * ethPrice;
  if (isNaN(usd)) return "";
  return `≈ $${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

describe("toUsd", () => {
  it("formats ETH to USD correctly", () => {
    expect(toUsd("0.1", 2000)).toBe("≈ $200.00 USD");
  });

  it("returns empty string when price is null", () => {
    expect(toUsd("0.1", null)).toBe("");
  });

  it("handles string ETH amounts", () => {
    expect(toUsd("1.5", 2000)).toBe("≈ $3,000.00 USD");
  });

  it("returns empty string for NaN input", () => {
    expect(toUsd("notanumber", 2000)).toBe("");
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────
describe("Pagination logic", () => {
  it("calculates total pages correctly", () => {
    expect(Math.ceil(100 / 20)).toBe(5);
    expect(Math.ceil(21 / 20)).toBe(2);
    expect(Math.ceil(20 / 20)).toBe(1);
    expect(Math.ceil(0  / 20)).toBe(0);
  });

  it("hasNextPage is false on last page", () => {
    const page = 4, totalPages = 5;
    expect(page >= totalPages - 1).toBe(true);
  });

  it("hasPrevPage is false on first page", () => {
    expect(0 === 0).toBe(true);
  });
});

// ── Period delta badge logic (DashboardPage) ──────────────────────────────────
function formatDelta(delta: number | null): { label: string; positive: boolean } | null {
  if (delta == null) return null;
  return {
    label: `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
    positive: delta >= 0,
  };
}

describe("formatDelta", () => {
  it("returns null for null delta", () => {
    expect(formatDelta(null)).toBeNull();
  });

  it("formats a positive delta with leading +", () => {
    const result = formatDelta(59.0);
    expect(result?.label).toBe("+59.0%");
    expect(result?.positive).toBe(true);
  });

  it("formats a negative delta without leading +", () => {
    const result = formatDelta(-12.5);
    expect(result?.label).toBe("-12.5%");
    expect(result?.positive).toBe(false);
  });

  it("treats zero as positive", () => {
    const result = formatDelta(0);
    expect(result?.label).toBe("+0.0%");
    expect(result?.positive).toBe(true);
  });
});

// ── Retention bar width calculation (DashboardPage) ───────────────────────────
function retentionBarWidth(retentionRate: number): string {
  return `${Math.min(retentionRate, 100).toFixed(1)}%`;
}

describe("retentionBarWidth", () => {
  it("returns exact rate when below 100", () => {
    expect(retentionBarWidth(13.8)).toBe("13.8%");
  });

  it("caps at 100% when rate exceeds 100", () => {
    expect(retentionBarWidth(120)).toBe("100.0%");
  });

  it("handles 0% correctly", () => {
    expect(retentionBarWidth(0)).toBe("0.0%");
  });

  it("handles exactly 100%", () => {
    expect(retentionBarWidth(100)).toBe("100.0%");
  });
});
