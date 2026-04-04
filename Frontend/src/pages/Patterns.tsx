import { useEffect, useState } from "react";
import { FadeIn } from "../components/effects/FadeIn";
import { CenteredLoader, RepoPatternCardsSkeleton, Spinner } from "../components/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import { fetchRepoOverview, type RepoOverviewResponse } from "@/lib/gitloreApi";

/* ── Pattern data ── */
interface ReferencePattern {
  name: string;
  langs: string[];
  anti: string;
  correct: string;
}

/** Static examples only — never shown as “detected in your repo”. */
const REFERENCE_PATTERNS: ReferencePattern[] = [
  {
    name: "Memory Leak -- useEffect",
    langs: ["JavaScript", "TypeScript"],
    anti: `useEffect(() => {\n  fetch(url).then(r => r.json())\n    .then(setData);\n}, []);`,
    correct: `useEffect(() => {\n  const ctrl = new AbortController();\n  fetch(url, { signal: ctrl.signal })\n    .then(r => r.json()).then(setData);\n  return () => ctrl.abort();\n}, []);`,
  },
  {
    name: "N+1 Query",
    langs: ["Python", "JavaScript"],
    anti: `for user in users:\n  orders = db.query(\n    "SELECT * FROM orders WHERE uid=?", user.id)`,
    correct: `orders = db.query(\n  "SELECT * FROM orders WHERE uid IN (?)",\n  [u.id for u in users])`,
  },
  {
    name: "SQL Injection",
    langs: ["Python", "Java"],
    anti: `query = f"SELECT * FROM users\n  WHERE name = '{name}'"`,
    correct: `cursor.execute(\n  "SELECT * FROM users WHERE name = %s",\n  (name,))`,
  },
  {
    name: "XSS -- innerHTML",
    langs: ["JavaScript", "TypeScript"],
    anti: `el.innerHTML = userInput;`,
    correct: `el.textContent = userInput;\n// or use DOMPurify.sanitize()`,
  },
  {
    name: "Unhandled Promise Rejection",
    langs: ["JavaScript", "TypeScript"],
    anti: `fetch('/api/data')\n  .then(r => r.json())\n  .then(setData);`,
    correct: `fetch('/api/data')\n  .then(r => r.json())\n  .then(setData)\n  .catch(err => setError(err));`,
  },
  {
    name: "Race Condition -- setState",
    langs: ["JavaScript", "TypeScript"],
    anti: `setCount(count + 1);\nsetCount(count + 1);\n// only increments once`,
    correct: `setCount(c => c + 1);\nsetCount(c => c + 1);\n// increments twice`,
  },
  {
    name: "Hardcoded Secrets",
    langs: ["Python", "JavaScript"],
    anti: `API_KEY = "sk-abc123def456"\nheaders = {"Auth": API_KEY}`,
    correct: `API_KEY = os.environ["API_KEY"]\nheaders = {"Auth": API_KEY}`,
  },
  {
    name: "Missing Error Boundary",
    langs: ["TypeScript", "JavaScript"],
    anti: `<App>\n  <UserProfile />\n  <Dashboard />\n</App>`,
    correct: `<App>\n  <ErrorBoundary>\n    <UserProfile />\n  </ErrorBoundary>\n</App>`,
  },
  {
    name: "Stale Closure",
    langs: ["JavaScript", "TypeScript"],
    anti: `useEffect(() => {\n  const id = setInterval(() => {\n    console.log(count); // stale\n  }, 1000);\n}, []);`,
    correct: `useEffect(() => {\n  const id = setInterval(() => {\n    setCount(c => c + 1);\n  }, 1000);\n  return () => clearInterval(id);\n}, []);`,
  },
  {
    name: "God Component",
    langs: ["TypeScript", "JavaScript"],
    anti: `// 500+ line component\nconst Dashboard = () => {\n  // auth, data, UI, state...\n}`,
    correct: `// Split into focused modules\n<AuthGate />\n<DataProvider>\n  <DashboardUI />\n</DataProvider>`,
  },
  { name: "Prop Drilling (3+ levels)", langs: ["TypeScript"], anti: "", correct: "" },
  { name: "Mutable State Mutation", langs: ["JavaScript"], anti: "", correct: "" },
  { name: "Unbounded List Rendering", langs: ["TypeScript"], anti: "", correct: "" },
  { name: "Implicit Any", langs: ["TypeScript"], anti: "", correct: "" },
  { name: "Magic Number", langs: ["JavaScript", "Python"], anti: "", correct: "" },
  { name: "Deeply Nested Ternary", langs: ["JavaScript"], anti: "", correct: "" },
  { name: "Missing Key Prop", langs: ["TypeScript"], anti: "", correct: "" },
  { name: "Console.log in Production", langs: ["JavaScript"], anti: "", correct: "" },
  { name: "Synchronous localStorage", langs: ["JavaScript"], anti: "", correct: "" },
  { name: "Event Listener Leak", langs: ["JavaScript"], anti: "", correct: "" },
];

