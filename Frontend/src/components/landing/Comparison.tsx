import { Check, X } from "lucide-react";
import { FadeIn } from "../effects/FadeIn";

const rows: { capability: string; blame: boolean; gitlens: boolean; copilot: boolean; gitlore: boolean; emphasize?: boolean }[] = [
  { capability: "Who changed it?", blame: true, gitlens: true, copilot: true, gitlore: true },
  { capability: "When was it changed?", blame: true, gitlens: true, copilot: true, gitlore: true },
  { capability: "What does this code do?", blame: false, gitlens: false, copilot: true, gitlore: true },
  {
    capability: "Why was it written this way?",
    blame: false,
    gitlens: false,
    copilot: false,
    gitlore: true,
    emphasize: true,
  },
  {
    capability: "What alternatives were rejected?",
    blame: false,
    gitlens: false,
    copilot: false,
    gitlore: true,
    emphasize: true,
  },
  {
    capability: "What was debated in the PR?",
    blame: false,
    gitlens: false,
    copilot: false,
    gitlore: true,
    emphasize: true,
  },
  {
    capability: "Searchable decision history?",
    blame: false,
    gitlens: false,
    copilot: false,
    gitlore: true,
    emphasize: true,
  },
];

function MarkCell({
  supported,
  variant,
  emphasize,
}: {
  supported: boolean;
  variant: "default" | "gitlore";
  emphasize?: boolean;
}) {
  const isGitlore = variant === "gitlore";
  const baseWrap =
    "mx-auto flex h-9 w-9 items-center justify-center rounded-full border transition-colors md:h-10 md:w-10";
  const yesClasses = supported
    ? isGitlore
      ? `${baseWrap} border-[var(--accent)]/45 bg-[var(--accent)]/18 text-[var(--accent)]`
      : `${baseWrap} border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[var(--success-dim)] text-[var(--success)]`
    : `${baseWrap} border-[var(--border-strong)] bg-[var(--surface-hover)]/85 text-[var(--text-secondary)]`;

  const label = supported ? "Yes" : "No";

  const MarkIcon = supported ? Check : X;

  return (
    <td
      className={`comparison-cell border border-[var(--border)]/80 px-2 py-3 text-center align-middle md:px-3 md:py-3.5 ${
        isGitlore
          ? emphasize && supported
            ? "bg-[var(--accent)]/[0.07]"
            : "bg-[var(--accent)]/[0.035]"
          : emphasize && supported
            ? "bg-[var(--surface)]"
            : "bg-[var(--surface)]/40"
      }`}
    >
      <span className={`${yesClasses} inline-flex`} title={label} aria-label={label}>
        <MarkIcon className="h-4 w-4 stroke-[2.5] md:h-[18px] md:w-[18px]" aria-hidden strokeLinecap="round" strokeLinejoin="round" />
      </span>
    </td>
  );
}

const Comparison = () => {
  return (
    <section
      id="copilot-comparison"
      className="relative overflow-hidden border-y border-[var(--border)] bg-[var(--bg)] py-16 md:py-28"
    >
      <div className="landing-container relative z-[1] min-w-0">
        <FadeIn direction="up">
          <div className="section-label">
            <p>Differentiator</p>
          </div>
          <h2 className="font-heading text-[clamp(1.5rem,3.2vw,2.35rem)] font-bold tracking-[-0.04em] text-[var(--text)]">
            But can&apos;t Copilot do this?
          </h2>
          <p className="mt-2 font-body text-[15px] text-[var(--text-secondary)] md:text-[16px]">No. Here&apos;s the difference.</p>

          <div className="mt-10 -mx-1 min-w-0 overflow-x-auto px-1 pb-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:px-0">
            <div className="comparison-table-wrap rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1 md:p-1.5">
              <div className="min-w-0 overflow-hidden rounded-[6px] border border-[var(--border)]">
                <table className="w-full min-w-[560px] border-collapse text-[var(--text)] sm:min-w-[640px]">
                  <thead>
                    <tr className="bg-[var(--elevated)]/95 font-code text-[9px] uppercase tracking-[0.16em] sm:text-[10px] sm:tracking-[0.18em]">
                      <th className="comparison-head border-b border-[var(--border)] px-3 py-4 text-left md:px-5" scope="col">
                        <span className="sr-only">Capability</span>
                      </th>
                      <th
                        className="comparison-head border-b border-l border-[var(--border)] bg-[var(--surface)]/50 px-2 py-4 font-semibold text-[var(--text)] md:px-3 dark:bg-white/[0.04]"
                        scope="col"
                      >
                        git blame
                      </th>
                      <th
                        className="comparison-head border-b border-l border-[var(--border)] bg-[var(--surface)]/50 px-2 py-4 font-semibold text-[var(--text)] md:px-3 dark:bg-white/[0.04]"
                        scope="col"
                      >
                        GitLens
                      </th>
                      <th
                        className="comparison-head border-b border-l border-[var(--border)] bg-[var(--surface)]/50 px-2 py-4 font-semibold text-[var(--text)] md:px-3 dark:bg-white/[0.04]"
                        scope="col"
                      >
                        <span className="hidden sm:inline">Copilot / Claude Code</span>
                        <span className="sm:hidden">Copilot</span>
                      </th>
                      <th
                        className="comparison-head gitlore-col-head border-b border-l border-[var(--accent)]/35 bg-[var(--accent)]/12 px-2 py-4 font-bold text-[var(--accent)] md:px-4"
                        scope="col"
                      >
                        GitLore
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, rowIndex) => (
                      <tr
                        key={r.capability}
                        className={`transition-colors duration-200 hover:bg-[var(--surface-hover)]/40 ${
                          rowIndex % 2 === 1 ? "bg-[var(--elevated)]/25" : ""
                        }`}
                      >
                        <th
                          scope="row"
                          className={`comparison-row-label border-b border-[var(--border)]/80 px-3 py-3 text-left font-body text-[11px] font-medium leading-snug md:px-5 md:text-[13px] ${
                            r.emphasize ? "text-[var(--text)]" : "text-[var(--text-secondary)]"
                          }`}
                        >
                          {r.capability}
                        </th>
                        <MarkCell supported={r.blame} variant="default" emphasize={r.emphasize} />
                        <MarkCell supported={r.gitlens} variant="default" emphasize={r.emphasize} />
                        <MarkCell supported={r.copilot} variant="default" emphasize={r.emphasize} />
                        <MarkCell supported={r.gitlore} variant="gitlore" emphasize={r.emphasize} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p className="mx-auto mt-12 max-w-[640px] text-center font-heading text-[clamp(1.05rem,2vw,1.25rem)] font-semibold leading-snug tracking-[-0.02em] text-[var(--text-secondary)]">
            Copilot sees a <span className="text-[var(--text)]">snapshot</span>. GitLore sees a <span className="text-[var(--accent)]">timeline</span>.
          </p>
        </FadeIn>
      </div>
    </section>
  );
};

export default Comparison;
