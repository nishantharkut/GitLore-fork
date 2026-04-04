import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { ChevronDown, ExternalLink, Menu, Moon, Sun, User, X } from "lucide-react";
import { GuardrailsModal } from "./GuardrailsModal";
import { Spinner } from "@/components/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import { useTheme } from "@/context/ThemeContext";
import {
  searchDecisions,
  searchGithubRepositories,
  fetchGithubUserProfile,
  type GithubRepoSummary,
  type GithubUserProfile,
  type SearchResultItem,
} from "@/lib/gitloreApi";
import { startGithubOAuth } from "@/lib/githubOAuth";

type SearchMode = "repos" | "decisions";

function parseDecisionSource(source: string | undefined): { filePath: string; line: number } | null {
  if (!source) return null;
  const m = source.match(/^(.+):(.+)#L(\d+)$/);
  if (!m) return null;
  const line = parseInt(m[3], 10);
  if (!Number.isFinite(line) || line < 1) return null;
  return { filePath: m[2], line };
}

/** `owner/repo:path#Ln` → `path:Ln` for result badges */
function formatDecisionLocationBadge(source: string | undefined): string | null {
  if (!source) return null;
  const m = source.match(/^[^:]+:(.+)#L(\d+)$/);
  if (!m) return null;
  return `${m[1]}:L${m[2]}`;
}

function scoreBadgeClass(score: number): string {
  if (score > 70) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/35";
  if (score >= 40) return "bg-amber-500/15 text-amber-200 border-amber-500/35";
  return "bg-gitlore-border/40 text-gitlore-text-secondary border-gitlore-border/60";
}

export const SearchBar = ({ onAfterPick }: { onAfterPick?: () => void }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { repoFull, repoReady, selectRepository, setTarget } = useRepo();
  const [mode, setMode] = useState<SearchMode>("repos");
  const [query, setQuery] = useState("");
  const [repoResults, setRepoResults] = useState<GithubRepoSummary[]>([]);
  const [decisionResults, setDecisionResults] = useState<SearchResultItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [deepSearchHint, setDeepSearchHint] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const hasText = query.trim().length > 0;
  const prevHasText = useRef(false);

  useEffect(() => {
    if (!searchLoading) {
      setDeepSearchHint(false);
      return;
    }
    const t = window.setTimeout(() => setDeepSearchHint(true), 5000);
    return () => window.clearTimeout(t);
  }, [searchLoading]);

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
          setDecisionResults(hits);
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
    onAfterPick?.();
  };

  const onPickDecision = (hit: SearchResultItem) => {
    const parsed = parseDecisionSource(hit.source);
    const filePath = hit.filePath ?? parsed?.filePath;
    const line = hit.line ?? parsed?.line;
    setQuery("");
    setDecisionResults([]);
    setRepoResults([]);
    setSearchError(null);
    if (!filePath || line == null) {
      navigate("/overview", { state: { chatQuery: hit.text } });
      onAfterPick?.();
      return;
    }
    setTarget({ filePath });
    navigate("/app", { state: { file: filePath, analyzeLine: line } });
    onAfterPick?.();
  };

  return (
    <div className="relative w-full min-w-0">
      <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2">
        <div className="flex shrink-0 gap-0.5 rounded-sm border border-gitlore-border/80 bg-gitlore-code/50 p-0.5">
          <button
            type="button"
            onClick={() => {
              setMode("repos");
              setQuery("");
              setRepoResults([]);
              setDecisionResults([]);
              setSearchError(null);
            }}
            className={`rounded-[3px] px-2 py-1 text-center font-heading text-[10px] font-medium uppercase tracking-wide transition-colors md:px-2.5 md:text-[11px] ${
              mode === "repos" ? "bg-gitlore-accent text-white" : "text-gitlore-text-secondary hover:text-gitlore-text"
            }`}
          >
            Repos
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
            className={`rounded-[3px] px-2 py-1 text-center font-heading text-[10px] font-medium uppercase tracking-wide transition-colors md:px-2.5 md:text-[11px] ${
              mode === "decisions" ? "bg-gitlore-accent text-white" : "text-gitlore-text-secondary hover:text-gitlore-text"
            }`}
          >
            Decisions
          </button>
        </div>
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            placeholder={
              !user
                ? "Sign in to search…"
                : mode === "repos"
                  ? "Search GitHub repos…"
                  : repoReady
                    ? `Similar narratives in ${repoFull}…`
                    : "Pick a repo (Repos tab) first"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!user || (mode === "decisions" && !repoReady)}
            className={`h-10 w-full min-w-0 rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 font-body text-sm text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent disabled:opacity-60 md:h-9 md:py-0 md:leading-9 md:placeholder:leading-normal ${searchLoading ? "pr-9" : ""}`}
          />
          {searchLoading && (
            <span
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 md:top-[18px] md:translate-y-0"
              aria-hidden
            >
              <Spinner className="h-4 w-4" label="Searching" />
            </span>
          )}
        </div>
      </div>
      {hasText && user && (
        <div
          ref={resultsRef}
          className="z-[60] mt-1 max-h-[min(50vh,280px)] overflow-y-auto rounded-sm border border-gitlore-border bg-gitlore-surface shadow-lg md:absolute md:left-0 md:right-0 md:top-full md:mt-1 md:max-h-[min(70vh,320px)] md:shadow-xl"
        >
          {searchLoading && (
            <div className="space-y-3 px-4 py-3">
              <div className="space-y-2">
                <div className="h-3 w-full rounded bg-gitlore-border/50 animate-pulse" />
                <div className="h-3 w-[75%] rounded bg-gitlore-border/50 animate-pulse" />
                <div className="h-3 w-[50%] rounded bg-gitlore-border/50 animate-pulse" />
              </div>
              <p className="text-sm text-gitlore-text-secondary">
                {deepSearchHint
                  ? "Deep searching…"
                  : mode === "decisions"
                    ? "Searching knowledge graph…"
                    : "Searching GitHub…"}
              </p>
            </div>
          )}
          {searchError && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="text-sm text-gitlore-error">{searchError}</span>
              <button
                type="button"
                onClick={() => void runSearch(query)}
                className="rounded-sm border border-gitlore-border px-2 py-1 font-body text-xs text-gitlore-text transition-colors hover:bg-gitlore-surface-hover"
              >
                Retry
              </button>
            </div>
          )}
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
                  <span className="min-w-0 flex-1 font-code text-[13px] text-gitlore-text">{r.fullName}</span>
                </div>
                <span className="shrink-0 pl-5 font-code text-[10px] uppercase text-gitlore-text-secondary md:pl-3">
                  {r.private ? "private" : "public"} &middot; {r.defaultBranch}
                </span>
              </button>
            ))}
          {!searchLoading &&
            !searchError &&
            mode === "decisions" &&
            decisionResults.map((r, i) => {
              const locBadge = formatDecisionLocationBadge(r.source);
              return (
                <button
                  key={`${r.source ?? "hit"}-${i}-${r.text.slice(0, 20)}`}
                  type="button"
                  onClick={() => onPickDecision(r)}
                  className="search-result flex w-full cursor-pointer flex-col gap-1.5 rounded-sm px-4 py-3 text-left transition-colors hover:bg-gitlore-surface-hover max-md:border-0 max-md:bg-transparent md:flex-row md:items-start md:gap-3"
                >
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-gitlore-accent md:mt-1.5" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <span className="block font-body text-[13px] leading-snug text-gitlore-text">{r.text}</span>
                    {locBadge ? (
                      <span className="inline-block max-w-full truncate rounded border border-gitlore-border/60 bg-gitlore-code/50 px-1.5 py-0.5 font-code text-[10px] text-gitlore-text-secondary">
                        {locBadge}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 font-code text-[10px] tabular-nums md:mt-0.5 ${scoreBadgeClass(r.score)}`}
                  >
                    {r.score}%
                  </span>
                </button>
              );
            })}
          {!searchLoading && !searchError && mode === "repos" && repoResults.length === 0 && (
            <div className="px-4 py-3 text-sm text-gitlore-text-secondary">No repositories matched. Try another keyword or full name (e.g. facebook/react).</div>
          )}
          {!searchLoading && !searchError && mode === "decisions" && !repoReady && (
            <div className="px-4 py-3 text-sm text-gitlore-text-secondary">Choose a repository under Repositories first.</div>
          )}
          {!searchLoading && !searchError && mode === "decisions" && repoReady && decisionResults.length === 0 && (
            <div className="space-y-2 px-4 py-3 font-body text-sm leading-relaxed text-gitlore-text-secondary">
              <p>No matching decisions found. Try different keywords or build the Knowledge Graph from Overview.</p>
              <p>
                <Link to="/overview" className="text-gitlore-accent underline-offset-2 hover:text-gitlore-accent-hover hover:underline">
                  Overview → Build Knowledge Graph
                </Link>{" "}
                to index PR decisions first.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Navbar ── */
const APP_PATHS = ["/app", "/overview", "/patterns", "/repos"];

function UserMenuButton({
  user,
  ghProfile,
  signOut,
}: {
  user: { username: string; avatar_url: string };
  ghProfile: GithubUserProfile | null;
  signOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const avatarSrc = user.avatar_url || ghProfile?.avatar_url || "";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setAvatarBroken(false);
  }, [avatarSrc]);

  const profileHref = ghProfile?.login ? `https://github.com/${ghProfile.login}` : `https://github.com/${user.username}`;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1 rounded-sm border border-gitlore-border bg-gitlore-surface p-0.5 pl-0.5 pr-1 text-gitlore-text transition-colors hover:border-gitlore-accent/40 hover:bg-gitlore-surface-hover"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-gitlore-code">
          {!avatarBroken && avatarSrc ? (
            <img
              src={avatarSrc}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <User className="h-4 w-4 text-gitlore-text-secondary" aria-hidden />
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gitlore-text-secondary transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-[70] mt-1 w-56 rounded-sm border border-gitlore-border bg-gitlore-surface py-1 shadow-lg"
          role="menu"
        >
          <div className="border-b border-gitlore-border px-3 py-2">
            <p className="truncate font-code text-xs text-gitlore-text-secondary">@{user.username}</p>
            {ghProfile?.name ? (
              <p className="truncate text-sm font-medium text-gitlore-text">{ghProfile.name}</p>
            ) : null}
          </div>
          <a
            href={profileHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2 text-sm text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface-hover hover:text-gitlore-text"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            GitHub profile
          </a>
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-gitlore-error transition-colors hover:bg-gitlore-surface-hover"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}

const Navbar = () => {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [ghProfile, setGhProfile] = useState<GithubUserProfile | null>(null);

  useEffect(() => {
    if (!user) {
      setGhProfile(null);
      return;
    }
    let cancelled = false;
    void fetchGithubUserProfile()
      .then((p) => {
        if (!cancelled) setGhProfile(p);
      })
      .catch(() => {
        if (!cancelled) setGhProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    setMobileAvatarBroken(false);
  }, [user?.username, user?.avatar_url]);

  const { repoFull, repoReady } = useRepo();
  const isApp = APP_PATHS.includes(location.pathname);
  const [guardrailsOpen, setGuardrailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileAvatarBroken, setMobileAvatarBroken] = useState(false);

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
      <nav className="sticky top-0 z-50 flex h-14 items-center justify-between gap-2 overflow-visible border-b border-gitlore-border bg-gitlore-bg px-3 md:gap-3 md:px-6">
        <div className="flex min-w-0 items-center gap-3 md:gap-6">
          <Link
            to={user ? "/overview" : "/"}
            className="shrink-0 font-heading text-lg font-bold tracking-tight text-gitlore-accent"
          >
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
              {user ? (
                <Link
                  to="/repos"
                  className={`rounded-sm px-2.5 py-1.5 text-sm transition-colors md:max-lg:px-2 md:max-lg:text-[13px] ${
                    location.pathname === "/repos" ? "text-gitlore-accent" : "text-gitlore-text-secondary hover:text-gitlore-text"
                  }`}
                >
                  Switch repo
                </Link>
              ) : null}
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
          <div className="hidden min-w-0 flex-1 justify-center px-2 md:flex md:max-w-[min(28rem,calc(100vw-22rem))] lg:max-w-xl">
            <SearchBar />
          </div>
        )}

        {/* Desktop actions — Live repo lives in nav links only to avoid duplicate CTAs */}
        <div className="hidden shrink-0 items-center gap-2 md:flex md:gap-2">
          <button
            type="button"
            onClick={() => toggleTheme()}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface-hover hover:text-gitlore-text"
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => setGuardrailsOpen(true)}
            className="rounded-sm border border-gitlore-border px-3 py-1.5 text-sm text-gitlore-text-secondary transition-colors hover:text-gitlore-text md:max-lg:text-[13px]"
          >
            Guardrails
          </button>
          {user ? (
            <UserMenuButton user={user} ghProfile={ghProfile} signOut={signOut} />
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
                    {user ? (
                      <Link
                        to="/repos"
                        className="rounded-sm px-3 py-3 text-sm text-gitlore-text transition-colors hover:bg-gitlore-surface"
                        onClick={() => setMenuOpen(false)}
                      >
                        Switch repo
                      </Link>
                    ) : null}
                  </div>

                  {user && (
                    <div className="border-b border-gitlore-border px-3 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gitlore-border bg-gitlore-code">
                          {!mobileAvatarBroken && (user.avatar_url || ghProfile?.avatar_url) ? (
                            <img
                              src={user.avatar_url || ghProfile?.avatar_url || ""}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={() => setMobileAvatarBroken(true)}
                            />
                          ) : (
                            <User className="h-5 w-5 text-gitlore-text-secondary" aria-hidden />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-code text-xs text-gitlore-text-secondary">@{user.username}</p>
                          {ghProfile?.name ? <p className="truncate text-sm font-medium text-gitlore-text">{ghProfile.name}</p> : null}
                        </div>
                      </div>
                      <a
                        href={ghProfile?.login ? `https://github.com/${ghProfile.login}` : `https://github.com/${user.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-sm border border-gitlore-border bg-gitlore-code/40 py-2.5 text-sm text-gitlore-accent transition-colors hover:border-gitlore-accent/40 hover:bg-gitlore-surface-hover"
                        onClick={() => setMenuOpen(false)}
                      >
                        GitHub profile
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                      </a>
                    </div>
                  )}

                  {isApp && (
                    <div className="border-b border-gitlore-border py-4">
                      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">Search</div>
                      <SearchBar onAfterPick={() => setMenuOpen(false)} />
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        toggleTheme();
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-sm border border-gitlore-border px-3 py-3 text-sm text-gitlore-text transition-colors hover:bg-gitlore-surface"
                    >
                      {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
                      {theme === "dark" ? "Light mode" : "Dark mode"}
                    </button>
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
                    {!user ? (
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
                    ) : null}
                    {user ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          void signOut();
                        }}
                        className="w-full rounded-sm border border-gitlore-border py-3 text-sm text-gitlore-error transition-colors hover:bg-gitlore-surface-hover"
                      >
                        Log out
                      </button>
                    ) : null}
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
