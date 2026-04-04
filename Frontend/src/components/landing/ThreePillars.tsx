import { FadeIn } from "../effects/FadeIn";
import { MessageSquare, Network, Zap } from "lucide-react";

/** Decorative mini graph for Knowledge Graph pillar (static SVG). */
function MiniKnowledgeGraphVisual() {
  const nodes = [
    { cx: 28, cy: 22, r: 5 },
    { cx: 72, cy: 14, r: 4 },
    { cx: 100, cy: 38, r: 4.5 },
    { cx: 48, cy: 48, r: 3.5 },
    { cx: 88, cy: 58, r: 4 },
    { cx: 18, cy: 58, r: 3 },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 3],
    [1, 2],
    [2, 4],
    [3, 4],
    [3, 5],
    [0, 5],
  ];
  return (
    <svg viewBox="0 0 120 72" className="h-full w-full max-h-[140px]" aria-hidden>
      {edges.map(([a, b], i) => {
        const A = nodes[a];
        const B = nodes[b];
        return (
          <line
            key={i}
            x1={A.cx}
            y1={A.cy}
            x2={B.cx}
            y2={B.cy}
            stroke="var(--border-strong)"
            strokeOpacity={0.55}
            strokeWidth={1.2}
          />
        );
      })}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.cx} cy={n.cy} r={n.r} fill="var(--accent)" fillOpacity={0.85 + (i % 3) * 0.05} />
      ))}
    </svg>
  );
}

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
      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-2.5 py-1 font-code text-[9px] font-semibold text-white shadow-lg">
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
    <section id="features" className="relative overflow-hidden py-16 md:py-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 50% 35% at 80% 20%, rgba(129, 140, 248, 0.07), transparent), radial-gradient(ellipse 45% 30% at 10% 80%, var(--accent-dim), transparent)",
        }}
        aria-hidden
      />
      <div className="landing-container relative">
        <FadeIn direction="up">
          <div className="section-label">
            <p>What GitLore does</p>
          </div>
          <h2 className="font-heading text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.04em] text-[var(--text)]">
            What GitLore Does
          </h2>

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
            {/* Pillar 1 — largest */}
            <div className="bento-card rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 md:col-span-2 lg:col-span-7">
              <div className="flex h-full flex-col px-6 pb-6 pt-7 md:px-8 md:pb-8 md:pt-8">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--elevated)] text-[var(--accent)]">
                    <Network className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-heading text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)] md:text-[20px]">
                      Knowledge Graph
                    </h3>
                    <p className="mt-1 font-heading text-[14px] font-medium text-[var(--accent)]">Build once. Search forever.</p>
                  </div>
                </div>
                <p className="mt-4 max-w-[540px] font-body text-[14px] leading-[1.7] text-[var(--text-secondary)] md:text-[15px]">
                  One click to ingest your merged PRs. GitLore extracts every decision — what was chosen, what was rejected, who decided, and why.
                  Search with natural language. Chat with cited answers.
                </p>
                <div className="mt-6 flex min-h-[120px] flex-1 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--code-bg)]/90 px-4 py-4 shadow-inner">
                  <MiniKnowledgeGraphVisual />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 lg:col-span-5">
              <div id="chrome-extension" className="bento-card flex-1 scroll-mt-24 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95">
                <div className="px-6 pb-6 pt-7 md:px-7">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--elevated)] text-[var(--accent)]">
                      <MessageSquare className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-heading text-[17px] font-semibold tracking-[-0.02em] text-[var(--text)]">Chrome Extension</h3>
                      <p className="mt-0.5 font-heading text-[13px] font-medium text-[var(--accent)]">Right on GitHub. Zero switching.</p>
                    </div>
                  </div>
                  <p className="mt-3 font-body text-[13px] leading-[1.65] text-[var(--text-secondary)] md:text-[14px]">
                    A permanent floating button on every GitHub repo page. Click it — chat with the repo&apos;s Knowledge Graph instantly. No new
                    tabs. No context switching.
                  </p>
                  <ChromeExtensionMockup />
                </div>
              </div>

              <div className="bento-card flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95">
                <div className="px-6 pb-6 pt-7 md:px-7">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--elevated)] text-[var(--accent)]">
                      <Zap className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-heading text-[17px] font-semibold tracking-[-0.02em] text-[var(--text)]">Automated PR Workflows</h3>
                      <p className="mt-0.5 font-heading text-[13px] font-medium text-[var(--accent)]">Every review explained. Every merge indexed.</p>
                    </div>
                  </div>
                  <p className="mt-3 font-body text-[13px] leading-[1.65] text-[var(--text-secondary)] md:text-[14px]">
                    Three automations via SuperPlane: review comments auto-explained with pattern name, fix, and confidence; merged PRs refresh the
                    Knowledge Graph; new PRs surface related past decisions proactively.
                  </p>
                  <SuperPlaneFlowDiagram />
                </div>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

export default ThreePillars;
