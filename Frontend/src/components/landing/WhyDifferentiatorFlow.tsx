import { Fragment } from "react";
import { useTheme } from "@/context/ThemeContext";

const LOGO_BASE = `${import.meta.env.BASE_URL}landing-logos`;

type ToolStep = {
  kind: "tool";
  logoSrc: string;
  logoAlt: string;
  product: string;
  dimension: string;
};

type GapStep = {
  kind: "gap";
  title: string;
  subtitle: string;
};

type GitLoreStep = {
  kind: "gitlore";
  product: string;
  dimension: string;
  tagline: string;
};

const STEPS: (ToolStep | GapStep | GitLoreStep)[] = [
  {
    kind: "tool",
    logoSrc: `${LOGO_BASE}/git.svg`,
    logoAlt: "Git",
    product: "git blame",
    dimension: "Who",
  },
  {
    kind: "tool",
    logoSrc: `${LOGO_BASE}/githubcopilot.svg`,
    logoAlt: "GitHub Copilot",
    product: "GitHub Copilot",
    dimension: "What",
  },
  {
    kind: "tool",
    logoSrc: `${LOGO_BASE}/gitlens-mark.svg`,
    logoAlt: "GitLens",
    product: "GitLens",
    dimension: "When",
  },
  { kind: "gap", title: "Why?", subtitle: "Missing" },
  { kind: "gitlore", product: "GitLore", dimension: "Why", tagline: "Decisions, cited" },
];

const CIRCLE =
  "flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-full border bg-[var(--elevated)] sm:h-[52px] sm:w-[52px]";

