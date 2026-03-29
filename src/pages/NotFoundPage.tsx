import { useNavigate } from "react-router-dom";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="page notfound-page">
      <div className="notfound-content">
        <span className="notfound-glyph">⬡</span>
        <h1 className="notfound-code">404</h1>
        <p className="notfound-title">Page not found</p>
        <p className="notfound-desc">
          This route doesn't exist on ModelChain.
        </p>
        <button className="btn btn--primary" onClick={() => navigate("/")}>
          Back to Marketplace
        </button>
      </div>
    </div>
  );
}
