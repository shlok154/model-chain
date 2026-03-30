import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useModels, type ModelListParams } from "../hooks/useModels";
import { useOwnership } from "../hooks/useOwnership";
import NeuralChip from "../components/NeuralChip";
import { useQueryClient } from "@tanstack/react-query";
import { modelKeys } from "../hooks/useModels";
import { api } from "../lib/api";

const CATEGORIES = ["All", "NLP", "Computer Vision", "LLM", "Audio", "Tabular", "Generative"];
const PAGE_SIZE = 12;

export default function MarketplacePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const prefetchModel = (id: number) => {
    queryClient.prefetchQuery({
      queryKey: modelKeys.detail(id),
      queryFn: () => api.get(`/api/models/${id}`),
      staleTime: 60_000,
    });
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const [search,   setSearch]   = useState(searchParams.get("q") || "");
  const [debouncedSearch, setDB] = useState(searchParams.get("q") || "");
  const [category, setCategory] = useState("All");
  const [page,     setPage]     = useState(0);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy,   setSortBy]   = useState<"created_at" | "price_eth" | "purchases">("created_at");
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "owned" | "unowned">("all");

  useEffect(() => {
    const t = setTimeout(() => setDB(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debouncedSearch) {
          next.set("q", debouncedSearch);
        } else {
          next.delete("q");
        }
        return next;
      },
      { replace: true }
    );
  }, [debouncedSearch, setSearchParams]);

  const params: ModelListParams = {
    page, limit: PAGE_SIZE,
    ...(category !== "All" && { category }),
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(minPrice  && { min_price: parseFloat(minPrice) }),
    ...(maxPrice  && { max_price: parseFloat(maxPrice) }),
    sort_by: sortBy,
    order: "desc",
  };

  const { data, isLoading, isError, isFetching } = useModels(params);
  const { owns } = useOwnership();

  let models = data?.models ?? [];
  const total = data?.total ?? 0;

  if (ownershipFilter !== "all") {
    models = models.filter((m) =>
      ownershipFilter === "owned" ? owns(m.id) : !owns(m.id)
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch   = (val: string) => { setSearch(val); setPage(0); };
  const handleCategory = (cat: string) => { setCategory(cat); setPage(0); };

  return (
    <div className="animate-page-in min-h-screen pt-16 pb-[144px]">
      <div className="flex flex-col lg:flex-row gap-0 items-start">

        {/* ── DESKTOP SIDEBAR ── */}
        <aside className="hidden lg:flex flex-col w-72 min-h-[calc(100vh-144px)] sticky top-16 bg-slate-950/40 backdrop-blur-md border-r border-white/5 p-6 space-y-8 overflow-y-auto custom-scrollbar">
          <h2 className="font-label text-xs text-on-surface-variant uppercase tracking-widest">FILTERS</h2>

          {/* Categories */}
          <div>
            <h3 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest mb-3">Categories</h3>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleCategory(cat)}
                  className={`font-label text-[10px] uppercase tracking-widest px-3 py-1 rounded-full border transition-all ${
                    category === cat
                      ? "bg-secondary-container text-on-secondary-container border-secondary-container"
                      : "bg-surface-container-highest text-secondary border-secondary/20 hover:border-secondary/50"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
                Price Range (ETH)
              </h3>
              <span className="font-label text-[10px] text-secondary">
                {minPrice || "0"} – {maxPrice || "∞"} ETH
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="font-label text-[9px] text-on-surface-variant/60 uppercase tracking-widest">Min</label>
                <input
                  className="w-full bg-surface-container-high rounded-lg px-3 py-2 text-xs font-label border border-outline-variant/20 outline-none focus:border-secondary-container/60 transition-colors"
                  placeholder="0.00"
                  type="number"
                  min="0"
                  step="0.01"
                  value={minPrice}
                  onChange={(e) => { setMinPrice(e.target.value); setPage(0); }}
                />
              </div>
              <div className="space-y-1">
                <label className="font-label text-[9px] text-on-surface-variant/60 uppercase tracking-widest">Max</label>
                <input
                  className="w-full bg-surface-container-high rounded-lg px-3 py-2 text-xs font-label border border-outline-variant/20 outline-none focus:border-secondary-container/60 transition-colors"
                  placeholder="∞"
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxPrice}
                  onChange={(e) => { setMaxPrice(e.target.value); setPage(0); }}
                />
              </div>
            </div>
            {(minPrice || maxPrice) && (
              <button
                className="font-label text-[9px] uppercase tracking-widest text-on-surface-variant/60 hover:text-secondary transition-colors"
                onClick={() => { setMinPrice(""); setMaxPrice(""); setPage(0); }}
              >
                ✕ Clear filter
              </button>
            )}
          </div>

          {/* Sort */}
          <div>
            <h3 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest mb-3">Sort By</h3>
            <select
              className="w-full bg-surface-container-high rounded-[10px] px-4 py-3 text-xs font-label border border-outline-variant/20 outline-none focus:border-secondary-container/60 transition-colors appearance-none"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="created_at">NEWEST LISTED</option>
              <option value="price_eth">PRICE: LOW TO HIGH</option>
              <option value="purchases">MOST POPULAR</option>
            </select>
          </div>

          {/* Ownership Filter */}
          <div>
            <h3 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest mb-3">Ownership</h3>
            <select
              className="w-full bg-surface-container-high rounded-[10px] px-4 py-3 text-xs font-label border border-outline-variant/20 outline-none appearance-none"
              value={ownershipFilter}
              onChange={(e) => setOwnershipFilter(e.target.value as any)}
            >
              <option value="all">ALL MODELS</option>
              <option value="owned">OWNED BY ME</option>
              <option value="unowned">NOT OWNED</option>
            </select>
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <div className="flex-1 space-y-8 px-6 lg:px-10 pt-8">

          {/* Mobile filter chips */}
          <div className="lg:hidden -mx-6 px-6 overflow-x-auto flex gap-2 pb-3" style={{ scrollSnapType: "x mandatory" }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategory(cat)}
                className={`flex-shrink-0 font-label text-[10px] uppercase tracking-widest px-4 py-2 rounded-full border transition-all ${
                  category === cat
                    ? "bg-secondary-container text-on-secondary-container border-secondary-container"
                    : "bg-surface-container text-on-surface-variant border-outline-variant/20"
                }`}
                style={{ scrollSnapAlign: "start" }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Page header + search */}
          <div className="space-y-4">
            <div>
              <h1 className="font-syne font-black text-3xl lg:text-5xl tracking-tighter uppercase leading-none">Marketplace</h1>
              <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest mt-2">
                {total} Models Verified On-Chain
              </p>
            </div>

            {/* Search bar */}
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl">search</span>
              <input
                className="w-full bg-surface-container-high rounded-[10px] pl-12 pr-6 py-3.5 text-sm font-label border border-outline-variant/10 outline-none focus:ring-2 focus:ring-secondary/20 transition-all"
                placeholder="Search AI models..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
          </div>

          {isError && (
            <div className="p-4 bg-error/10 border border-error/20 text-error rounded-xl font-label text-xs uppercase tracking-widest">
              Failed to sync with network. Showing cached results.
            </div>
          )}

          {/* Model grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="skeleton h-[360px] rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 animate-stagger">
              {models.length === 0 ? (
                <div className="col-span-full py-20 flex flex-col items-center justify-center text-center border border-dashed border-outline-variant/20 rounded-2xl">
                  {debouncedSearch ? (
                    <>
                      <span className="material-symbols-outlined text-4xl text-on-surface-variant/50 mb-4">search</span>
                      <h3 className="font-label text-sm uppercase tracking-widest text-on-surface-variant mb-2">
                        No results for "{debouncedSearch}"
                      </h3>
                      <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant/60 mb-6">
                        Try a broader term, or browse by category
                      </p>
                      <button
                        onClick={() => { setSearch(""); setDB(""); setPage(0); }}
                        className="font-label text-[10px] uppercase tracking-widest text-secondary border border-secondary/30 px-6 py-2 rounded-full hover:bg-secondary/10 transition-colors"
                      >
                        Clear search
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-4xl text-on-surface-variant/50 mb-4">◎</span>
                      <h3 className="font-label text-sm uppercase tracking-widest text-on-surface-variant mb-2">
                        No models match these filters
                      </h3>
                      <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant/60">
                        Try adjusting the category or price range
                      </p>
                    </>
                  )}
                </div>
              ) : models.map((model) => (
                <div
                  key={model.id}
                  className="group relative glass-card rounded-2xl p-6 flex flex-col h-full cursor-pointer transition-all duration-300 hover:-translate-y-[6px] hover:shadow-[0_20px_40px_rgba(189,157,255,0.12)] overflow-hidden"
                  onClick={() => navigate(`/model/${model.id}`)}
                  onMouseEnter={() => prefetchModel(model.id)}
                >
                  {/* Top row */}
                  <div className="flex justify-between items-start mb-6">
                    <NeuralChip label={model.category.toUpperCase()} />
                    <span className="font-label text-[10px] text-on-surface-variant">
                      {model.purchases} SALES
                    </span>
                    {owns(model.id) && (
                      <span className="font-label text-[10px] text-primary animate-pulse">OWNED</span>
                    )}
                  </div>

                  {/* Thumbnail */}
                  <div className="w-full h-40 rounded-xl overflow-hidden bg-surface-container-high mb-4 border border-outline-variant/10 group-hover:border-secondary/20 transition-colors">
                    <img
                      src={`https://api.dicebear.com/7.x/identicon/svg?seed=${model.name}&backgroundColor=0b0e17`}
                      alt={`${model.name} model thumbnail`}
                      loading="lazy"
                      className="w-full h-full object-cover p-2 group-hover:scale-105 transition-transform duration-700 opacity-80"
                    />
                  </div>

                  {/* Name + description */}
                  <h3 className="font-syne font-bold text-xl tracking-tight mb-2 text-on-surface group-hover:text-secondary transition-colors truncate">
                    {model.name}
                  </h3>
                  <p className="font-body text-sm text-on-surface-variant line-clamp-2 leading-relaxed flex-1 mb-6">
                    {model.description}
                  </p>

                  {/* Footer */}
                  <div className="mt-auto flex justify-between items-center pt-4 border-t border-outline-variant/10">
                    <span className="font-label text-secondary font-bold">
                      {model.price} <span className="text-on-surface-variant">ETH</span>
                    </span>
                    <button
                      className="font-label text-[10px] uppercase tracking-widest px-4 py-2 rounded-lg border border-outline-variant/30 hover:border-secondary/40 hover:text-secondary transition-colors"
                      onClick={(e) => { e.stopPropagation(); navigate(`/model/${model.id}`); }}
                    >
                      View Details
                    </button>
                  </div>

                  {/* Mobile tap feedback */}
                  <div className="md:hidden absolute inset-0 bg-white/5 opacity-0 group-active:opacity-100 transition-opacity pointer-events-none" />
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pt-10 flex items-center justify-center gap-4">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || isFetching}
                className="glass-card px-6 py-2 rounded-lg font-label text-xs uppercase tracking-widest disabled:opacity-30 transition-all hover:border-secondary/30"
              >
                PREVIOUS
              </button>
              <div className="font-label text-xs text-on-surface-variant px-4">
                PAGE <span className="text-on-surface">{page + 1}</span> / {totalPages}
              </div>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1 || isFetching}
                className="glass-card px-6 py-2 rounded-lg font-label text-xs uppercase tracking-widest disabled:opacity-30 transition-all hover:border-secondary/30"
              >
                NEXT
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
