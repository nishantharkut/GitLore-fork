import { FadeIn } from "../effects/FadeIn";
import { Mic, Shield, Sparkles, Timer } from "lucide-react";

const items = [
  {
    id: "archaeology",
    index: "01",
    icon: Timer,
    title: "Code Archaeology",
    lgSpan: 7 as const,
    body: "Point at a line and open the full thread: commits, PRs, reviews, and issues that touched it. Timelines surface debate excerpts and confidence where we have it.",
  },
  {
    id: "explainer",
    index: "02",
    icon: Sparkles,
    title: "Review Explainer",
    lgSpan: 5 as const,
    body: "Dense comments unpack in one view: intent, the fix, the principle underneath, and links to docs when we can infer them.",
  },
  {
    id: "voice",
    index: "03",
    icon: Mic,
    title: "Voice Narration",
    lgSpan: 5 as const,
    body: "Listen to the story in English or Hindi, or ask questions aloud when you are not at the keyboard.",
  },
  {
    id: "security",
    index: "04",
    icon: Shield,
    title: "Security & Guardrails",
    lgSpan: 7 as const,
    body: "Eighteen tool actions tiered by risk; the sensitive paths stay behind policy. Models see PR metadata, not your source tree.",
  },
];

const SupportingFeatures = () => {
  return (
    <section className="relative overflow-hidden border-y border-[var(--border)] bg-[var(--bg)] py-16 md:py-24">
      <div className="landing-container relative">
        <FadeIn direction="up">
          <div className="section-label">
            <p>Supporting capabilities</p>
          </div>
          <div className="lg:flex lg:items-end lg:justify-between lg:gap-12">
            <h2 className="max-w-[min(100%,28rem)] font-heading text-[clamp(1.5rem,3vw,2.35rem)] font-bold tracking-[-0.04em] text-[var(--text)]">
              And everything that supports it
            </h2>
            <p className="mt-5 max-w-[min(100%,40rem)] font-body text-[14px] font-normal leading-[1.65] tracking-[-0.01em] text-[var(--text-secondary)] lg:mt-0 lg:max-w-[26rem] lg:text-right lg:text-[15px]">
              The graph is the spine. These are the tools around it: digging into history, unpacking reviews, listening, and staying inside policy.
            </p>
          </div>
        </FadeIn>

        <div className="mt-12 grid gap-px overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--border)] md:grid-cols-2 lg:grid-cols-12">
          {items.map(({ id, index, icon: Icon, title, body, lgSpan }, i) => (
            <FadeIn
              key={id}
              direction="up"
              delay={80 + i * 55}
              className={`h-full min-h-0 ${lgSpan === 7 ? "lg:col-span-7" : "lg:col-span-5"}`}
            >
              <article className="bento-card relative flex h-full min-h-0 flex-col bg-[var(--surface)] px-6 py-8 md:px-8 md:py-9">
                <div className="flex min-h-0 flex-1 gap-5">
                  <div className="w-px shrink-0 self-stretch bg-[var(--accent)]/35" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <span className="font-code text-[10px] font-medium tabular-nums tracking-[0.28em] text-[var(--accent)]">{index}</span>
                    <h3
                      id={`supporting-${id}`}
                      className="mt-4 flex flex-wrap items-center gap-2.5 font-heading text-[17px] font-semibold tracking-[-0.03em] text-[var(--text)] md:text-[18px]"
                    >
                      <Icon className="h-[1.1em] w-[1.1em] shrink-0 text-[var(--accent)]" aria-hidden strokeWidth={1.5} />
                      {title}
                    </h3>
                    <p className="mt-3 font-body text-[13px] leading-[1.75] tracking-[-0.01em] text-[var(--text-secondary)] md:text-[14px] md:leading-[1.7]">
                      {body}
                    </p>
                  </div>
                </div>
              </article>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
};

export default SupportingFeatures;
