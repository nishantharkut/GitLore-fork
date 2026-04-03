import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import gsap from "gsap";
import { Menu, X } from "lucide-react";
import { GuardrailsModal } from "./GuardrailsModal";

/* ── Search Results ── */
const SEARCH_RESULTS = [
  { text: "Chose Redis over Memcached for session store", score: 91 },
  { text: "Added CDN caching headers after performance audit", score: 84 },
  { text: "Removed in-memory cache due to memory leaks", score: 78 },
];

const SearchBar = () => {
  const [query, setQuery] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);
  const hasText = query.trim().length > 0;
  const prevHasText = useRef(false);

  useEffect(() => {
    if (hasText && !prevHasText.current && resultsRef.current) {
      const items = resultsRef.current.querySelectorAll(".search-result");
      gsap.from(items, { y: 10, opacity: 0, stagger: 0.1, duration: 0.3, ease: "power2.out" });
    }
    prevHasText.current = hasText;
  }, [hasText]);

  return (
    <div className="relative w-full">
      <input
        type="text"
        placeholder='Search decisions... e.g. "caching tradeoffs"'
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-sm border border-gitlore-border bg-gitlore-code px-4 py-2.5 font-heading text-sm text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent md:max-lg:text-[13px] lg:text-sm"
      />
      {hasText && (
        <div
          ref={resultsRef}
          className={`z-50 mt-1 overflow-hidden rounded-sm border border-gitlore-border bg-gitlore-surface max-md:space-y-2 max-md:p-2 md:absolute md:left-0 md:right-0 md:top-full md:mt-1 md:space-y-0 md:p-0`}
        >
          {SEARCH_RESULTS.map((r) => (
            <div
              key={r.text}
              className="search-result flex cursor-pointer flex-col gap-1 rounded-sm px-4 py-3 transition-colors max-md:w-full max-md:border max-md:border-gitlore-border max-md:bg-gitlore-code/40 md:flex-row md:items-center md:gap-3 md:border-0 md:bg-transparent md:hover:bg-gitlore-surface-hover"
            >
              <div className="flex items-start gap-3 md:contents">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gitlore-accent md:mt-0" />
                <span className="flex-1 text-sm leading-snug text-gitlore-text">{r.text}</span>
              </div>
              <span className="shrink-0 pl-5 font-code text-xs text-gitlore-text-secondary md:pl-0">{r.score}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Navbar ── */
const APP_PATHS = ["/app", "/overview", "/patterns"];

const Navbar = () => {
  const location = useLocation();
  const isApp = APP_PATHS.includes(location.pathname);
  const [guardrailsOpen, setGuardrailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <>
      <nav className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-gitlore-border bg-gitlore-bg px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3 md:gap-6">
          <Link to="/" className="shrink-0 font-heading text-lg font-bold tracking-tight text-gitlore-accent">
            GitLore
          </Link>
          {isApp && (
            <div className="hidden items-center gap-1 md:flex md:max-lg:gap-0.5">
              <Link
                to="/overview"
                className={`rounded-sm px-2.5 py-1.5 text-sm transition-colors md:max-lg:px-2 md:max-lg:text-[13px] ${
                  location.pathname === "/overview" ? "text-gitlore-accent" : "text-gitlore-text-secondary hover:text-gitlore-text"
                }`}
              >
                Overview
              </Link>
              <Link
                to="/patterns"
                className={`rounded-sm px-2.5 py-1.5 text-sm transition-colors md:max-lg:px-2 md:max-lg:text-[13px] ${
                  location.pathname === "/patterns" ? "text-gitlore-accent" : "text-gitlore-text-secondary hover:text-gitlore-text"
                }`}
              >
                Patterns
              </Link>
              <Link
                to="/app"
                className={`rounded-sm px-2.5 py-1.5 text-sm transition-colors md:max-lg:px-2 md:max-lg:text-[13px] ${
                  location.pathname === "/app" ? "text-gitlore-accent" : "text-gitlore-text-secondary hover:text-gitlore-text"
                }`}
              >
                Live repo
              </Link>
            </div>
          )}
        </div>

        {isApp && (
          <div className="hidden min-w-0 flex-1 px-4 md:block md:max-w-md md:px-6 lg:max-w-lg">
            <SearchBar />
          </div>
        )}

        {/* Desktop actions */}
        <div className="hidden items-center gap-3 md:flex">
          <button
            type="button"
            onClick={() => setGuardrailsOpen(true)}
            className="rounded-sm border border-gitlore-border px-3 py-1.5 text-sm text-gitlore-text-secondary transition-colors hover:text-gitlore-text md:max-lg:text-[13px]"
          >
            Guardrails
          </button>
          <Link
            to="/app"
            className="rounded-sm bg-gitlore-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover md:max-lg:text-[13px]"
          >
            Connect Repo
          </Link>
        </div>

        {/* Mobile menu toggle */}
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-gitlore-border text-gitlore-text transition-colors hover:bg-gitlore-surface md:hidden"
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </nav>

      {/* Mobile slide-down menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-[80] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[#0A0A0F]/60"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-gitlore-border bg-gitlore-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-gitlore-border px-4 py-3">
              <span className="font-heading text-sm font-semibold text-gitlore-text">Menu</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-sm text-gitlore-text-secondary hover:bg-gitlore-surface hover:text-gitlore-text"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                  <div className="flex flex-col gap-1 border-b border-gitlore-border pb-4">
                    <Link
                      to="/overview"
                      className="rounded-sm px-3 py-3 text-sm text-gitlore-text transition-colors hover:bg-gitlore-surface"
                      onClick={() => setMenuOpen(false)}
                    >
                      Overview
                    </Link>
                    <Link
                      to="/patterns"
                      className="rounded-sm px-3 py-3 text-sm text-gitlore-text transition-colors hover:bg-gitlore-surface"
                      onClick={() => setMenuOpen(false)}
                    >
                      Patterns
                    </Link>
                    <Link
                      to="/app"
                      className="rounded-sm px-3 py-3 text-sm text-gitlore-text transition-colors hover:bg-gitlore-surface"
                      onClick={() => setMenuOpen(false)}
                    >
                      Live repo
                    </Link>
                  </div>

                  {isApp && (
                    <div className="border-b border-gitlore-border py-4">
                      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">Search</div>
                      <SearchBar />
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setGuardrailsOpen(true);
                      }}
                      className="w-full rounded-sm border border-gitlore-border px-3 py-3 text-left text-sm text-gitlore-text transition-colors hover:bg-gitlore-surface"
                    >
                      Guardrails
                    </button>
                    <Link
                      to="/app"
                      className="block w-full rounded-sm bg-gitlore-accent py-3 text-center text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover"
                      onClick={() => setMenuOpen(false)}
                    >
                      Connect Repo
                    </Link>
                  </div>
            </div>
          </div>
        </div>
      )}

      {guardrailsOpen && <GuardrailsModal onClose={() => setGuardrailsOpen(false)} />}
    </>
  );
};

export default Navbar;
