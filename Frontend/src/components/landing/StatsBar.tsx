const stats = [
  { value: "30+", label: "API endpoints" },
  { value: "768-dim", label: "vector embeddings" },
  { value: "3-tier", label: "search pipeline" },
  { value: "6", label: "Gemini prompts" },
  { value: "8", label: "Gemini integrations across the platform" },
];

const StatsBar = () => {
  return (
    <section className="relative overflow-hidden border-y border-[var(--border)] bg-[var(--bg)] py-16 md:py-20">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-[var(--accent-dim)]/50 to-transparent opacity-60"
        aria-hidden
      />
      <div className="landing-container relative">
        <div className="landing-glass-panel px-4 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-2 md:grid-cols-3 lg:flex lg:flex-nowrap lg:justify-between lg:gap-0">
            {stats.map((s, i) => (
              <div
                key={s.label}
                className={`flex flex-col items-center text-center lg:min-w-0 lg:flex-1 ${i > 0 ? "lg:border-l lg:border-[var(--border)]/50 lg:pl-6" : ""}`}
              >
                <span className="font-heading text-[clamp(1.85rem,4.2vw,2.65rem)] font-bold leading-none tracking-[-0.04em] text-[var(--accent)] drop-shadow-[0_0_28px_var(--accent-glow)]">
                  {s.value}
                </span>
                <span className="mt-3 max-w-[12rem] font-body text-[12px] font-normal leading-snug text-[var(--text-secondary)] md:text-[13px]">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default StatsBar;
