type ZoraLoaderProps = {
  compact?: boolean;
  message?: string;
};

export default function ZoraLoader({ compact = false, message = "Opening your adventures" }: ZoraLoaderProps) {
  return (
    <section className={`zora-loader ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <div className="zora-loader-brand" aria-label="Zora">
        <svg className="zora-loader-mark" viewBox="0 0 190 155" aria-hidden="true">
          <circle cx="156" cy="21" r="13" />
          <path className="zora-mountain-back" d="M14 50C31 21 48 15 66 29 85 12 92 6 104 10c24 13 39 32 67 41-48-3-103-1-157-1Z" />
          <path className="zora-mountain-front" d="M14 50c20-29 37-30 57-16 18 12 34 16 63 18-43 0-80-1-120-2Z" />
          <path className="zora-river" d="M132 51c39-1 49 7 30 19-24 14-58 25-84 42-18 12-23 23-10 31 13 8 43 8 74 3-36 13-103 11-118-7-16-20 12-47 46-64 27-13 50-18 62-24Z" />
          <path className="zora-river-light" d="M92 122c-12 10-10 19 4 24 15 6 44 5 73-2-28 15-67 14-82 4-13-9-11-19 5-26Z" />
        </svg>
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
