import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FadeIn } from "../components/effects/FadeIn";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import {
  fetchRepoOverview,
  fetchRepoPatternInsights,
  type RepoOverviewResponse,
  type RepoPatternInsightsResponse,
} from "@/lib/gitloreApi";

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
];

function dotClass(i: number) {
  return i % 3 === 0 ? "bg-gitlore-error" : i % 3 === 1 ? "bg-gitlore-warning" : "bg-gitlore-success";
}

const Patterns = () => {
  const { user } = useAuth();
  const { target, repoFull, repoReady } = useRepo();
  const [refSearch, setRefSearch] = useState("");
  const [kgSearch, setKgSearch] = useState("");
  const [explainSearch, setExplainSearch] = useState("");
  const [lineSearch, setLineSearch] = useState("");
  const [overview, setOverview] = useState<RepoOverviewResponse | null>(null);
  const [insights, setInsights] = useState<RepoPatternInsightsResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(false);

  useEffect(() => {
    if (!user || !repoReady) {
      setOverview(null);
      setInsights(null);
      setPageLoading(false);
      return;
    }
    let cancelled = false;
    setPageLoading(true);
    void Promise.all([
      fetchRepoOverview(target.owner, target.name, target.branch),
      fetchRepoPatternInsights(target.owner, target.name),
    ])
      .then(([o, p]) => {
        if (!cancelled) {
          setOverview(o);
          setInsights(p);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOverview(null);
          setInsights(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, repoReady, target.owner, target.name, target.branch]);

  const repoPrimaryLang = overview?.language ?? null;
  const kg = insights?.knowledgeGraph;
  const ex = insights?.explain;
  const line = insights?.lineAnalyze;

  const q = (s: string) => s.toLowerCase();
  const filteredKgTypes =
    kg?.byType.filter((x) => q(x.text).includes(q(kgSearch))) ?? [];
  const filteredKgTopics =
    kg?.topTopics.filter((x) => q(x.text).includes(q(kgSearch))) ?? [];
  const filteredExplain =
    ex?.labels.filter((x) => q(x.text).includes(q(explainSearch))) ?? [];
  const filteredFiles =
    line?.topFiles.filter((x) => q(x.path).includes(q(lineSearch))) ?? [];

  const conf = line?.byConfidence;
  const confTotal = conf ? Math.max(1, conf.high + conf.medium + conf.low) : 1;

  const filteredRef = REFERENCE_PATTERNS.filter((p) =>
    p.name.toLowerCase().includes(refSearch.toLowerCase())
  );

  if (user && !repoReady) {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg px-4 py-12">
        <div className="mx-auto max-w-[1200px] text-center md:px-8 md:py-12">
          <h1 className="mb-2 font-heading text-2xl font-bold text-gitlore-text">Patterns & themes</h1>
          <p className="text-sm text-gitlore-text-secondary">

            Select a repository from the header to see knowledge-graph themes, explain labels, and line-analysis
            activity for that repo.

            Select a repository on the{" "}
            <Link to="/repos" className="text-gitlore-accent hover:text-gitlore-accent-hover">
              repo picker
            </Link>{" "}
            or via the <span className="text-gitlore-text">Repositories</span> search in the header.

          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg">
      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-12">
        <h1 className="mb-1 font-heading text-2xl font-bold text-gitlore-text">Patterns & themes</h1>
        <p className="text-sm text-gitlore-text-secondary">
          Repo <span className="font-code text-gitlore-accent">{repoFull || "—"}</span>
          {repoPrimaryLang ? (
            <>
              {" "}
              · primary language <span className="font-code">{repoPrimaryLang}</span>
            </>
          ) : null}
        </p>

        <div className="mb-6 mt-4 rounded-sm border border-gitlore-border/80 bg-gitlore-surface/60 px-4 py-3 text-xs leading-relaxed text-gitlore-text-secondary">
          <p className="font-medium text-gitlore-text/90">What you are looking at</p>
          <p className="mt-1.5">
          Three <span className="text-gitlore-text/90">repo-specific</span> signals below: (1) merged-PR knowledge
          graph (types & topics from ingest), (2) labels from cached <span className="font-code text-[11px]">Explain</span>{" "}
          on PR comments, (3) cached <span className="font-code text-[11px]">Analyze line</span> narratives (files +
          confidence). At the bottom: <span className="text-gitlore-text/90">ten</span> curated reference snippets
          (memory leak, N+1, XSS, …) — not from your repo.
          </p>
        </div>

        {!user && (
          <p className="mb-6 text-xs text-gitlore-text-secondary">Sign in to load repository data.</p>
        )}


        {user && (
          <>
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-sm border border-gitlore-border bg-gitlore-surface p-4">
                <div className="text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  Knowledge graph
                </div>
                <div className="mt-1 font-heading text-2xl font-semibold text-gitlore-accent">
                  {pageLoading ? "…" : kg?.prNodeCount ?? 0}
                </div>
                <div className="mt-1 text-xs text-gitlore-text-secondary">Indexed merged PR decisions</div>
              </div>
              <div className="rounded-sm border border-gitlore-border bg-gitlore-surface p-4">
                <div className="text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  PR explanations
                </div>
                <div className="mt-1 font-heading text-2xl font-semibold text-gitlore-accent">
                  {pageLoading ? "…" : ex?.rowCount ?? 0}
                </div>
                <div className="mt-1 text-xs text-gitlore-text-secondary">Cached Explain rows (up to 500 scanned)</div>
              </div>
              <div className="rounded-sm border border-gitlore-border bg-gitlore-surface p-4">
                <div className="text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  Line analysis
                </div>
                <div className="mt-1 font-heading text-2xl font-semibold text-gitlore-accent">
                  {pageLoading ? "…" : line?.cachedCount ?? 0}
                </div>
                <div className="mt-1 text-xs text-gitlore-text-secondary">Cached Analyze narratives (up to 800 scanned)</div>
              </div>
            </div>

            <div className="mb-10 flex flex-wrap gap-2 text-xs">
              <Link
                to="/overview"
                className="rounded-sm border border-gitlore-accent/40 bg-gitlore-accent/10 px-3 py-1.5 font-medium text-gitlore-accent transition-colors hover:bg-gitlore-accent/20"
              >
                Overview — build knowledge graph
              </Link>
              <Link
                to="/app"
                className="rounded-sm border border-gitlore-border px-3 py-1.5 text-gitlore-text-secondary transition-colors hover:border-gitlore-accent/50 hover:text-gitlore-text"
              >
                Live repo — Explain comments &amp; Analyze lines
              </Link>
            </div>

            {/* Knowledge graph */}
            <div className="mb-10">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
                    From knowledge graph (ingested PRs)
                  </div>
                  <p className="mt-1 max-w-2xl text-xs text-gitlore-text-secondary/90">
                    Decision types and extracted topics across indexed PRs. Run <span className="text-gitlore-text">Build Knowledge Graph</span> on Overview if this is empty.
                  </p>
                </div>
                {pageLoading && <span className="text-xs text-gitlore-text-secondary">Loading…</span>}
              </div>
              <input
                type="text"
                placeholder="Filter types and topics…"
                value={kgSearch}
                onChange={(e) => setKgSearch(e.target.value)}
                className="mb-4 w-full max-w-md rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-sm font-body text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent"
              />
              <FadeIn direction="up">
                {!pageLoading && kg && kg.prNodeCount === 0 && (
                  <p className="mb-4 text-sm text-gitlore-text-secondary">
                    No graph nodes yet. Open <Link to="/overview" className="text-gitlore-accent underline-offset-2 hover:underline">Overview</Link> and run{" "}
                    <span className="text-gitlore-text">Build Knowledge Graph</span> to populate themes from merged PRs.
                  </p>
                )}
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {filteredKgTypes.map((item, i) => (
                    <div
                      key={`t-${item.text}`}
                      className="flex flex-col rounded-sm border border-gitlore-border bg-gitlore-surface p-4"
                    >
                      <div className="mb-2 flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(i)}`} />
                        <span className="text-sm font-medium capitalize text-gitlore-text">{item.text}</span>
                      </div>
                      <div className="mt-auto font-code text-xs text-gitlore-text-secondary">
                        <span className="text-gitlore-accent">{item.count}</span> PR{item.count === 1 ? "" : "s"}
                      </div>
                    </div>
                  ))}
                </div>
                {filteredKgTopics.length > 0 && (
                  <>
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                      Topics
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {filteredKgTopics.map((item) => (
                        <span
                          key={item.text}
                          className="inline-flex items-center gap-1.5 rounded-sm border border-gitlore-border/80 bg-gitlore-code px-2.5 py-1 font-code text-[11px] text-gitlore-text"
                        >
                          {item.text}
                          <span className="text-gitlore-accent">×{item.count}</span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {!pageLoading &&
                  kg &&
                  kg.prNodeCount > 0 &&
                  filteredKgTypes.length === 0 &&
                  filteredKgTopics.length === 0 && (
                    <p className="text-sm text-gitlore-text-secondary">No types or topics match this filter.</p>
                  )}
              </FadeIn>
            </div>

            {/* Explain */}
            <div className="mb-10">
              <div className="mb-2">
                <div className="text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  From PR review explanations
                </div>
                <p className="mt-1 max-w-2xl text-xs text-gitlore-text-secondary/90">
                  Pattern names from Gemini (or regex slugs) stored when you run <span className="text-gitlore-text">Explain</span> on review comments in Live repo.
                </p>
              </div>
              <input
                type="text"
                placeholder="Filter explain pattern labels…"
                value={explainSearch}
                onChange={(e) => setExplainSearch(e.target.value)}
                className="mb-4 w-full max-w-md rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-sm font-body text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent"
              />
              <FadeIn direction="up">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {!pageLoading && filteredExplain.length === 0 && (
                    <p className="col-span-full text-sm text-gitlore-text-secondary">
                      {(ex?.rowCount ?? 0) === 0 ? (
                        <>
                          No cached explain labels yet. Open a PR in{" "}
                          <Link to="/app" className="text-gitlore-accent underline-offset-2 hover:underline">
                            Live repo
                          </Link>{" "}
                          and run Explain on comments to build this list.
                        </>
                      ) : (
                        <>No labels match this filter.</>
                      )}
                    </p>
                  )}
                  {filteredExplain.map((item, i) => (
                    <div
                      key={item.text}
                      className="flex flex-col rounded-sm border border-gitlore-border bg-gitlore-surface p-4"
                    >
                      <div className="mb-2 flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(i)}`} />
                        <span className="text-sm font-medium text-gitlore-text">{item.text}</span>
                      </div>
                      <div className="mt-auto font-code text-xs text-gitlore-text-secondary">
                        <span className="text-gitlore-accent">{item.count}</span>{" "}
                        {item.count === 1 ? "cached explanation" : "cached explanations"}
                      </div>
                    </div>
                  ))}
                </div>
              </FadeIn>
            </div>

            {/* Line analyze */}
            <div className="mb-10">
              <div className="mb-2">
                <div className="text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  From line analysis
                </div>
                <p className="mt-1 max-w-2xl text-xs text-gitlore-text-secondary/90">
                  Where you have used <span className="text-gitlore-text">Analyze</span> on a line in Live repo, we show confidence mix and the files you investigated most.
                </p>
              </div>
              {!pageLoading && line && line.cachedCount > 0 && conf && (
                <div className="mb-4 max-w-md">
                  <div className="mb-1 flex justify-between text-[10px] text-gitlore-text-secondary">
                    <span>Confidence (cached narratives)</span>
                    <span>
                      H {conf.high} · M {conf.medium} · L {conf.low}
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-sm bg-gitlore-border/40">
                    <div
                      className="bg-emerald-500/90"
                      style={{ width: `${(conf.high / confTotal) * 100}%` }}
                      title="high"
                    />
                    <div
                      className="bg-amber-500/90"
                      style={{ width: `${(conf.medium / confTotal) * 100}%` }}
                      title="medium"
                    />
                    <div
                      className="bg-gitlore-text-secondary/50"
                      style={{ width: `${(conf.low / confTotal) * 100}%` }}
                      title="low"
                    />
                  </div>
                </div>
              )}
              <input
                type="text"
                placeholder="Filter file paths…"
                value={lineSearch}
                onChange={(e) => setLineSearch(e.target.value)}
                className="mb-4 w-full max-w-md rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-sm font-body text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent"
              />
              <FadeIn direction="up">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {!pageLoading && line && line.cachedCount === 0 && (
                    <p className="col-span-full text-sm text-gitlore-text-secondary">
                      No line narratives cached yet. In{" "}
                      <Link to="/app" className="text-gitlore-accent underline-offset-2 hover:underline">
                        Live repo
                      </Link>
                      , pick a file and run Analyze on a line.
                    </p>
                  )}
                  {filteredFiles.map((f) => (
                    <div
                      key={f.path}
                      className="flex items-center justify-between gap-2 rounded-sm border border-gitlore-border bg-gitlore-surface px-3 py-2 font-code text-xs text-gitlore-text"
                    >
                      <span className="min-w-0 truncate" title={f.path}>
                        {f.path}
                      </span>
                      <span className="shrink-0 text-gitlore-accent">×{f.count}</span>
                    </div>
                  ))}
                </div>
                {!pageLoading &&
                  line &&
                  line.cachedCount > 0 &&
                  filteredFiles.length === 0 &&
                  lineSearch.trim() && (
                    <p className="text-sm text-gitlore-text-secondary">No files match this filter.</p>
                  )}
              </FadeIn>
            </div>
          </>
        )}

        <div className="mb-10 border-t border-gitlore-border/70 pt-10">
          <h2 className="mb-1 font-heading text-lg font-semibold text-gitlore-text">Reference examples</h2>
          <p className="mb-4 max-w-2xl text-xs text-gitlore-text-secondary">
            Curated anti-pattern vs better-pattern snippets (memory leaks, N+1, XSS, SQLi, etc.). These are not scanned
            from your repository — use them while reviewing or learning.
          </p>
          <input
            type="text"
            placeholder="Filter by name (e.g. memory, SQL)…"
            value={refSearch}
            onChange={(e) => setRefSearch(e.target.value)}
            className="mb-6 w-full max-w-md rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-sm font-body text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent"
          />
          <FadeIn direction="up">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredRef.map((p) => (
                <div
                  key={p.name}
                  className="pattern-card flex flex-col rounded-sm border border-gitlore-border bg-gitlore-surface p-4"
                >
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                    Reference
                  </div>
                  <div className="mb-2 font-heading text-sm font-semibold leading-snug text-gitlore-accent">{p.name}</div>
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
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gitlore-error/50">
                    Anti-pattern
                  </div>
                  <pre className="mb-3 overflow-x-auto whitespace-pre rounded-sm border border-gitlore-border bg-gitlore-code p-2 font-code text-sm leading-5 text-gitlore-text md:text-[11px] md:leading-4">
                    {p.anti}
                  </pre>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gitlore-success/50">
                    Better pattern
                  </div>
                  <pre className="mb-3 overflow-x-auto whitespace-pre rounded-sm border border-gitlore-border bg-gitlore-code p-2 font-code text-sm leading-5 text-gitlore-text md:text-[11px] md:leading-4">
                    {p.correct}
                  </pre>
                  <div className="mt-auto border-t border-gitlore-border/60 pt-3 text-[10px] leading-snug text-gitlore-text-secondary">
                    Not derived from your repository — for learning only.
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </div>
    </div>
  );
};

export default Patterns;
