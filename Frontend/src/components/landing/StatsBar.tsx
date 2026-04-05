import { FadeIn } from "../effects/FadeIn";

const stats = [
  { value: "30+", label: "API endpoints" },
  { value: "768-dim", label: "vector embeddings" },
  { value: "3-tier", label: "search pipeline" },
  { value: "6", label: "Gemini prompts" },
  { value: "8", label: "Gemini integrations across the platform" },
];

const StatsBar = () => {
  return (
    <section id="platform-stats" className="relative overflow-hidden border-y border-[var(--border)] bg-[var(--bg)] py-16 md:py-20">
      <div className="landing-container relative">
        <FadeIn direction="up">
          <div className="section-label">
            <p>By the numbers</p>
          </div>
          <h2 className="font-heading text-[clamp(1.5rem,3.2vw,2.35rem)] font-bold tracking-[-0.04em] text-[var(--text)]">
            What runs GitLore
          </h2>
          <p className="mt-2 max-w-[640px] font-body text-[15px] leading-relaxed text-[var(--text-secondary)] md:text-[16px]">
            Backend surface area, retrieval stack, and Gemini usage at a glance.
          </p>

          <div className="landing-glass-panel mt-8 px-4 py-10 md:mt-10 md:px-10 md:py-12">
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-2 md:grid-cols-3 lg:flex lg:flex-nowrap lg:justify-between lg:gap-0">
              {stats.map((s, i) => (
                <div
                  key={s.label}
                  className={`flex flex-col items-center text-center lg:min-w-0 lg:flex-1 ${i > 0 ? "lg:border-l lg:border-[var(--border)]/50 lg:pl-6" : ""}`}
                >
                  <span className="font-heading text-[clamp(1.85rem,4.2vw,2.65rem)] font-bold leading-none tracking-[-0.04em] text-[var(--accent)]">
                    {s.value}
                  </span>
                  <span className="mt-3 max-w-[12rem] font-body text-[12px] font-normal leading-snug text-[var(--text-secondary)] md:text-[13px]">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

export default StatsBar;
