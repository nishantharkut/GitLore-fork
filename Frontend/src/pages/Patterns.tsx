import { useEffect, useState } from "react";
import { FadeIn } from "../components/effects/FadeIn";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import { fetchRepoOverview } from "@/lib/gitloreApi";

/* ── Pattern data ── */
interface Pattern {
  name: string;
  langs: string[];
  anti: string;
  correct: string;
  detected: number;
  maxBar: number;
}

const PATTERNS: Pattern[] = [
  {
    name: "Memory Leak -- useEffect",
    langs: ["JavaScript", "TypeScript"],
    anti: `useEffect(() => {\n  fetch(url).then(r => r.json())\n    .then(setData);\n}, []);`,
    correct: `useEffect(() => {\n  const ctrl = new AbortController();\n  fetch(url, { signal: ctrl.signal })\n    .then(r => r.json()).then(setData);\n  return () => ctrl.abort();\n}, []);`,
    detected: 3,
    maxBar: 20,
  },
  {
    name: "N+1 Query",
    langs: ["Python", "JavaScript"],
    anti: `for user in users:\n  orders = db.query(\n    "SELECT * FROM orders WHERE uid=?", user.id)`,
    correct: `orders = db.query(\n  "SELECT * FROM orders WHERE uid IN (?)",\n  [u.id for u in users])`,
    detected: 8,
    maxBar: 20,
  },
  {
    name: "SQL Injection",
    langs: ["Python", "Java"],
    anti: `query = f"SELECT * FROM users\n  WHERE name = '{name}'"`,
    correct: `cursor.execute(\n  "SELECT * FROM users WHERE name = %s",\n  (name,))`,
    detected: 0,
    maxBar: 20,
  },
  {
    name: "XSS -- innerHTML",
    langs: ["JavaScript", "TypeScript"],
    anti: `el.innerHTML = userInput;`,
    correct: `el.textContent = userInput;\n// or use DOMPurify.sanitize()`,
    detected: 1,
    maxBar: 20,
  },
  {
    name: "Unhandled Promise Rejection",
    langs: ["JavaScript", "TypeScript"],
    anti: `fetch('/api/data')\n  .then(r => r.json())\n  .then(setData);`,
    correct: `fetch('/api/data')\n  .then(r => r.json())\n  .then(setData)\n  .catch(err => setError(err));`,
    detected: 5,
    maxBar: 20,
  },
  {
    name: "Race Condition -- setState",
    langs: ["JavaScript", "TypeScript"],
    anti: `setCount(count + 1);\nsetCount(count + 1);\n// only increments once`,
    correct: `setCount(c => c + 1);\nsetCount(c => c + 1);\n// increments twice`,
    detected: 2,
    maxBar: 20,
  },
  {
    name: "Hardcoded Secrets",
    langs: ["Python", "JavaScript"],
    anti: `API_KEY = "sk-abc123def456"\nheaders = {"Auth": API_KEY}`,
    correct: `API_KEY = os.environ["API_KEY"]\nheaders = {"Auth": API_KEY}`,
    detected: 1,
    maxBar: 20,
  },
  {
    name: "Missing Error Boundary",
    langs: ["TypeScript", "JavaScript"],
    anti: `<App>\n  <UserProfile />\n  <Dashboard />\n</App>`,
    correct: `<App>\n  <ErrorBoundary>\n    <UserProfile />\n  </ErrorBoundary>\n</App>`,
    detected: 4,
    maxBar: 20,
  },
  {
    name: "Stale Closure",
    langs: ["JavaScript", "TypeScript"],
    anti: `useEffect(() => {\n  const id = setInterval(() => {\n    console.log(count); // stale\n  }, 1000);\n}, []);`,
    correct: `useEffect(() => {\n  const id = setInterval(() => {\n    setCount(c => c + 1);\n  }, 1000);\n  return () => clearInterval(id);\n}, []);`,
    detected: 2,
    maxBar: 20,
  },
  {
    name: "God Component",
    langs: ["TypeScript", "JavaScript"],
    anti: `// 500+ line component\nconst Dashboard = () => {\n  // auth, data, UI, state...\n}`,
    correct: `// Split into focused modules\n<AuthGate />\n<DataProvider>\n  <DashboardUI />\n</DataProvider>`,
    detected: 3,
    maxBar: 20,
  },
  { name: "Prop Drilling (3+ levels)", langs: ["TypeScript"], anti: "", correct: "", detected: 2, maxBar: 20 },
  { name: "Mutable State Mutation", langs: ["JavaScript"], anti: "", correct: "", detected: 1, maxBar: 20 },
  { name: "Unbounded List Rendering", langs: ["TypeScript"], anti: "", correct: "", detected: 4, maxBar: 20 },
  { name: "Implicit Any", langs: ["TypeScript"], anti: "", correct: "", detected: 6, maxBar: 20 },
  { name: "Magic Number", langs: ["JavaScript", "Python"], anti: "", correct: "", detected: 7, maxBar: 20 },
  { name: "Deeply Nested Ternary", langs: ["JavaScript"], anti: "", correct: "", detected: 1, maxBar: 20 },
  { name: "Missing Key Prop", langs: ["TypeScript"], anti: "", correct: "", detected: 3, maxBar: 20 },
  { name: "Console.log in Production", langs: ["JavaScript"], anti: "", correct: "", detected: 9, maxBar: 20 },
  { name: "Synchronous localStorage", langs: ["JavaScript"], anti: "", correct: "", detected: 2, maxBar: 20 },
  { name: "Event Listener Leak", langs: ["JavaScript"], anti: "", correct: "", detected: 1, maxBar: 20 },
];

