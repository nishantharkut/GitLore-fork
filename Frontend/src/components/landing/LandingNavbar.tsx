import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { GuardrailsModal } from "../GuardrailsModal";
import { ConnectGithubCta } from "../ConnectGithubCta";

const LandingNavbar = () => {
  const navRef = useRef<HTMLElement>(null);
  const rafRef = useRef<number | null>(null);
  const [guardrailsOpen, setGuardrailsOpen] = useState(false);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const scrolled = window.scrollY > 50;
        nav.classList.toggle("scrolled", scrolled);
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      <nav
        ref={navRef}
        className="landing-nav fixed left-0 right-0 top-0 z-[100] flex h-[52px] items-center justify-between border-b border-transparent px-5 md:px-6"
      >
        <Link to="/" className="font-heading text-[16px] font-medium tracking-tight text-[var(--accent)]">
          GitLore
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGuardrailsOpen(true)}
            className="nav-btn hidden h-[34px] shrink-0 rounded-[6px] border border-[var(--border)] bg-transparent px-[14px] font-heading text-[13px] font-medium text-[var(--text-secondary)] transition-colors duration-200 hover:border-[var(--border-strong)] hover:text-[var(--text)] sm:inline-block"
          >
            Guardrails
          </button>
          <ConnectGithubCta className="nav-btn inline-flex h-[34px] items-center rounded-[6px] bg-[var(--accent)] px-4 font-heading text-[13px] font-medium text-white sm:px-4">
            <span className="md:hidden">Connect</span>
            <span className="hidden md:inline">Connect Repo</span>
          </ConnectGithubCta>
        </div>
      </nav>
      {guardrailsOpen && <GuardrailsModal onClose={() => setGuardrailsOpen(false)} />}
    </>
  );
};

export default LandingNavbar;
