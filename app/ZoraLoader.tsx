type ZoraLoaderProps = {
  compact?: boolean;
  message?: string;
};

export default function ZoraLoader({ compact = false, message = "Opening your adventures" }: ZoraLoaderProps) {
  return (
    <section className={`zora-loader ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <div className="zora-loader-brand" aria-label="Zora">
        {/* The supplied artwork is intentionally used directly so its revised, relaxed Z silhouette stays exact. */}
        <img className="zora-loader-mark" src="./zora-mark.png" alt="" aria-hidden="true" />
        <span>ora</span>
      </div>
      <p className="zora-loader-tagline">Your trip. All together.</p>
      <div className="zora-loading-progress" aria-hidden="true"><i /><i /><i /></div>
      <small>{message}<span className="visually-hidden">…</span></small>
      {!compact && (
        <svg className="zora-loader-landscape" viewBox="0 0 800 300" preserveAspectRatio="none" aria-hidden="true">
          <circle cx="660" cy="55" r="34" />
          <path className="ridge ridge-one" d="M0 132 100 92 218 140 328 126 455 180 620 112 800 160V300H0Z" />
          <path className="ridge ridge-two" d="M0 160 128 117 268 176 390 150 555 215 680 151 800 184V300H0Z" />
          <path className="ridge ridge-three" d="M0 206 126 160 258 213 398 198 520 244 666 186 800 224V300H0Z" />
          <path className="water" d="M0 237H800V300H0Z" />
        </svg>
      )}
    </section>
  );
}
