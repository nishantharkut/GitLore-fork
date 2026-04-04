import { FadeIn } from "../effects/FadeIn";
import { ConnectGithubCta } from "../ConnectGithubCta";
import { useAuth } from "@/context/AuthContext";

const FinalCTA = () => {
  const { user, loading } = useAuth();
  const label = user && !loading ? "Go to Dashboard" : "Connect GitHub Repo";

  return (
    <section className="relative overflow-hidden py-24 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] md:py-36">
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 80%, var(--accent-glow), transparent 55%)",
        }}
        aria-hidden
      />
      <FadeIn direction="up">
        <div className="landing-container relative min-w-0">
          <div className="mx-auto w-full max-w-[800px] rounded-[2rem] border border-[var(--border-accent)]/30 bg-[var(--surface)]/45 px-5 py-12 text-center shadow-[0_0_80px_-24px_var(--accent-glow),0_24px_64px_-24px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:px-8 sm:py-14 md:px-14 md:py-16">
            <div className="mx-auto mb-6 h-px w-16 bg-gradient-to-r from-transparent via-[var(--accent)]/60 to-transparent" aria-hidden />
            <h2 className="font-heading text-[clamp(26px,_4.5vw,_46px)] font-bold leading-[1.1] tracking-[-0.04em] text-[var(--text)]">
              Your team made 1000 decisions. Make them searchable.
            </h2>
            <ConnectGithubCta className="mt-10 inline-flex h-12 w-full max-w-full items-center justify-center rounded-xl bg-[var(--accent)] px-6 font-heading text-[13px] font-medium text-white shadow-[0_12px_40px_-10px_var(--accent-glow)] transition-[filter,transform] duration-200 hover:brightness-110 active:scale-[0.98] sm:w-auto sm:px-8">
              {label}
            </ConnectGithubCta>
            <p className="mt-5 font-body text-[13px] font-normal tracking-[-0.01em] text-[var(--text-secondary)]">
              Free · Public repos · 2 minutes to your first answer
            </p>
          </div>
        </div>
      </FadeIn>
    </section>
  );
};

export default FinalCTA;
