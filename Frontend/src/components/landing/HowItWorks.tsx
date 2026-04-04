import { FadeIn } from "../effects/FadeIn";

const steps = [
  {
    title: "Connect",
    body: "OAuth with GitHub, pick a repo.",
  },
  {
    title: "Ingest",
    body: "Fetches merged PRs via GitHub GraphQL — titles, descriptions, reviews, linked issues, changed files.",
  },
  {
    title: "Extract",
    body: "Gemini extracts structured decisions from each PR: type, summary, problem, alternatives rejected, key quotes, topics, impact.",
  },
  {
    title: "Embed",
    body: "Each decision gets a 768-dimensional vector embedding, stored in MongoDB Atlas with vector search indexes.",
  },
  {
    title: "Search",
    body: "Three-tier retrieval: vector similarity → text index → regex fallback. Deduplication by PR. Context assembly for synthesis.",
  },
  {
    title: "Answer",
    body: "Gemini synthesizes a cited answer from matching decisions. Every claim linked to a PR number.",
  },
];

const HowItWorks = () => {
  return (
    <section id="how-it-works" className="relative overflow-hidden border-t border-[var(--border)] bg-[var(--surface)]/90 py-16 md:py-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-35"
        style={{
          background: "linear-gradient(180deg, transparent 0%, var(--accent-dim) 45%, transparent 100%)",
        }}
        aria-hidden
      />
      <div className="landing-container relative min-w-0">
        <FadeIn direction="up">
          <div className="section-label">
            <p>Pipeline</p>
          </div>
          <h2 className="font-heading text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.04em] text-[var(--text)]">How It Works</h2>

          <div className="landing-glass-panel mt-11 -mx-1 min-w-0 overflow-x-auto p-1 [-webkit-overflow-scrolling:touch] sm:mx-0">
            <div className="flex min-w-max divide-x divide-[var(--border)]/80 rounded-lg bg-[var(--elevated)]/50 lg:min-w-0 lg:w-full">
              {steps.map((step, i) => (
                <div
                  key={step.title}
                  className="group flex w-[min(88vw,240px)] shrink-0 flex-col px-4 py-6 sm:px-5 lg:w-0 lg:min-w-0 lg:flex-1 lg:py-7"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-[var(--border-accent)]/40 bg-[var(--accent-dim)] font-heading text-[14px] font-bold tabular-nums text-[var(--accent)] shadow-[0_0_20px_-6px_var(--accent-glow)] transition-transform duration-300 group-hover:scale-105">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-4 font-heading text-[15px] font-bold leading-tight tracking-[-0.02em] text-[var(--text)] md:text-[16px]">
                    {step.title}
                  </h3>
                  <p className="mt-2 font-body text-[12px] font-normal leading-[1.65] text-[var(--text-secondary)] md:text-[13px]">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

export default HowItWorks;
