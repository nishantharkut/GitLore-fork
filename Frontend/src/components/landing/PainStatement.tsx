import { FadeIn } from "../effects/FadeIn";

const columns = [
  {
    title: "Senior leaves, knowledge leaves too.",
    body: "3 years of decisions about why the auth system works the way it does — gone when someone moves on.",
  },
  {
    title: "New developer, zero context.",
    body: "They touch the caching layer without knowing the team debated Redis vs Memcached for two weeks in PR #47.",
  },
  {
    title: "Buried in 500 PRs.",
    body: "The answer exists in a PR comment from 18 months ago. Good luck finding it.",
  },
];

const PainStatement = () => {
  return (
    <section id="problem" className="relative overflow-hidden border-y border-[var(--border)] bg-[var(--surface)]/80 py-20 backdrop-blur-[2px] md:py-28 lg:py-32">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          background: "radial-gradient(ellipse 55% 40% at 30% 0%, var(--accent-dim), transparent 50%)",
        }}
        aria-hidden
      />
      <FadeIn direction="up">
        <div className="landing-container relative">
          <div className="section-label">
            <p>The problem</p>
          </div>
          <h2 className="max-w-[720px] font-heading text-[clamp(1.75rem,4vw,2.85rem)] font-bold leading-[1.08] tracking-[-0.04em] text-[var(--text)]">
            The Decision Shadow
          </h2>

          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-5 lg:gap-6">
            {columns.map((col, i) => (
              <div
                key={col.title}
                className="group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--elevated)]/90 p-6 shadow-[0_16px_48px_-20px_rgba(0,0,0,0.35)] transition-all duration-300 hover:border-[var(--border-accent)] hover:shadow-[0_24px_56px_-16px_rgba(0,0,0,0.4)] md:px-7 md:py-7"
              >
                <span
                  className="pointer-events-none absolute right-3 top-3 select-none font-heading text-[2.25rem] font-bold leading-none text-[var(--text-ghost)]/25 transition-colors duration-300 group-hover:text-[var(--accent)]/30 md:right-4 md:top-4 md:text-[3rem]"
                  aria-hidden
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
                <h3 className="relative pe-[3.25rem] font-heading text-[17px] font-semibold leading-snug tracking-[-0.02em] text-[var(--text)] md:pe-[3.5rem] md:text-[18px]">
                  {col.title}
                </h3>
                <p className="relative mt-3 font-body text-[14px] font-normal leading-[1.75] text-[var(--text-secondary)]">{col.body}</p>
              </div>
            ))}
          </div>

          <div className="mx-auto mt-16 max-w-[840px] rounded-2xl border border-[var(--border-accent)]/35 bg-[color-mix(in_srgb,var(--surface)_65%,var(--elevated))] px-5 py-8 text-left shadow-[0_0_48px_-20px_var(--accent-glow)] backdrop-blur-md sm:px-8 sm:text-center md:mt-20 md:px-10 md:py-10">
            <p className="font-body text-[15px] leading-[1.85] text-[color-mix(in_srgb,var(--text)_88%,var(--text-secondary))] md:text-[16px] md:leading-[1.9]">
              git blame tells you <span className="font-semibold text-[var(--text)]">WHO</span>. Copilot tells you <span className="font-semibold text-[var(--text)]">WHAT</span>. GitLens shows you{" "}
              <span className="font-semibold text-[var(--text)]">WHEN</span>. <span className="font-semibold text-[var(--text)]">Nobody tells you WHY.</span>{" "}
              <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] bg-clip-text font-semibold text-transparent">GitLore does.</span>
            </p>
          </div>
        </div>
      </FadeIn>
    </section>
  );
};

export default PainStatement;
