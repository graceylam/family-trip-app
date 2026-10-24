type ZoraLoaderProps = {
  compact?: boolean;
  message?: string;
};

export default function ZoraLoader({ compact = false, message = "Opening your adventures" }: ZoraLoaderProps) {
  return (
    <section className={`zora-loader ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <div className="zora-loader-brand" aria-label="Zora">
        <svg className="zora-loader-mark" viewBox="0 0 160 82" aria-hidden="true">
          <circle cx="128" cy="18" r="9" />
          <path className="zora-mountain-back" d="M15 38 42 12 60 24 82 8 113 38Z" />
          <path className="zora-mountain-front" d="M15 38 42 20 61 31 82 15 113 38Z" />
          <path className="zora-river" d="M111 39c21 0 29 6 19 14-9 7-34 10-54 20-8 4-14 7-24 9h-39c21-13 54-23 76-30 13-4 16-8 2-13Z" />
        </svg>
        <span>Zora</span>
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
