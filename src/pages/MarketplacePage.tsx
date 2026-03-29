import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useModels, type ModelListParams } from "../hooks/useModels";
import { useOwnership } from "../hooks/useOwnership";

const CATEGORIES = ["All", "NLP", "Computer Vision", "LLM", "Audio", "Tabular", "Generative"];
const PAGE_SIZE = 20;

export default function MarketplacePage() {
  const navigate = useNavigate();
  const [search,   setSearch]   = useState("");
  const [category, setCategory] = useState("All");
  const [page,     setPage]     = useState(0);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy,   setSortBy]   = useState<"created_at" | "price_eth" | "purchases">("created_at");
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "owned" | "unowned">("all");

  const params: ModelListParams = {
    page, limit: PAGE_SIZE,
    ...(category !== "All" && { category }),
    ...(search    && { search }),
    ...(minPrice  && { min_price: parseFloat(minPrice) }),
    ...(maxPrice  && { max_price: parseFloat(maxPrice) }),
    sort_by: sortBy,
    order: "desc",
  };

  const { data, isLoading, isError, isFetching } = useModels(params);
  const { owns }     = useOwnership();
  
  let models = data?.models ?? [];
  const total = data?.total ?? 0;
  
  // Client-side ownership filtering
  if (ownershipFilter !== "all") {
    models = models.filter((m) =>
      ownershipFilter === "owned" ? owns(m.id) : !owns(m.id)
    );
  }
  
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = (val: string) => { setSearch(val); setPage(0); };
  const handleCategory = (cat: string) => { setCategory(cat); setPage(0); };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Marketplace</h1>
          <p className="page-subtitle">
            Discover and license on-chain AI models
            {!import.meta.env.VITE_SUPABASE_URL && <span className="demo-badge">Demo Mode</span>}
          </p>
        </div>
        <div className="search-bar">
          <input
            className="search-input"
            placeholder="Search models…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="filter-row">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`filter-chip ${category === cat ? "filter-chip--active" : ""}`}
            onClick={() => handleCategory(cat)}
          >{cat}</button>
        ))}
      </div>

      {/* Phase 4: Price + Sort controls */}
      <div className="filter-row" style={{ gap: 10, marginBottom: 20 }}>
        <input
          className="field-input"
          style={{ width: 110, padding: "6px 10px", fontSize: 13 }}
          placeholder="Min ETH"
          type="number" min="0" step="0.01"
          value={minPrice}
          onChange={(e) => { setMinPrice(e.target.value); setPage(0); }}
        />
        <input
          className="field-input"
          style={{ width: 110, padding: "6px 10px", fontSize: 13 }}
          placeholder="Max ETH"
          type="number" min="0" step="0.01"
          value={maxPrice}
          onChange={(e) => { setMaxPrice(e.target.value); setPage(0); }}
        />
        <select
          className="field-input field-select"
          style={{ width: 160, padding: "6px 10px", fontSize: 13 }}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
        >
          <option value="created_at">Newest First</option>
          <option value="price_eth">Price</option>
          <option value="purchases">Most Popular</option>
        </select>
        <select
          className="field-input field-select"
          style={{ width: 160, padding: "6px 10px", fontSize: 13 }}
          value={ownershipFilter}
          onChange={(e) => setOwnershipFilter(e.target.value as any)}
        >
          <option value="all">All Models</option>
          <option value="owned">Owned</option>
          <option value="unowned">Not Owned</option>
        </select>
        {isFetching && !isLoading && (
          <span style={{ fontSize: 12, color: "var(--text-3)", alignSelf: "center" }}>Updating…</span>
        )}
      </div>

      {isError && <div className="error-banner">⚠ Failed to load models. Showing cached data.</div>}

      {isLoading ? (
        <div className="loading-grid">
          {[...Array(6)].map((_, i) => <div key={i} className="model-card model-card--skeleton" />)}
        </div>
      ) : (
        <div className="model-grid">
          {models.length === 0 ? (
            <div className="empty-state">No models found matching your filters.</div>
          ) : models.map((model) => (
            <div key={model.id} className={`model-card ${owns(model.id) ? "model-card--owned" : ""}`} onClick={() => navigate(`/model/${model.id}`)}>
              <div className="model-card-top">
                <span className="model-category">{model.category}</span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {owns(model.id) ? (
                    <span className="escrow-badge escrow-badge--released" style={{ fontSize: 10, padding: "2px 8px" }} title="You already own this model">Owned ✅</span>
                  ) : (
                    <span className="chain-badge" style={{ fontSize: 10, padding: "2px 8px" }}>🔒 Locked</span>
                  )}
                  <span className="model-purchases">{model.purchases} buyers</span>
                </div>
              </div>
              <h3 className="model-name">{model.name}</h3>
              <p className="model-desc">{model.description}</p>
              <div className="model-card-footer">
                <span className="model-price">{model.price} ETH</span>
                <span className="model-license">{model.license}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn--secondary" onClick={() => setPage(p => p - 1)} disabled={page === 0 || isFetching}>
            ← Previous
          </button>
          <span className="pagination-info">
            Page {page + 1} of {totalPages}
            <span className="pagination-count"> ({total} models)</span>
          </span>
          <button className="btn btn--secondary" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1 || isFetching}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
