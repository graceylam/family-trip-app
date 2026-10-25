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
        <svg className="zora-loader-landscape" viewBox="0 0 800 360" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="zora-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#edf8fa" /><stop offset="1" stopColor="#cde8ef" /></linearGradient>
          </defs>
          <circle cx="657" cy="60" r="35" />
          <path className="ridge ridge-one" d="M0 174C42 158 73 140 116 147c44 7 71 42 119 45 45 3 76-25 120-15 49 11 78 53 128 55 55 2 82-55 140-61 65-7 105 52 177 59v130H0Z" />
          <path className="ridge ridge-two" d="M0 201c58-25 96-44 148-28 50 15 78 59 137 63 55 4 87-35 137-24 55 12 81 61 139 63 64 2 100-53 159-49 51 3 84 29 120 37v97H0Z" />
          <path className="ridge ridge-three" d="M0 246c51-27 91-39 139-21 42 16 72 50 126 55 50 5 90-19 137-7 45 11 78 48 128 51 66 4 105-49 167-45 43 3 71 22 103 35v46H0Z" />
          <path className="water" d="M0 286c109 1 167 15 245 13 85-2 135-18 222-15 91 3 143 20 223 16 45-2 78-9 110-12v72H0Z" />
          <g className="water-glints"><path d="M30 311c93-8 172-7 250 0" /><path d="M490 321c84-7 166-5 264 1" /><path d="M134 339c74-5 139-4 203 1" /></g>
        </svg>
      )}
    </section>
  );
}
