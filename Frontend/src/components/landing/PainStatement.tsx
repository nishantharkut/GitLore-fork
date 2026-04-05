import { FadeIn } from "../effects/FadeIn";

const painCards = [
  {
    title: "Senior leaves, knowledge leaves too.",
    body: "3 years of decisions about why the auth system works the way it does disappear when someone moves on.",
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
    <section
      id="problem"
      className="relative overflow-hidden border-y border-[var(--border)] bg-[var(--bg)] py-20 md:py-28 lg:py-32"
    >
      <FadeIn direction="up">
        <div className="landing-container relative">
          <header className="mx-auto max-w-[920px] text-center">
            <p className="mb-5 inline-flex items-center gap-2.5 font-code text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
              The problem
            </p>
            <h2 className="font-heading text-[clamp(2.15rem,6vw,3.85rem)] font-bold leading-[1.05] tracking-[-0.045em]">
              <span className="text-[var(--text)]">The Decision </span>
              <span className="text-[var(--accent)]">Shadow</span>
            </h2>
            <p className="mx-auto mt-6 max-w-[640px] font-body text-[15px] font-normal leading-[1.75] text-[var(--text-secondary)] md:text-[17px] md:leading-[1.8]">
              Pull requests are where your team actually decides: security bumps, dependency pins, rejected alternatives. None of that is
              searchable today, so every incident becomes a manual archaeology project.
            </p>
          </header>

          <div
            className="relative mx-auto mt-14 max-w-[960px] overflow-hidden rounded-[10px] border border-[color-mix(in_srgb,var(--warning)_35%,var(--border))] bg-[color-mix(in_srgb,var(--warning-dim)_22%,var(--elevated))] p-6 md:mt-16 md:p-8 lg:p-10"
            role="note"
            aria-label="Example: axios supply chain risk"
          >
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-2.5 py-1 font-code text-[10px] font-semibold uppercase tracking-wider text-[var(--warning)]">
                Real-world stress test
              </span>
              <span className="font-code text-[11px] text-[var(--text-ghost)]">axios · npm · early 2026</span>
            </div>
            <div className="grid gap-8 lg:grid-cols-[1fr_minmax(0,1.1fr)] lg:gap-12 lg:items-start">
              <div>
                <h3 className="font-heading text-[clamp(1.15rem,2.5vw,1.5rem)] font-semibold leading-snug tracking-[-0.02em] text-[var(--text)]">
                  When axios hit the news, spreadsheets were not enough.
                </h3>
                <p className="mt-3 font-body text-[14px] leading-[1.75] text-[var(--text-secondary)] md:text-[15px] md:leading-[1.8]">
                  Malicious axios publishes briefly appeared on npm and were pulled within hours. Teams still had to answer: which lockfile
                  rows are affected, who bumped axios last, and whether we already documented a pin or a CVE exception in review.
                </p>
              </div>
              <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                <p className="font-code text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">How GitLore responds</p>
                <ul className="mt-4 space-y-3 font-body text-[14px] leading-[1.7] text-[var(--text-secondary)]">
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                    <span>
                      <span className="font-medium text-[var(--text)]">Search the graph</span> for merged PRs and comments that mention
                      axios, version bumps, CVEs, or pins, across the whole repo history.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                    <span>
                      <span className="font-medium text-[var(--text)]">Ask in plain language</span> (for example why a dependency is frozen)
                      and get answers with citations back to the original review threads.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                    <span>
                      <span className="font-medium text-[var(--text)]">See who decided what</span> so incident response is not blocked on the
                      one engineer who remembers PR #412.
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3 lg:gap-5">
            {painCards.map((col, i) => (
              <div
                key={col.title}
                className="bento-card group relative flex flex-col overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6 md:px-7 md:py-7"
              >
                <span
                  className="pointer-events-none absolute right-4 top-4 select-none font-heading text-[2.5rem] font-bold leading-none text-[var(--text-ghost)]/20 transition-colors duration-300 group-hover:text-[var(--accent)]/35 md:text-[3.25rem]"
                  aria-hidden
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="absolute inset-x-0 top-0 h-[3px] scale-x-0 bg-[var(--accent)]/70 opacity-0 transition-transform duration-300 group-hover:scale-x-100 group-hover:opacity-100" aria-hidden />
                <h3 className="relative pe-14 font-heading text-[17px] font-semibold leading-snug tracking-[-0.02em] text-[var(--text)] md:pe-16 md:text-[18px]">
                  {col.title}
                </h3>
                <p className="relative mt-3 flex-1 font-body text-[14px] font-normal leading-[1.75] text-[var(--text-secondary)]">{col.body}</p>
              </div>
            ))}
          </div>
        </div>
      </FadeIn>
    </section>
  );
};

export default PainStatement;
