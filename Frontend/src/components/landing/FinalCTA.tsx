import { FadeIn } from "../effects/FadeIn";
import { ConnectGithubCta } from "../ConnectGithubCta";
import { useAuth } from "@/context/AuthContext";

const FinalCTA = () => {
  const { user, loading } = useAuth();
  const label = user && !loading ? "Go to Dashboard" : "Connect GitHub Repo";

  return (
    <section className="relative flex flex-col items-center justify-center overflow-hidden bg-[var(--bg)] px-5 py-24 text-center md:py-32">
      <FadeIn direction="up">
        <h2 className="font-heading text-[clamp(32px,_5vw,_48px)] font-bold leading-[0.95] tracking-[-0.03em] text-[var(--text)]">
          Your team made 1000 decisions.
        </h2>
        <h2 className="mt-2 font-heading text-[clamp(32px,_5vw,_48px)] font-bold leading-[0.95] tracking-[-0.03em] text-[var(--accent)]">
          Make them searchable.
        </h2>
        <ConnectGithubCta className="mt-10 inline-flex h-11 items-center rounded-[4px] bg-[var(--accent)] px-6 font-heading text-[13px] font-medium text-white transition-[filter] duration-200 hover:brightness-110">
          {label}
        </ConnectGithubCta>
        <p className="mt-3 font-body text-[12px] font-normal tracking-[-0.01em] text-[var(--text-ghost)]">
          Free · Public repos · 2 minutes to your first answer
        </p>
      </FadeIn>
    </section>
  );
};

export default FinalCTA;
