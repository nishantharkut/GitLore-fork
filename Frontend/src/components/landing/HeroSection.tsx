import { BlurReveal } from "../effects/BlurReveal";
import { ConnectGithubCta } from "../ConnectGithubCta";
import { useAuth } from "@/context/AuthContext";
import { Magnet } from "../effects/Magnet";
import { SplitText } from "../effects/SplitText";
import { TextScramble } from "../effects/TextScramble";
import HeroProductDemo from "./HeroProductDemo";

/** Decorative index cards — suggests PR graph without duplicating the interactive demo. */
const HERO_SIGNALS = [
  {
    pr: "PR #847",
    title: "Rate limiter: token bucket vs sliding window",
    tag: "Decision",
  },
  {
    pr: "PR #412",
    title: "Pin axios after npm incident: documented exception",
    tag: "Security",
  },
  {
    pr: "PR #203",
    title: "Reject Redis cluster: ops cost vs Memcached",
    tag: "Architecture",
  },
] as const;

const HeroSection = () => {
  const { user, loading } = useAuth();
  const primaryCtaLabel = user ? "Go to Dashboard" : "Connect GitHub Repo";

  return (
    <section className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[var(--bg)] pb-20 pt-[calc(52px+2.75rem)] md:pb-24 md:pt-[calc(52px+4.5rem)] lg:pt-[calc(52px+5.5rem)]">
      <div className="landing-container relative z-[1] flex w-full flex-1 flex-col">
        {/* Large screens: only the two-column hero is vertically centered; live demo scrolls below */}
        <div className="flex w-full min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 w-full flex-1 flex-col lg:min-h-0 lg:justify-center">
            <div className="grid min-h-0 gap-y-10 lg:grid-cols-12 lg:items-center lg:gap-x-12 lg:gap-y-0 xl:gap-x-16">
          {/* Primary story */}
          <div className="flex min-h-0 flex-col lg:col-span-7 lg:self-center">
            <header className="max-w-[580px] lg:max-w-none">
              <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-code text-[9px] font-medium uppercase leading-none tracking-[2.5px] text-[var(--accent)] sm:text-[10px] sm:tracking-[3px]">
                  <TextScramble text="INSTITUTIONAL MEMORY" />
                </span>
                <span className="hidden h-px w-8 bg-[var(--border-strong)] sm:block" aria-hidden />
                <span className="w-full font-body text-[12px] font-normal leading-snug tracking-[-0.01em] text-[var(--text-secondary)] sm:w-auto sm:text-[13px]">
                  From merged PRs and review threads, not from guesses.
                </span>
              </div>

              <h1 className="font-heading text-[clamp(1.35rem,3.8vw,2.65rem)] font-bold leading-[1.08] tracking-[-0.04em] text-[var(--text)]">
                <SplitText as="span">Your team made 1000 decisions.</SplitText>
              </h1>
              <p className="mt-2 font-heading text-[clamp(1.35rem,3.8vw,2.65rem)] font-bold leading-[1.08] tracking-[-0.04em] text-[var(--accent)]">
                <SplitText as="span" delay={200}>
                  None of them are
                </SplitText>{" "}
                <span className="italic">searchable.</span>
              </p>
              <p className="mt-4 inline-flex border-l-2 border-[var(--error)]/55 pl-3 font-heading text-[clamp(0.95rem,1.9vw,1.1rem)] font-semibold tracking-[-0.02em] text-[var(--error)]">
                Until now.
              </p>

              <BlurReveal
                as="p"
                delay={140}
                className="mt-6 max-w-[520px] font-body text-[14px] font-normal leading-[1.7] tracking-[-0.01em] text-[var(--text-secondary)] md:text-[15px] md:leading-[1.75]"
              >
                GitLore reads your entire PR history (titles, descriptions, review comments, debates) and builds a Knowledge Graph of every
                decision your team has ever made. Search it. Chat with it. Get cited answers in seconds.
              </BlurReveal>

              <div className="mt-7 flex w-full max-w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Magnet strength={0.18} className="w-full sm:w-auto">
                  <ConnectGithubCta className="inline-flex h-11 w-full items-center justify-center rounded-[6px] bg-[var(--accent)] px-8 font-heading text-[13px] font-medium text-white transition-[filter] duration-200 hover:brightness-110 sm:w-auto">
                    {loading ? "Connect GitHub Repo" : primaryCtaLabel}
                  </ConnectGithubCta>
                </Magnet>
                <a
                  href="#how-it-works"
                  className="hero-secondary-cta inline-flex h-11 w-full items-center justify-center rounded-[6px] border border-solid border-[var(--border-strong)] px-8 font-heading text-[13px] font-medium text-[var(--text-secondary)] transition-colors duration-200 sm:w-auto"
                >
                  See how it works
                </a>
              </div>

              {user && !loading ? (
                <p className="mt-4 font-body text-[13px] text-[var(--text-secondary)] md:text-sm">
                  Welcome back, <span className="font-code text-[var(--text)]">@{user.username}</span>
                </p>
              ) : null}
            </header>
          </div>

          {/* Signal stack — desktop */}
          <aside
            className="mt-14 hidden lg:col-span-5 lg:mt-0 lg:flex lg:flex-col lg:justify-center lg:self-center"
            aria-label="Examples of decisions GitLore indexes"
          >
            <p className="font-code text-[10px] font-medium uppercase tracking-[3px] text-[var(--text-ghost)]">What disappears today</p>
            <ul className="mt-5 space-y-3">
              {HERO_SIGNALS.map((s) => (
                <li
                  key={s.pr}
                  className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 transition-colors duration-200 hover:border-[var(--border-strong)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-code text-[11px] font-semibold tracking-[0.02em] text-[var(--accent)]">{s.pr}</span>
                    <span className="rounded border border-[var(--border)] bg-[var(--elevated)] px-1.5 py-0.5 font-code text-[9px] font-medium uppercase tracking-wider text-[var(--text-ghost)]">
                      {s.tag}
                    </span>
                  </div>
                  <p className="mt-2 font-body text-[13px] leading-snug tracking-[-0.01em] text-[var(--text-secondary)]">{s.title}</p>
                </li>
              ))}
            </ul>
            <p className="mt-5 font-body text-[12px] leading-relaxed tracking-[-0.01em] text-[var(--text-ghost)]">
              Every card is a real class of thread GitLore turns into a graph node: searchable and quotable in chat.
            </p>
          </aside>

          {/* Same cards, horizontal scroll on small screens */}
          <div className="-mx-1 mt-10 min-w-0 px-1 pb-1 lg:col-span-12 lg:hidden">
            <p className="mb-3 font-code text-[10px] font-medium uppercase tracking-[3px] text-[var(--text-ghost)]">What disappears today</p>
            <ul className="flex gap-3 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
              {HERO_SIGNALS.map((s) => (
                <li
                  key={s.pr}
                  className="w-[min(78vw,280px)] shrink-0 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-code text-[11px] font-semibold text-[var(--accent)]">{s.pr}</span>
                    <span className="rounded border border-[var(--border)] bg-[var(--elevated)] px-1.5 py-0.5 font-code text-[9px] font-medium uppercase tracking-wider text-[var(--text-ghost)]">
                      {s.tag}
                    </span>
                  </div>
                  <p className="mt-2 font-body text-[13px] leading-snug text-[var(--text-secondary)]">{s.title}</p>
                </li>
              ))}
            </ul>
          </div>
            </div>
          </div>
        </div>

        <div id="live-demo" className="mx-auto mt-14 w-full max-w-[960px] md:mt-24">
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <span className="font-code text-[10px] font-semibold uppercase tracking-[0.35em] text-[var(--text-ghost)]">Try it</span>
            <span className="h-px w-12 bg-[var(--accent)]/45" aria-hidden />
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
