import { FadeIn } from "../effects/FadeIn";
import { ConnectGithubCta } from "../ConnectGithubCta";
import { SplitText } from "../effects/SplitText";

const FinalCTA = () => {
  return (
    <section className="flex flex-col items-center justify-center bg-[var(--bg)] px-5 py-24 text-center md:py-32">
      <FadeIn direction="up">
        <h2 className="font-heading text-[clamp(32px,_5vw,_48px)] font-bold leading-[0.95] tracking-[-0.03em] text-[var(--text)]">
          <SplitText as="span">Your code has stories.</SplitText>
        </h2>
        <h2 className="mt-2 font-heading text-[clamp(32px,_5vw,_48px)] font-bold leading-[0.95] tracking-[-0.03em] text-[var(--accent)]">
          <SplitText as="span" delay={200}>
            Start reading them.
          </SplitText>
        </h2>
        <ConnectGithubCta className="mt-10 inline-flex h-11 items-center rounded-[4px] bg-[var(--accent)] px-6 font-heading text-[13px] font-medium text-white transition-[filter] duration-200 hover:brightness-110">
          Connect GitHub Repo
        </ConnectGithubCta>
        <p className="mt-3 font-body text-[12px] font-normal tracking-[-0.01em] text-[var(--text-ghost)]">
          Free to use · Works on any public repo
        </p>
      </FadeIn>
    </section>
  );
};

export default FinalCTA;
