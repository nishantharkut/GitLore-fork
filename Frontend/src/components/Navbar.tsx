import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import gsap from "gsap";
import { Menu, X } from "lucide-react";
import { GuardrailsModal } from "./GuardrailsModal";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import { searchDecisions, searchGithubRepositories, type GithubRepoSummary } from "@/lib/gitloreApi";
import { startGithubOAuth } from "@/lib/githubOAuth";

type SearchHit = { text: string; score: number };

type SearchMode = "repos" | "decisions";

const SearchBar = () => {
  const { user } = useAuth();
  const { repoFull, repoReady, selectRepository } = useRepo();
  const [mode, setMode] = useState<SearchMode>("repos");
  const [query, setQuery] = useState("");
  const [repoResults, setRepoResults] = useState<GithubRepoSummary[]>([]);
  const [decisionResults, setDecisionResults] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const hasText = query.trim().length > 0;
  const prevHasText = useRef(false);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!user || !trimmed) {
        setRepoResults([]);
        setDecisionResults([]);
        setSearchError(null);
        return;
      }
      setSearchLoading(true);
      setSearchError(null);
      try {
        if (mode === "repos") {
          const repos = await searchGithubRepositories(trimmed, 20);
          setRepoResults(repos);
          setDecisionResults([]);
        } else {
          if (!repoReady) {
            setDecisionResults([]);
            setRepoResults([]);
            setSearchError(null);
            return;
          }
          const hits = await searchDecisions(repoFull, trimmed, 8);
          setDecisionResults(hits.map((h) => ({ text: h.text, score: h.score })));
          setRepoResults([]);
        }
      } catch (e) {
        setRepoResults([]);
        setDecisionResults([]);
        setSearchError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setSearchLoading(false);
      }
    },
    [user, mode, repoFull, repoReady]
  );

  useEffect(() => {
    if (!hasText) {
      setRepoResults([]);
      setDecisionResults([]);
      setSearchError(null);
      return;
    }
    const t = window.setTimeout(() => void runSearch(query), 320);
    return () => window.clearTimeout(t);
  }, [query, hasText, runSearch]);

  useEffect(() => {
    if (hasText && !prevHasText.current && resultsRef.current) {
      const items = resultsRef.current.querySelectorAll(".search-result");
      gsap.from(items, { y: 10, opacity: 0, stagger: 0.1, duration: 0.3, ease: "power2.out" });
    }
    prevHasText.current = hasText;
  }, [hasText, repoResults, decisionResults]);

  const onPickRepo = (r: GithubRepoSummary) => {
    selectRepository(r.owner, r.name, r.defaultBranch);
    setQuery("");
    setRepoResults([]);
    setSearchError(null);
  };

  return (
    <div className="relative w-full">
      <div className="mb-1.5 flex gap-1 rounded-sm border border-gitlore-border/80 bg-gitlore-code/50 p-0.5">
        <button
          type="button"
          onClick={() => {
            setMode("repos");
            setQuery("");
            setRepoResults([]);
            setDecisionResults([]);
            setSearchError(null);
          }}
          className={`flex-1 rounded-[3px] px-2 py-1 text-center font-heading text-[11px] font-medium uppercase tracking-wide transition-colors md:text-xs ${
            mode === "repos" ? "bg-gitlore-accent text-white" : "text-gitlore-text-secondary hover:text-gitlore-text"
          }`}
      >
          Repositories
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("decisions");
            setQuery("");
            setRepoResults([]);
            setDecisionResults([]);
            setSearchError(null);
          }}
          className={`flex-1 rounded-[3px] px-2 py-1 text-center font-heading text-[11px] font-medium uppercase tracking-wide transition-colors md:text-xs ${
            mode === "decisions" ? "bg-gitlore-accent text-white" : "text-gitlore-text-secondary hover:text-gitlore-text"
          }`}
        >
          Decisions
        </button>
      </div>
      <input
        type="text"
        placeholder={
          !user
            ? "Sign in to search repositories and decisions"
            : mode === "repos"
              ? "Search GitHub repositories…"
              : repoReady
                ? `Search decisions in ${repoFull}…`
                : "Select a repo first (use Repositories tab)"
        }
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={!user || (mode === "decisions" && !repoReady)}
        className="w-full rounded-sm border border-gitlore-border bg-gitlore-code px-4 py-2.5 font-heading text-sm text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent disabled:opacity-60 md:max-lg:text-[13px] lg:text-sm"
      />
      {hasText && user && (
        <div
          ref={resultsRef}
          className={`z-50 mt-1 overflow-hidden rounded-sm border border-gitlore-border bg-gitlore-surface max-md:max-h-[50vh] max-md:overflow-y-auto max-md:space-y-2 max-md:p-2 md:absolute md:left-0 md:right-0 md:top-full md:mt-1 md:max-h-[min(70vh,320px)] md:overflow-y-auto md:space-y-0 md:p-0`}
        >
          {searchLoading && (
            <div className="px-4 py-3 text-sm text-gitlore-text-secondary">Searching…</div>
          )}
          {searchError && <div className="px-4 py-3 text-sm text-gitlore-error">{searchError}</div>}
          {!searchLoading &&
            !searchError &&
            mode === "repos" &&
            repoResults.map((r) => (
              <button
                key={r.fullName}
                type="button"
                onClick={() => onPickRepo(r)}
                className="search-result flex w-full cursor-pointer flex-col gap-0.5 rounded-sm px-4 py-3 text-left transition-colors max-md:w-full max-md:border max-md:border-gitlore-border max-md:bg-gitlore-code/40 md:flex-row md:items-center md:justify-between md:border-0 md:bg-transparent md:hover:bg-gitlore-surface-hover"
              >
                <div className="flex min-w-0 items-start gap-3 md:contents">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gitlore-accent md:mt-0" />
                  <span className="min-w-0 flex-1 font-code text-sm text-gitlore-text">{r.fullName}</span>
                </div>
                <span className="shrink-0 pl-5 font-code text-[10px] uppercase text-gitlore-text-secondary md:pl-3">
                  {r.private ? "private" : "public"} &middot; {r.defaultBranch}
                </span>
              </button>
            ))}
          {!searchLoading &&
            !searchError &&
            mode === "decisions" &&
            decisionResults.map((r) => (
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
          {!searchLoading && !searchError && mode === "repos" && repoResults.length === 0 && (
            <div className="px-4 py-3 text-sm text-gitlore-text-secondary">No repositories matched. Try another keyword or full name (e.g. facebook/react).</div>
          )}
          {!searchLoading && !searchError && mode === "decisions" && !repoReady && (
            <div className="px-4 py-3 text-sm text-gitlore-text-secondary">Choose a repository under Repositories first.</div>
          )}
          {!searchLoading && !searchError && mode === "decisions" && repoReady && decisionResults.length === 0 && (
            <div className="px-4 py-3 text-sm text-gitlore-text-secondary">
              No indexed narratives for this repo yet. Run line analyze in Live repo first.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Navbar ── */
const APP_PATHS = ["/app", "/overview", "/patterns"];

const Navbar = () => {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { repoFull, repoReady } = useRepo();
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
              {user && repoReady ? (
                <span
                  className="ml-1 hidden max-w-[200px] truncate rounded-sm border border-gitlore-border/60 bg-gitlore-code/40 px-2 py-1 font-code text-[11px] text-gitlore-accent xl:inline-block"
                  title={repoFull}
                >
                  {repoFull}
                </span>
              ) : null}
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
          {user && (
            <span className="max-w-[140px] truncate font-code text-[11px] text-gitlore-text-secondary md:max-lg:max-w-[120px]">
              @{user.username}
            </span>
          )}
          <button
            type="button"
            onClick={() => setGuardrailsOpen(true)}
            className="rounded-sm border border-gitlore-border px-3 py-1.5 text-sm text-gitlore-text-secondary transition-colors hover:text-gitlore-text md:max-lg:text-[13px]"
          >
            Guardrails
          </button>
          {user ? (
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-sm border border-gitlore-border px-3 py-1.5 text-sm text-gitlore-text-secondary transition-colors hover:text-gitlore-text md:max-lg:text-[13px]"
            >
              Log out
            </button>
          ) : null}
          {user ? (
            <Link
              to="/app"
              className="rounded-sm bg-gitlore-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover md:max-lg:text-[13px]"
            >
              Live repo
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => startGithubOAuth()}
              className="rounded-sm bg-gitlore-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover md:max-lg:text-[13px]"
              title="Opens GitHub sign-in. If it fails, try Incognito with extensions off (content.js errors are from add-ons)."
            >
              Connect GitHub
            </button>
          )}
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
                    {user ? (
                      <Link
                        to="/app"
                        className="block w-full rounded-sm bg-gitlore-accent py-3 text-center text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover"
                        onClick={() => setMenuOpen(false)}
                      >
                        Live repo
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="block w-full rounded-sm bg-gitlore-accent py-3 text-center text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover"
                        onClick={() => {
                          setMenuOpen(false);
                          startGithubOAuth();
                        }}
                      >
                        Connect GitHub
                      </button>
                    )}
                    {user && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          void signOut();
                        }}
                        className="w-full rounded-sm border border-gitlore-border py-3 text-sm text-gitlore-text-secondary"
                      >
                        Log out
                      </button>
                    )}
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