const Patterns = () => {
  const { user } = useAuth();
  const { target, repoFull, repoReady, repoResolving } = useRepo();
  const [search, setSearch] = useState("");
  const [repoPrimaryLang, setRepoPrimaryLang] = useState<string | null>(null);
  const [cachedPatternHits, setCachedPatternHits] = useState(0);

  useEffect(() => {
    if (!user || !repoReady) {
      setRepoPrimaryLang(null);
      setCachedPatternHits(0);
      return;
    }
    let cancelled = false;
    void fetchRepoOverview(target.owner, target.name, target.branch)
      .then((o) => {
        if (cancelled) return;
        setRepoPrimaryLang(o.language || null);
        const hits = (o.topAntiPatterns || []).reduce((s, x) => s + x.count, 0);
        setCachedPatternHits(hits);
      })
      .catch(() => {
        if (!cancelled) {
          setRepoPrimaryLang(null);
          setCachedPatternHits(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, repoReady, target.owner, target.name, target.branch]);

  const filtered = PATTERNS.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  if (user && repoResolving) {
    return (
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center bg-gitlore-bg px-4">
        <p className="text-sm text-gitlore-text-secondary">Loading your most recently updated repository…</p>
      </div>
    );
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
          Reference catalog ({PATTERNS.length} templates). Detection counts in cards are demo defaults; your repo is{" "}
          <span className="font-code text-gitlore-accent">{repoFull || "—"}</span>
          {repoPrimaryLang ? (
            <>
              {" "}
              (primary language: <span className="font-code">{repoPrimaryLang}</span>)
            </>
          ) : null}
          .
        </p>
        {user && cachedPatternHits > 0 && (
          <p className="mb-6 text-xs text-gitlore-text-secondary">
            Cached AI explanations for this repo recorded{" "}
            <span className="font-code text-gitlore-accent">{cachedPatternHits}</span> pattern mentions — see Overview for breakdown.
          </p>
        )}
        {!user && (
          <p className="mb-6 text-xs text-gitlore-text-secondary">Sign in to link stats to your connected repository.</p>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Filter patterns..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-3 py-2 mb-8 text-sm font-body bg-gitlore-code border border-gitlore-border rounded-sm text-gitlore-text placeholder:text-gitlore-text-secondary/50 outline-none focus:border-gitlore-accent transition-colors"
        />

        {/* Grid */}
        <FadeIn direction="up">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {filtered.map((p) => (
              <div key={p.name} className="pattern-card flex flex-col bg-gitlore-surface border border-gitlore-border rounded-sm p-4">
              <div className="text-sm font-heading font-semibold text-gitlore-accent mb-2 leading-snug">
                {p.name}
              </div>

              {/* Lang pills */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {p.langs.map((l) => (
                  <span
                    key={l}
                    className="px-2 py-0.5 text-[10px] font-code text-gitlore-text-secondary bg-gitlore-border/40 rounded-sm"
                  >
                    {l}
                  </span>
                ))}
              </div>

              {p.anti ? (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-gitlore-error/50 font-medium mb-1">
                    Anti-pattern
                  </div>
                  <pre className="p-2 mb-3 text-sm leading-5 md:text-[11px] md:leading-4 font-code bg-gitlore-code border border-gitlore-border rounded-sm text-gitlore-text overflow-x-auto whitespace-pre">
                    {p.anti}
                  </pre>

                  <div className="text-[10px] uppercase tracking-wider text-gitlore-success/50 font-medium mb-1">
                    Correct pattern
                  </div>
                  <pre className="p-2 mb-3 text-sm leading-5 md:text-[11px] md:leading-4 font-code bg-gitlore-code border border-gitlore-border rounded-sm text-gitlore-text overflow-x-auto whitespace-pre">
                    {p.correct}
                  </pre>
                </>
              ) : (
                <div className="flex-1" />
              )}

              {/* Detection bar */}
              <div className="mt-auto pt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gitlore-text-secondary">
                    Detected {p.detected} {p.detected === 1 ? "time" : "times"} in your repo
                  </span>
                </div>
                <progress className="pattern-progress h-1 w-full" value={p.detected} max={p.maxBar} />
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
