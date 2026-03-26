export default function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-inner">
        <span className="footer-brand">⬡ ModelChain</span>
        <span className="footer-divider">·</span>
        <span className="footer-disclaimer">
          Use at your own risk. Not financial advice. Smart contract interactions are irreversible.
        </span>
        <span className="footer-divider">·</span>
        <a
          href="https://sepolia.etherscan.io"
          target="_blank"
          rel="noreferrer"
          className="footer-link"
        >
          Sepolia Explorer ↗
        </a>
      </div>
    </footer>
  );
}
