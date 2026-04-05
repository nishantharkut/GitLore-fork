import { useEffect, useRef } from "react";
import { Moon, Sun } from "lucide-react";
import { ConnectGithubCta } from "../ConnectGithubCta";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

const navLinkClass =
  "rounded-[6px] px-2 py-1 font-heading text-[12px] font-medium tracking-[-0.02em] text-[var(--text-secondary)] transition-colors duration-200 hover:bg-[var(--surface-hover)] hover:text-[var(--accent)] md:text-[13px]";

const LandingNavbar = () => {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navRef = useRef<HTMLElement>(null);
  const rafRef = useRef<number | null>(null);

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
    <nav
      ref={navRef}
      className="landing-nav fixed left-0 right-0 top-0 z-[100] grid h-[52px] grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-transparent pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] sm:gap-3 md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))]"
    >
      <div className="flex min-w-0 justify-self-start">
      <a
        href="#landing-top"
        className="group flex shrink-0 items-center gap-2 font-heading text-[16px] font-medium tracking-tight text-[var(--accent)] transition-opacity hover:opacity-90"
      >
        <span
          className="relative flex h-2 w-2 shrink-0 rounded-sm bg-[var(--accent)] transition-transform duration-300 group-hover:scale-110"
          aria-hidden
        />
        GitLore
      </a>
      </div>

      <div className="flex min-w-0 justify-center justify-self-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex shrink-0 items-center gap-1 sm:gap-2 lg:gap-3">
          <a href="#features" className={navLinkClass}>
            Features
          </a>
          <a href="#technology" className={navLinkClass}>
            Technology
          </a>
          <a href="#how-it-works" className={navLinkClass}>
            How It Works
          </a>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end justify-self-end gap-2">
        <button
          type="button"
          onClick={() => toggleTheme()}
          className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] text-[var(--text-secondary)] transition-colors duration-200 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={theme === "dark" ? "Light theme" : "Dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
        </button>
        <ConnectGithubCta className="nav-btn inline-flex h-[34px] items-center rounded-[6px] bg-[var(--accent)] px-3 font-heading text-[12px] font-medium text-white transition-[filter] duration-200 hover:brightness-110 sm:px-4 sm:text-[13px]">
          {user ? (
            <>
              <span className="sm:hidden">Dashboard</span>
              <span className="hidden sm:inline">Go to Dashboard</span>
            </>
          ) : (
            <>
              <span className="sm:hidden">Connect</span>
              <span className="hidden sm:inline">Connect GitHub Repo</span>
            </>
          )}
        </ConnectGithubCta>
      </div>
    </nav>
  );
};

export default LandingNavbar;
