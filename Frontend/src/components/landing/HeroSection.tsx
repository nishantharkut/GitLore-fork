import { BlurReveal } from "../effects/BlurReveal";
import { ConnectGithubCta } from "../ConnectGithubCta";
import { useAuth } from "@/context/AuthContext";
import { Magnet } from "../effects/Magnet";
import { SplitText } from "../effects/SplitText";
import { TextScramble } from "../effects/TextScramble";
import HeroProductDemo from "./HeroProductDemo";

/** Static code window — desktop accent beside hero copy. */
const HeroCodeVisual = () => (
  <div className="hero-code-float relative overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--code-bg)]/95 font-code text-[11px] leading-relaxed shadow-[0_24px_64px_-12px_rgba(0,0,0,0.55),0_0_0_1px_var(--accent-dim)] ring-1 ring-[var(--accent)]/10 md:text-[12px]">
    <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent)]/[0.04] via-transparent to-[var(--code-accent)]/[0.05] pointer-events-none" aria-hidden />
    <div className="relative flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--elevated)]/90 px-3 py-2 backdrop-blur-sm">
      <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
      <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
      <span className="h-2 w-2 rounded-full bg-[#28c840]" />
      <span className="ml-2 text-[10px] text-[var(--text-ghost)]">rate_limiter.py</span>
    </div>
    <div className="relative p-4 text-[var(--text-code)]">
      <div>
        <span className="text-[var(--text-ghost)]">12</span> <span className="text-[var(--code-accent)]">def</span> is_allowed(self, client_id):
      </div>
      <div>
        <span className="text-[var(--text-ghost)]">13</span> now = time.time()
      </div>
      <div className="my-[6px] bg-[var(--code-highlight)] px-4 py-[6px]">
        <span className="text-[var(--accent)]">14</span>{" "}
        <span className="text-[var(--text-code)]">if len(self.requests[client_id]) &gt;= self.max_requests:</span>
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
  const { user, loading } = useAuth();
  const primaryCtaLabel = user ? "Go to Dashboard" : "Connect GitHub Repo";

  return (
    <section className="relative flex min-h-[100dvh] flex-col overflow-hidden pb-20 pt-[calc(52px+2.75rem)] md:pb-24 md:pt-[calc(52px+4.5rem)] lg:pt-[calc(52px+5.5rem)]">
      {/* Local hero wash (adds depth on top of fixed backdrop) */}
      <div
        className="pointer-events-none absolute left-1/2 top-[10%] h-[min(70vh,520px)] w-[min(100%,900px)] -translate-x-1/2 rounded-full opacity-50 blur-3xl"
        style={{
          background: "radial-gradient(ellipse at center, var(--accent-glow), transparent 65%)",
        }}
        aria-hidden
      />

      <div className="landing-container relative z-[1] flex w-full flex-1 flex-col">
        <div className="grid flex-1 grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_minmax(260px,36%)] lg:gap-14">
          <div className="min-w-0 text-left">
            <span className="inline-flex max-w-full items-center rounded-full border border-[var(--border-accent)]/60 bg-[var(--accent-dim)] px-3 py-1.5 text-center font-code text-[9px] font-medium uppercase leading-snug tracking-[0.18em] text-[var(--accent)] shadow-[0_0_24px_-4px_var(--accent-glow)] [overflow-wrap:anywhere] sm:text-[10px] sm:tracking-[0.22em]">
              <TextScramble text="YOUR CODEBASE'S INSTITUTIONAL MEMORY" />
            </span>

            <h1 className="mt-7 font-heading text-[clamp(24px,_4.8vw,_64px)] font-bold leading-[1.02] tracking-[-0.05em] text-[var(--text)] drop-shadow-sm">
              <SplitText as="span">Your team made 1000 decisions.</SplitText>
            </h1>
            <h1 className="mt-2 font-heading text-[clamp(24px,_4.8vw,_64px)] font-bold leading-[1.02] tracking-[-0.05em] text-[var(--accent)] [text-shadow:0_0_40px_var(--accent-glow)]">
              <SplitText as="span" delay={240}>
                None of them are searchable.
              </SplitText>
            </h1>
            <p className="mt-5 font-heading text-[clamp(1.25rem,2.5vw,1.85rem)] font-semibold tracking-[-0.03em] text-[var(--text)]">
              Until now.
            </p>

            <BlurReveal
              as="p"
              delay={120}
              className="mt-6 max-w-[580px] font-body text-[15px] font-normal leading-[1.8] md:text-[17px]"
            >
              <span className="text-[var(--text-secondary)]">
                GitLore reads your entire PR history — titles, descriptions, review comments, debates — and builds a Knowledge Graph of every
                decision your team has ever made. Search it. Chat with it. Get cited answers in seconds.
              </span>
            </BlurReveal>

            <div className="mt-9 flex w-full max-w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Magnet strength={0.2} className="w-full sm:w-auto">
                <ConnectGithubCta className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[var(--accent)] px-7 font-heading text-[13px] font-medium text-white shadow-[0_8px_32px_-8px_var(--accent-glow),0_0_0_1px_rgba(255,255,255,0.08)_inset] transition-[filter,transform] duration-200 hover:brightness-110 active:scale-[0.98] sm:w-auto">
                  {loading ? "Connect GitHub Repo" : primaryCtaLabel}
                </ConnectGithubCta>
              </Magnet>
              <a
                href="#how-it-works"
                className="hero-secondary-cta inline-flex h-12 w-full items-center justify-center rounded-xl border border-[var(--border-strong)] px-7 font-heading text-[13px] font-medium text-[var(--text-secondary)] transition-colors duration-200 sm:w-auto"
              >
                See how it works
              </a>
            </div>
            {user && !loading ? (
              <p className="mt-3 text-sm text-[var(--text-secondary)]">
                Welcome back, <span className="font-code text-[var(--text)]">@{user.username}</span>
              </p>
            ) : null}
          </div>

          <div className="mx-auto hidden w-full max-w-[380px] lg:mx-0 lg:block lg:max-w-none lg:justify-self-end">
            <HeroCodeVisual />
          </div>
        </div>

        <div id="live-demo" className="mx-auto mt-14 w-full max-w-[960px] md:mt-24">
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <span className="font-code text-[10px] font-semibold uppercase tracking-[0.35em] text-[var(--text-ghost)]">Try it</span>
            <span className="h-px w-12 bg-gradient-to-r from-transparent via-[var(--accent)]/50 to-transparent" aria-hidden />
          </div>
          <div className="landing-glass-panel p-2 sm:p-3 md:p-4">
            <div className="w-full overflow-hidden rounded-lg text-left">
              <HeroProductDemo />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
