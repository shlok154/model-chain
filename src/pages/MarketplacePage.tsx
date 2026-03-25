import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMarketplace } from "../hooks/useMarketplace";

const CATEGORIES = ["All", "NLP", "Computer Vision", "LLM", "Audio", "Tabular", "Generative"];

export default function MarketplacePage() {
  const navigate = useNavigate();
  const { models, isLoading, error, fetchModels, isDemo } = useMarketplace();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const filtered = models.filter((m) => {
    const matchSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.description.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "All" || m.category === category;
    return matchSearch && matchCat;
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Marketplace</h1>
          <p className="page-subtitle">
            Discover and license on-chain AI models
            {isDemo && <span className="demo-badge">Demo Mode</span>}
          </p>
        </div>
        <div className="search-bar">
          <input
            className="search-input"
            placeholder="Search models…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="filter-row">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`filter-chip ${category === cat ? "filter-chip--active" : ""}`}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">⚠ {error}</div>}

      {isLoading ? (
        <div className="loading-grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="model-card model-card--skeleton" />
          ))}
        </div>
      ) : (
        <div className="model-grid">
          {filtered.length === 0 ? (
            <div className="empty-state">No models found.</div>
          ) : (
            filtered.map((model) => (
              <div
                key={model.id}
                className="model-card"
                onClick={() => navigate(`/model/${model.id}`)}
              >
                <div className="model-card-top">
                  <span className="model-category">{model.category}</span>
                  <span className="model-purchases">{model.purchases} buyers</span>
                </div>
                <h3 className="model-name">{model.name}</h3>
                <p className="model-desc">{model.description}</p>
                <div className="model-card-footer">
                  <span className="model-price">{model.price} ETH</span>
                  <span className="model-license">{model.license}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
