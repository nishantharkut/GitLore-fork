import { FadeIn } from "../effects/FadeIn";
import { Mic, Shield, Sparkles, Timer } from "lucide-react";

const cards = [
  {
    icon: Timer,
    title: "Code Archaeology",
    body: "Click any line → see the full story: every commit, PR, review, and issue that touched it. Timeline with debate quotes and confidence scoring.",
  },
  {
    icon: Sparkles,
    title: "Review Explainer",
    body: "Terse review comment? One click for the explanation, the fix, the engineering principle, and documentation links.",
  },
  {
    icon: Mic,
    title: "Voice Narration",
    body: "Listen to your code's story in English or Hindi. Voice agent for hands-free Q&A about any decision.",
  },
  {
    icon: Shield,
    title: "Security & Guardrails",
    body: "18 tool actions classified by risk. High-risk actions blocked by policy. Data minimization — only PR metadata sent to AI, never source code.",
  },
];

const SupportingFeatures = () => {
  return (
    <section className="relative overflow-hidden border-y border-[var(--border)] bg-[var(--surface)]/85 py-16 backdrop-blur-[1px] md:py-24">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{ background: "radial-gradient(ellipse 60% 40% at 50% 100%, var(--accent-dim), transparent 55%)" }}
        aria-hidden
      />
      <div className="landing-container relative">
        <FadeIn direction="up">
          <div className="section-label">
            <p>Supporting capabilities</p>
          </div>
          <h2 className="max-w-[640px] font-heading text-[clamp(1.5rem,3vw,2.35rem)] font-bold tracking-[-0.04em] text-[var(--text)]">
            And everything that supports it
          </h2>

          <div className="mt-11 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {cards.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--elevated)]/90 p-6 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.3)] transition-all duration-300 hover:-translate-y-1 hover:border-[var(--border-accent)] hover:shadow-[0_20px_48px_-12px_rgba(0,0,0,0.35),0_0_0_1px_var(--accent-dim)]"
              >
                <div
                  className="absolute inset-x-0 top-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-[var(--accent)]/40 to-transparent transition-transform duration-500 group-hover:scale-x-100"
                  aria-hidden
                />
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)] shadow-sm transition-transform duration-300 group-hover:scale-105 group-hover:border-[var(--border-accent)]">
                  <Icon className="h-5 w-5" aria-hidden strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 font-heading text-[16px] font-semibold tracking-[-0.02em] text-[var(--text)]">{title}</h3>
                <p className="mt-2 flex-1 font-body text-[13px] leading-[1.7] text-[var(--text-secondary)]">{body}</p>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

export default SupportingFeatures;
