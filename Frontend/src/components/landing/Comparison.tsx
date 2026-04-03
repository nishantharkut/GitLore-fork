const steps = ["Google the error", "Read Stack Overflow", "Copy code to ChatGPT", "Ask senior on Slack", "Wait for response"];

/** Static headline metric - never animate to 0 (that read as a bug). */
const TYPICAL_MINUTES = 30;

const Comparison = () => {
  return (
    <section className="border-y border-[var(--border)] bg-[var(--surface)] py-16 md:py-24">
      <div className="landing-container mx-auto max-w-[960px] px-0">
        <div className="grid gap-6 md:grid-cols-2 md:items-stretch md:gap-0">
          {/* Without */}
          <div className="comparison-card flex min-h-0 flex-col rounded-lg border border-[var(--border)] bg-[var(--elevated)] p-6 md:mr-3 md:rounded-r-none md:border-r-0 md:p-8">
            <p className="font-code text-[10px] font-medium uppercase tracking-[3px] text-[var(--text-ghost)]">Without GitLore</p>

            <div className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-heading text-[clamp(4rem,_12vw,_7rem)] font-bold leading-[0.9] tracking-tight text-[var(--error)] tabular-nums">
                {TYPICAL_MINUTES}
              </span>
              <span className="font-heading text-[1.25rem] font-semibold text-[var(--text-secondary)] md:text-[1.5rem]">min+</span>
            </div>
            <p className="mt-2 max-w-[280px] font-body text-[13px] leading-snug text-[var(--text-ghost)]">
              Typical time lost decoding a single vague review, without good context.
            </p>

            <div className="mt-8 flex flex-1 flex-col border-t border-[var(--border)] pt-6">
              <p className="mb-4 font-code text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">The usual path</p>
              <ol className="space-y-0">
                {steps.map((label, i) => (
                  <li key={label} className="flex gap-3">
                    <div className="flex w-5 shrink-0 flex-col items-center pt-0.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[rgba(248,113,113,0.25)] bg-[var(--error-dim)] font-code text-[10px] font-semibold text-[var(--error)]">
                        {i + 1}
                      </span>
                      {i < steps.length - 1 && <span className="my-1 block min-h-[12px] w-px flex-1 bg-[var(--border-strong)]" aria-hidden />}
                    </div>
                    <p className="pb-4 font-body text-[14px] leading-snug text-[var(--text-secondary)]">{label}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* With */}
          <div className="comparison-card flex min-h-0 flex-col rounded-lg border border-[var(--border-accent)] bg-[var(--surface)] p-6 md:ml-3 md:rounded-l-none md:p-8">
            <p className="font-code text-[10px] font-medium uppercase tracking-[3px] text-[var(--accent)]">With GitLore</p>

            <div className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-heading text-[clamp(4rem,_12vw,_7rem)] font-bold leading-[0.9] tracking-tight text-[var(--success)] tabular-nums">3</span>
              <span className="font-heading text-[1.25rem] font-semibold text-[var(--text-secondary)] md:text-[1.5rem]">sec</span>
            </div>
            <p className="mt-2 max-w-[280px] font-body text-[13px] leading-snug text-[var(--text-ghost)]">
              From comment click to full narrative, sources, and confidence.
            </p>

            <div className="mt-8 flex flex-1 flex-col border-t border-[var(--border)] pt-6">
              <p className="font-heading text-[17px] font-semibold leading-snug text-[var(--text)] md:text-[18px]">Click the comment - done.</p>
              <p className="mt-4 font-body text-[14px] leading-relaxed text-[var(--text-secondary)]">
                Context is assembled from GitHub automatically. No copy-paste, no tab pile-up, no guessing what the reviewer meant.
              </p>
              <div className="mt-auto flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--code-bg)] px-3 py-2.5 font-code text-[11px] text-[var(--text-code)] md:mt-8">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" aria-hidden />
                PR comments · issues · history - wired in one gesture
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Comparison;