function ToolCircle({ step }: { step: ToolStep }) {
  const { theme } = useTheme();
  const monoNight = theme === "dark";

  return (
    <div className={`${CIRCLE} border-[var(--border-strong)]`}>
      <img
        src={step.logoSrc}
        alt=""
        role="presentation"
        className={`h-6 w-6 object-contain sm:h-[26px] sm:w-[26px] ${monoNight ? "brightness-0 invert opacity-[0.9]" : ""}`}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

function GapCircle({ step }: { step: GapStep }) {
  return (
    <div
      className={`${CIRCLE} border-dashed border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--elevated)_65%,transparent)]`}
      aria-hidden
    >
      <span className="font-heading text-base font-semibold text-[var(--text-ghost)] sm:text-lg">?</span>
    </div>
  );
}

function GitLoreCircle() {
  return (
    <div className={`${CIRCLE} border-[var(--accent)]/40 bg-[var(--accent-dim)]`} aria-hidden>
      <span className="h-2 w-2 rounded-sm bg-[var(--accent)]" />
    </div>
  );
}

function StepCopy({ step }: { step: ToolStep | GapStep | GitLoreStep }) {
  if (step.kind === "tool") {
    return (
      <>
        <p className="mt-3 font-code text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-ghost)]">{step.product}</p>
        <p className="mt-1 font-heading text-[15px] font-semibold tracking-[-0.02em] text-[var(--text)]">{step.dimension}</p>
      </>
    );
  }
  if (step.kind === "gap") {
    return (
      <>
        <p className="mt-3 font-code text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-ghost)]">{step.subtitle}</p>
        <p className="mt-1 font-heading text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-secondary)]">{step.title}</p>
      </>
    );
  }
  return (
    <>
      <p className="mt-3 font-code text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">{step.tagline}</p>
      <p className="mt-1 font-heading text-[15px] font-semibold tracking-[-0.02em] text-[var(--accent)]">{step.dimension}</p>
      <p className="mt-0.5 font-heading text-[12px] font-medium tracking-tight text-[var(--accent)]/85">{step.product}</p>
    </>
  );
}

function StepCircle({ step }: { step: ToolStep | GapStep | GitLoreStep }) {
  if (step.kind === "tool") return <ToolCircle step={step} />;
  if (step.kind === "gap") return <GapCircle step={step} />;
  return <GitLoreCircle />;
}

function ConnectorLine() {
  /* Vertical center of ~52px circles */
  return <div className="hidden h-px min-w-[14px] flex-1 bg-[var(--border-strong)] md:mt-[26px] md:block" aria-hidden />;
}

function stepAriaLabel(step: ToolStep | GapStep | GitLoreStep): string {
  if (step.kind === "tool") return `${step.logoAlt}: ${step.dimension}`;
  if (step.kind === "gap") return "Why: not answered by blame, Copilot, or GitLens";
  return `${step.product}: ${step.dimension}`;
}

/**
 * Horizontal “who → what → when → gap → why” rail after the three pillars.
 */
export function DifferentiatorFlowSection() {
  return (
    <div
      id="differentiator"
      className="mt-16 border-t border-[var(--border)] pt-14 md:mt-20 md:pt-16"
      role="region"
      aria-labelledby="differentiator-heading"
    >
      <div className="section-label">
        <p>Where GitLore fits</p>
      </div>
      <h3
        id="differentiator-heading"
        className="max-w-[640px] font-heading text-[clamp(1.2rem,2.6vw,1.65rem)] font-bold leading-snug tracking-[-0.035em] text-[var(--text)]"
      >
        Familiar tools answer who, what, and when.{" "}
        <span className="text-[var(--accent)]">GitLore answers why.</span>
      </h3>
      <p className="mt-3 max-w-[560px] font-body text-[14px] leading-relaxed text-[var(--text-secondary)] md:text-[15px]">
        Blame, Copilot, and GitLens stay in your workflow. GitLore adds a searchable layer on top of merged PRs and review threads.
      </p>

      <div className="mt-10 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-7 py-7 md:px-7 md:py-8">
        {/* Desktop rail */}
        <div className="mx-auto hidden max-w-[860px] md:block">
          <div className="flex w-full flex-row flex-nowrap items-start justify-center">
            {STEPS.map((step, i) => (
              <Fragment key={i}>
                {i > 0 ? <ConnectorLine /> : null}
                <div
                  className="flex w-[92px] shrink-0 flex-col items-center text-center sm:w-[104px]"
                  aria-label={stepAriaLabel(step)}
                >
                  <StepCircle step={step} />
                  <StepCopy step={step} />
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        {/* Mobile: stacked rows */}
        <ul className="mx-auto max-w-[400px] space-y-3 md:hidden">
          {STEPS.map((step, i) => (
            <li
              key={i}
              className="flex items-center gap-4 rounded-[6px] border border-[var(--border)] bg-[var(--elevated)] px-4 py-3.5"
              aria-label={
                step.kind === "tool"
                  ? `${step.product}: ${step.dimension}`
                  : step.kind === "gap"
                    ? "Why: missing in other tools"
                    : `${step.product}: ${step.dimension}`
              }
            >
              <StepCircle step={step} />
              <div className="min-w-0 flex-1 text-left">
                {step.kind === "tool" && (
                  <>
                    <p className="font-code text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-ghost)]">{step.product}</p>
                    <p className="mt-0.5 font-heading text-[16px] font-semibold text-[var(--text)]">{step.dimension}</p>
                  </>
                )}
                {step.kind === "gap" && (
                  <>
                    <p className="font-code text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-ghost)]">{step.subtitle}</p>
                    <p className="mt-0.5 font-heading text-[16px] font-semibold text-[var(--text-secondary)]">{step.title}</p>
                  </>
                )}
                {step.kind === "gitlore" && (
                  <>
                    <p className="font-code text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">{step.tagline}</p>
                    <p className="mt-0.5 font-heading text-[16px] font-semibold text-[var(--accent)]">
                      {step.dimension} · {step.product}
                    </p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="mx-auto mt-6 max-w-[640px] text-center font-body text-[10px] leading-relaxed text-[var(--text-ghost)] md:text-[11px]">
        Git, GitHub, GitHub Copilot, and GitLens are trademarks of their respective owners. GitLore is not affiliated with or endorsed by them.
      </p>
    </div>
  );
}
