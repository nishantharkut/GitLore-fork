import { FadeIn } from "../effects/FadeIn";
import { MessageSquare, Network, Zap } from "lucide-react";
import { DifferentiatorFlowSection } from "./WhyDifferentiatorFlow";
import { KnowledgeGraphCanvas } from "./KnowledgeGraph";

function ChromeExtensionMockup() {
  return (
    <div
      className="relative mt-4 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--code-bg)]"
      style={{ minHeight: 132 }}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--elevated)] px-2 py-1.5">
        <div className="flex shrink-0 gap-1">
          <span className="h-2 w-2 rounded-full bg-[var(--text-ghost)] opacity-40" />
          <span className="h-2 w-2 rounded-full bg-[var(--text-ghost)] opacity-40" />
        </div>
        <span className="min-w-0 truncate font-code text-[9px] text-[var(--text-ghost)]">github.com/org/repo</span>
      </div>
      <div className="p-3 pb-10">
        <div className="h-2 w-3/4 max-w-[180px] rounded bg-[var(--border)] opacity-50" />
        <div className="mt-2 h-2 w-1/2 max-w-[120px] rounded bg-[var(--border)] opacity-35" />
      </div>
      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-2.5 py-1 font-code text-[9px] font-semibold text-white">
        <MessageSquare className="h-3 w-3" aria-hidden />
        GitLore
      </div>
    </div>
  );
}

function SuperPlaneFlowDiagram() {
  const steps = [
    { label: "Review comment", sub: "→ auto-explained" },
    { label: "PR merged", sub: "→ graph updated" },
    { label: "PR opened", sub: "→ related decisions" },
  ];
  return (
    <div className="mt-4 space-y-2">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--accent)] bg-[var(--accent)]/10 font-code text-[10px] font-bold text-[var(--accent)]">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--elevated)] px-2 py-1.5">
            <p className="font-code text-[10px] font-medium text-[var(--text)]">{s.label}</p>
            <p className="font-code text-[9px] text-[var(--text-secondary)]">{s.sub}</p>
          </div>
        </div>
      ))}
      <p className="pt-1 font-code text-[9px] uppercase tracking-wider text-[var(--text-ghost)]">SuperPlane · 3 automations</p>
    </div>
  );
}

const ThreePillars = () => {
  return (
    <section id="features" className="relative overflow-hidden bg-[var(--bg)] py-16 md:py-28">
      <div className="landing-container relative">
        <FadeIn direction="up">
          <div className="section-label">
            <p>What GitLore does</p>
          </div>
          <h2 className="font-heading text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.04em] text-[var(--text)]">
            What GitLore Does
          </h2>

          <div className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--border)] md:grid-cols-2 lg:grid-cols-12">
            <div className="bento-card flex min-h-[32rem] flex-col md:col-span-2 lg:col-span-7 lg:row-span-2 lg:min-h-[36rem]">
              <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface)] px-7 pb-6 pt-7">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--elevated)] text-[var(--accent)]">
                    <Network className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-heading text-[18px] font-semibold tracking-[-0.02em] text-[var(--text)]">
                      Knowledge Graph
                    </h3>
                    <p className="mt-1 font-heading text-[14px] font-medium text-[var(--accent)]">Build once. Search forever.</p>
                  </div>
                </div>
                <p className="mt-4 max-w-[540px] font-body text-[14px] font-normal leading-[1.65] tracking-[-0.01em] text-[var(--text-secondary)]">
                  One click to ingest your merged PRs. GitLore extracts every decision: what was chosen, what was rejected, who decided, and why.
                  Search with natural language. Chat with cited answers.
                </p>
                <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--code-bg)]">
                  <KnowledgeGraphCanvas
                    captionOverlay
                    className=""
                    canvasClassName=""
                  />
                </div>
              </div>
            </div>

            <div id="chrome-extension" className="bento-card scroll-mt-24 lg:col-span-5">
              <div className="bg-[var(--surface)] px-7 pb-6 pt-7">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--elevated)] text-[var(--accent)]">
                    <MessageSquare className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-heading text-[18px] font-semibold tracking-[-0.02em] text-[var(--text)]">Chrome Extension</h3>
                    <p className="mt-1 font-heading text-[13px] font-medium text-[var(--accent)]">Right on GitHub. Zero switching.</p>
                  </div>
                </div>
                <p className="mt-3 font-body text-[14px] font-normal leading-[1.65] tracking-[-0.01em] text-[var(--text-secondary)]">
                  A permanent floating button on every GitHub repo page. Click it to chat with the repo&apos;s Knowledge Graph instantly. No new
                  tabs. No context switching.
                </p>
                <ChromeExtensionMockup />
              </div>
            </div>

            <div className="bento-card lg:col-span-5">
              <div className="bg-[var(--surface)] px-7 pb-6 pt-7">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--elevated)] text-[var(--accent)]">
                    <Zap className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-heading text-[18px] font-semibold tracking-[-0.02em] text-[var(--text)]">Automated PR Workflows</h3>
                    <p className="mt-1 font-heading text-[13px] font-medium text-[var(--accent)]">Every review explained. Every merge indexed.</p>
                  </div>
                </div>
                <p className="mt-3 font-body text-[14px] font-normal leading-[1.65] tracking-[-0.01em] text-[var(--text-secondary)]">
                  Three automations via SuperPlane: review comments auto-explained with pattern name, fix, and confidence; merged PRs refresh the
                  Knowledge Graph; new PRs surface related past decisions proactively.
                </p>
                <SuperPlaneFlowDiagram />
              </div>
            </div>
          </div>

          <DifferentiatorFlowSection />
        </FadeIn>
      </div>
    </section>
  );
};

export default ThreePillars;