const Patterns = () => {
  const { user } = useAuth();
  const { target, repoFull, repoReady, repoResolving } = useRepo();
  const [refSearch, setRefSearch] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [overview, setOverview] = useState<RepoOverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  useEffect(() => {
    if (!user || !repoReady) {
      setOverview(null);
      setOverviewLoading(false);
      return;
    }
    let cancelled = false;
    setOverviewLoading(true);
    void fetchRepoOverview(target.owner, target.name, target.branch)
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch(() => {
        if (!cancelled) setOverview(null);
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, repoReady, target.owner, target.name, target.branch]);

  const repoPrimaryLang = overview?.language ?? null;
  const topAnti = overview?.topAntiPatterns ?? [];
  const cachedPatternHits = topAnti.reduce((s, x) => s + x.count, 0);

  const filteredRef = REFERENCE_PATTERNS.filter((p) =>
    p.name.toLowerCase().includes(refSearch.toLowerCase())
  );
  const filteredRepoAnti = topAnti.filter((item) =>
    item.text.toLowerCase().includes(repoSearch.toLowerCase())
  );

  if (user && repoResolving) {
    return <CenteredLoader message="Loading your most recently updated repository…" />;
  }

  if (user && !repoReady) {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg px-4 py-12">
        <div className="mx-auto max-w-[1200px] text-center md:px-8 md:py-12">
          <h1 className="mb-2 font-heading text-2xl font-bold text-gitlore-text">Pattern Library</h1>
          <p className="text-sm text-gitlore-text-secondary">
            Select a repository with the <span className="text-gitlore-text">Repositories</span> search in the header to tie language stats and cached hits to a live repo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 md:py-12">
        <h1 className="text-2xl font-heading font-bold text-gitlore-text mb-1">
          Pattern Library
        </h1>
        <p className="text-sm text-gitlore-text-secondary mb-2">
          Repo{" "}
          <span className="font-code text-gitlore-accent">{repoFull || "—"}</span>
          {repoPrimaryLang ? (
            <>
              {" "}
              · primary language <span className="font-code">{repoPrimaryLang}</span>
            </>
          ) : null}
          . Counts under &ldquo;This repository&rdquo; come only from cached explanations you ran in Live repo; the catalog below is reference material, not a scanner.
        </p>
        {user && cachedPatternHits > 0 && (
          <p className="mb-4 text-xs text-gitlore-text-secondary">
            Cached pattern mentions for this repo:{" "}
            <span className="font-code text-gitlore-accent">{cachedPatternHits}</span> (same data as Overview).
          </p>
        )}
        {!user && (
          <p className="mb-6 text-xs text-gitlore-text-secondary">Sign in to load repository-backed pattern stats.</p>
        )}

        <div className="mb-10">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
              This repository (from cached reviews)
            </div>
            {overviewLoading && (
              <span className="flex items-center gap-1.5 text-xs text-gitlore-text-secondary" role="status">
                <Spinner className="h-3.5 w-3.5" label="Loading repository patterns" />
                Loading…
              </span>
            )}
          </div>
          <input
            type="text"
            placeholder="Filter detected themes…"
            value={repoSearch}
            onChange={(e) => setRepoSearch(e.target.value)}
            className="mb-4 w-full max-w-md rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-sm font-body text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent"
          />
          <FadeIn direction="up">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {overviewLoading && <RepoPatternCardsSkeleton />}
              {!overviewLoading && filteredRepoAnti.length === 0 && (
                <p className="col-span-full text-sm text-gitlore-text-secondary">
                  No cached pattern themes yet. Use <span className="text-gitlore-text">Explain</span> on PR review comments or line analyze in Live repo; results aggregate here.
                </p>
              )}
              {!overviewLoading &&
                filteredRepoAnti.map((item) => (
                <div
                  key={item.text}
                  className="flex flex-col rounded-sm border border-gitlore-border bg-gitlore-surface p-4"
                >
                  <div className="mb-2 flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
                    <span className="text-sm font-medium text-gitlore-text">{item.text}</span>
                  </div>
                  <div className="mt-auto font-code text-xs text-gitlore-text-secondary">
                    Recorded <span className="text-gitlore-accent">{item.count}</span>{" "}
                    {item.count === 1 ? "time" : "times"} in stored explanations
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>

        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
          Reference catalog ({REFERENCE_PATTERNS.length} examples)
        </div>
        <input
          type="text"
          placeholder="Filter reference examples…"
          value={refSearch}
          onChange={(e) => setRefSearch(e.target.value)}
          className="mb-6 w-full max-w-md rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-sm font-body text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent"
        />

        <FadeIn direction="up">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {filteredRef.map((p) => (
              <div key={p.name} className="pattern-card flex flex-col rounded-sm border border-gitlore-border bg-gitlore-surface p-4">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  Reference
                </div>
                <div className="mb-2 text-sm font-heading font-semibold leading-snug text-gitlore-accent">{p.name}</div>

                <div className="mb-3 flex flex-wrap gap-1.5">
                  {p.langs.map((l) => (
                    <span
                      key={l}
                      className="rounded-sm bg-gitlore-border/40 px-2 py-0.5 font-code text-[10px] text-gitlore-text-secondary"
                    >
                      {l}
                    </span>
                  ))}
                </div>

                {p.anti ? (
                  <>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gitlore-error/50">Anti-pattern</div>
                    <pre className="mb-3 overflow-x-auto whitespace-pre rounded-sm border border-gitlore-border bg-gitlore-code p-2 font-code text-sm leading-5 text-gitlore-text md:text-[11px] md:leading-4">
                      {p.anti}
                    </pre>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gitlore-success/50">Better pattern</div>
                    <pre className="mb-3 overflow-x-auto whitespace-pre rounded-sm border border-gitlore-border bg-gitlore-code p-2 font-code text-sm leading-5 text-gitlore-text md:text-[11px] md:leading-4">
                      {p.correct}
                    </pre>
                  </>
                ) : (
                  <div className="flex-1" />
                )}

                <div className="mt-auto border-t border-gitlore-border/60 pt-3 text-[10px] leading-snug text-gitlore-text-secondary">
                  Not derived from your repository — for learning only.
                </div>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </div>
  );
};

export default Patterns;
