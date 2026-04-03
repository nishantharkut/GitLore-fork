import { BlurReveal } from "../effects/BlurReveal";
import { ConnectGithubCta } from "../ConnectGithubCta";
import { Magnet } from "../effects/Magnet";
import { SplitText } from "../effects/SplitText";
import { TextScramble } from "../effects/TextScramble";
import HeroProductDemo from "./HeroProductDemo";

/** Static code "window" - floats beside the headline on desktop; complements the live TRY IT demo below. */
const HeroCodeVisual = () => (
  <div className="hero-code-float relative overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--code-bg)] font-code text-[11px] leading-relaxed shadow-[0_20px_48px_rgba(0,0,0,0.35)] md:text-[12px]">
    <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--elevated)] px-3 py-2">
      <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
      <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
      <span className="h-2 w-2 rounded-full bg-[#28c840]" />
      <span className="ml-2 text-[10px] text-[var(--text-ghost)]">rate_limiter.py</span>
    </div>
    <div className="p-4 text-[var(--text-code)]">
      <div>
        <span className="text-[var(--text-ghost)]">12</span> <span className="text-[var(--code-accent)]">def</span> is_allowed(self, client_id):
      </div>
      <div>
        <span className="text-[var(--text-ghost)]">13</span> now = time.time()
      </div>
      <div className="my-[6px] bg-[var(--code-highlight)] px-4 py-[6px]">
        <span className="text-[var(--accent)]">14</span> <span className="text-[var(--text-code)]">if len(self.requests[client_id]) &gt;= self.max_requests:</span>
      </div>
      <div>
        <span className="text-[var(--text-ghost)]">15</span> return False
      </div>
      <div className="mt-3 inline-flex items-center gap-2 rounded border border-[rgba(251,191,36,0.25)] bg-[var(--warning-dim)] px-2 py-1 text-[10px] text-[var(--warning)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />
        memory: in-memory only
        <span className="opacity-80">@review</span>
      </div>
    </div>
  </div>
);

const HeroSection = () => {
  return (
    <section className="relative flex min-h-[100dvh] flex-col overflow-hidden pb-16 pt-[calc(52px+2.75rem)] md:pt-[calc(52px+4.5rem)] lg:pt-[calc(52px+5.5rem)]">
      <div className="landing-container relative z-[1] flex w-full flex-1 flex-col">
        <div className="grid flex-1 grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_minmax(260px,36%)] lg:gap-14">
          <div className="min-w-0 text-left">
            <p className="font-code text-[10px] font-medium uppercase tracking-[3px] text-[var(--accent)]">
              <TextScramble text="THE CONTEXT LAYER FOR CODE" />
            </p>

            <h1 className="mt-6 font-heading text-[clamp(28px,_5.5vw,_76px)] font-bold leading-[0.95] tracking-[-0.06em] text-[var(--text)]">
              <SplitText as="span">Click any line.</SplitText>
            </h1>
            <h1 className="mt-1 font-heading text-[clamp(28px,_5.5vw,_76px)] font-bold leading-[0.95] tracking-[-0.06em] text-[var(--accent)]">
              <SplitText as="span" delay={280}>
                Get the full story.
              </SplitText>
            </h1>

            <BlurReveal as="p" delay={120} className="mt-6 max-w-[520px] font-body text-[16px] font-normal leading-[1.7]">
              <span className="text-[var(--text-secondary)]">
                Every code review tool works for the reviewer. GitLore is the first tool built for the person receiving the review.
              </span>
            </BlurReveal>

            <div className="mt-8 flex flex-wrap gap-3">
              <Magnet strength={0.2}>
                <ConnectGithubCta className="inline-flex h-11 items-center rounded-[4px] bg-[var(--accent)] px-6 font-heading text-[13px] font-medium text-white transition-[filter] duration-200 hover:brightness-110">
                  Connect GitHub Repo
                </ConnectGithubCta>
              </Magnet>
              <a
                href="#live-demo"
                className="hero-secondary-cta inline-flex h-11 items-center rounded-[4px] border border-[var(--border-strong)] border-solid bg-transparent px-6 font-heading text-[13px] font-medium text-[var(--text-secondary)] transition-colors duration-200"
              >
                See how it works
              </a>
            </div>
          </div>

          <div className="mx-auto hidden w-full max-w-[380px] lg:mx-0 lg:block lg:max-w-none lg:justify-self-end">
            <HeroCodeVisual />
          </div>
        </div>

        <div id="live-demo" className="mx-auto mt-12 w-full max-w-[960px] text-center md:mt-20">
          <p className="mb-4 font-code text-[10px] font-medium uppercase tracking-[3px] text-[var(--text-ghost)]">TRY IT</p>
          <div className="w-full text-left">
            <HeroProductDemo />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
