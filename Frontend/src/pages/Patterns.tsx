import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FadeIn } from "../components/effects/FadeIn";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import {
  fetchRepoOverview,
  fetchRepoPatternInsights,
  fetchRepoPatternScan,
  type RepoOverviewResponse,
  type RepoPatternInsightsResponse,
  type RepoPatternScanResponse,
} from "@/lib/gitloreApi";
import {
  REFERENCE_PATTERNS,
  type ReferenceCategory,
  type ReferencePattern,
  type ReferenceSeverity,
} from "@/data/referencePatterns";

const CATEGORY_ORDER: Record<ReferenceCategory, number> = {
  security: 0,
  performance: 1,
  reliability: 2,
  maintainability: 3,
};

const SEVERITY_ORDER: Record<ReferenceSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CATEGORY_LABELS: ReferenceCategory[] = [
  "security",
  "performance",
  "reliability",
  "maintainability",
];

/** Collapsed churn list: fixed visual height + preview rows; expand for full scrollable list. */
const CHURN_PREVIEW_COUNT = 3;
const CHURN_COLLAPSED_HEIGHT_CLASS = "h-52";

function dotClass(i: number) {
  return i % 3 === 0 ? "bg-gitlore-error" : i % 3 === 1 ? "bg-gitlore-warning" : "bg-gitlore-success";
}

function severityDotClass(s: ReferenceSeverity) {
  if (s === "critical") return "bg-red-500";
  if (s === "high") return "bg-orange-500";
  if (s === "medium") return "bg-amber-500";
  return "bg-gray-400";
}

function severityBadgeClass(s: ReferenceSeverity) {
  if (s === "critical") return "border-red-500/50 bg-red-500/10 text-red-400";
  if (s === "high") return "border-orange-500/50 bg-orange-500/10 text-orange-400";
  if (s === "medium") return "border-amber-500/50 bg-amber-500/10 text-amber-400";
  return "border-gitlore-border bg-gitlore-border/30 text-gitlore-text-secondary";
}

function matchesRepoLang(p: ReferencePattern, primary: string | null): boolean {
  if (!primary) return false;
  const pl = primary.toLowerCase();
  return p.langs.some((l) => l.toLowerCase() === pl);
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
  const [scan, setScan] = useState<RepoPatternScanResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<ReferenceCategory>>(new Set());
  const [langOnly, setLangOnly] = useState(false);
  const [churnExpanded, setChurnExpanded] = useState(false);

  const toggleCategory = (c: ReferenceCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const clearCategories = () => setActiveCategories(new Set());

  useEffect(() => {
    if (!user || !repoReady) {
      setOverview(null);
      setInsights(null);
      setScan(null);
      setPageLoading(false);
      setScanError(null);
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

  useEffect(() => {
    setChurnExpanded(false);
  }, [repoFull]);

  const loadScan = useCallback(
    async (refresh: boolean) => {
      if (!user || !repoReady) return;
      setScanLoading(true);
      setScanError(null);
      try {
        const data = await fetchRepoPatternScan(target.owner, target.name, {
          branch: target.branch,
          refresh,
        });
        setScan(data);
      } catch (e) {
        setScan(null);
        setScanError(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setScanLoading(false);
      }
    },
    [user, repoReady, target.owner, target.name, target.branch]
  );

  useEffect(() => {
    if (!user || !repoReady) {
      setScan(null);
      setScanError(null);
      return;
    }
    void loadScan(false);
  }, [user, repoReady, target.owner, target.name, target.branch, loadScan]);

  const repoPrimaryLang = overview?.language ?? null;
  const kg = insights?.knowledgeGraph;
  const ex = insights?.explain;
  const line = insights?.lineAnalyze;
  const churn = insights?.churnHotspots ?? [];
  const oscillations = insights?.decisionOscillations ?? [];
  const timeline = insights?.decisionTimeline ?? [];

  const detectedScanIds = useMemo(() => {
    const s = new Set<string>();
    for (const row of scan?.patterns ?? []) s.add(row.patternId);
    return s;
  }, [scan]);

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

  const filteredSortedRef = useMemo(() => {
    const needle = refSearch.toLowerCase().trim();
    let list = REFERENCE_PATTERNS.filter((p) => {
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      if (activeCategories.size > 0 && !activeCategories.has(p.category)) return false;
      if (langOnly && !matchesRepoLang(p, repoPrimaryLang)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const ma = matchesRepoLang(a, repoPrimaryLang) ? 0 : 1;
      const mb = matchesRepoLang(b, repoPrimaryLang) ? 0 : 1;
      if (ma !== mb) return ma - mb;
      const ca = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
      if (ca !== 0) return ca;
      const sa = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sa !== 0) return sa;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [refSearch, activeCategories, langOnly, repoPrimaryLang]);

  const cardDetected = (p: ReferencePattern) =>
    (p.scanIds ?? []).some((id) => detectedScanIds.has(id));

  if (user && !repoReady) {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg px-4 py-12">
        <div className="mx-auto max-w-[1200px] text-center md:px-8 md:py-12">
          <h1 className="mb-2 font-heading text-2xl font-bold text-gitlore-text">Patterns & themes</h1>
          <p className="text-sm text-gitlore-text-secondary">
            Select a repository from the header to see knowledge-graph themes, explain labels, line-analysis activity, code
            scan results, and reference snippets for that repo.
          </p>
          <p className="mt-3 text-sm text-gitlore-text-secondary">
            Use the{" "}
            <Link to="/repos" className="text-gitlore-accent hover:text-gitlore-accent-hover">
              repo picker
            </Link>{" "}
            or the <span className="text-gitlore-text">Repositories</span> search in the header.
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
            <span className="text-gitlore-text/90">Repo-specific</span> data comes from Mongo (ingested PRs, cached Explain
            labels, Analyze-line narratives) plus a lightweight <span className="text-gitlore-text/90">code scan</span> of up
            to 50 text files on the branch you selected in the header. Churn hotspots and decision timelines are derived
            from knowledge-graph nodes. At the bottom, <span className="text-gitlore-text/90">reference cards</span> are
            curated examples — they light up with a gold border when the scan finds a matching rule id in your tree.
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
                    Decision types and extracted topics across indexed PRs. Run{" "}
                    <span className="text-gitlore-text">Build Knowledge Graph</span> on Overview if this is empty.
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
                    No graph nodes yet. Open{" "}
                    <Link to="/overview" className="text-gitlore-accent underline-offset-2 hover:underline">
                      Overview
                    </Link>{" "}
                    and run <span className="text-gitlore-text">Build Knowledge Graph</span> to populate themes from merged
                    PRs.
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

            {/* Churn + timeline + oscillations */}
            <div className="mb-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  Churn hotspots (files in many PRs)
                </div>
                <p className="mt-1 max-w-xl text-xs text-gitlore-text-secondary/90">
                  Paths that appear in <span className="text-gitlore-text">changed_files</span> on multiple ingested PRs —
                  good candidates for refactors or ownership discussion.
                </p>
                <FadeIn direction="up">
                  {!pageLoading && churn.length === 0 && (
                    <p className="mt-3 text-sm text-gitlore-text-secondary">
                      No hotspots yet (need at least two PRs touching the same file in the graph).
                    </p>
                  )}
                  {churn.length > 0 && (
                    <>
                      <div
                        className={`mt-3 rounded-sm border border-gitlore-border/60 bg-gitlore-surface/40 p-2 ${
                          churnExpanded ? "max-h-72 overflow-y-auto" : `${CHURN_COLLAPSED_HEIGHT_CLASS} overflow-y-auto overflow-x-hidden`
                        }`}
                      >
                        <ul className="space-y-2">
                          {(churnExpanded ? churn : churn.slice(0, CHURN_PREVIEW_COUNT)).map((h) => (
                            <li
                              key={h.file}
                              className="rounded-sm border border-gitlore-border bg-gitlore-surface px-3 py-2 text-xs text-gitlore-text"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Link
                                  to="/app"
                                  state={{ file: h.file }}
                                  className="min-w-0 truncate font-code text-gitlore-accent hover:underline"
                                  title={h.file}
                                >
                                  {h.file}
                                </Link>
                                <span className="shrink-0 text-gitlore-text-secondary">
                                  {h.prCount} PRs · {h.types.join(", ") || "—"}
                                </span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-gitlore-text-secondary">
                                {h.prs.slice(0, 6).map((p) => (
                                  <span key={`${h.file}-${p.number}`} className="rounded-sm bg-gitlore-code px-1.5 py-0.5">
                                    #{p.number} {p.type}
                                  </span>
                                ))}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {churn.length > CHURN_PREVIEW_COUNT && (
                        <button
                          type="button"
                          onClick={() => setChurnExpanded((v) => !v)}
                          className="mt-2 text-xs font-medium text-gitlore-accent hover:text-gitlore-accent-hover hover:underline"
                        >
                          {churnExpanded
                            ? "Show less"
                            : `Show more (${churn.length - CHURN_PREVIEW_COUNT} more)`}
                        </button>
                      )}
                    </>
                  )}
                </FadeIn>
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  Decision timeline (by month)
                </div>
                <p className="mt-1 max-w-xl text-xs text-gitlore-text-secondary/90">
                  Count of knowledge nodes with a <span className="text-gitlore-text">merged_at</span> in each month.
                </p>
                <FadeIn direction="up">
                  {!pageLoading && timeline.length === 0 && (
                    <p className="mt-3 text-sm text-gitlore-text-secondary">No dated nodes in the graph yet.</p>
                  )}
                  <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                    {timeline.map((t) => (
                      <li
                        key={t.month}
                        className="flex items-center justify-between gap-2 rounded-sm border border-gitlore-border/80 bg-gitlore-surface px-3 py-2 font-code text-[11px] text-gitlore-text"
                      >
                        <span>{t.month}</span>
                        <span className="text-gitlore-accent">{t.count}</span>
                        <span className="max-w-[180px] truncate text-gitlore-text-secondary" title={JSON.stringify(t.types)}>
                          {Object.entries(t.types)
                            .map(([k, v]) => `${k}:${v}`)
                            .join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </FadeIn>
              </div>
            </div>

            {oscillations.length > 0 && (
              <div className="mb-10">
                <div className="text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  Possible decision shifts (heuristic)
                </div>
                <p className="mt-1 max-w-2xl text-xs text-gitlore-text-secondary/90">
                  Later PR decisions that share terms with earlier listed alternatives — not proof of reversal, but a cue
                  to read both threads.
                </p>
                <FadeIn direction="up">
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {oscillations.map((o, idx) => (
                      <div
                        key={`${o.earlier.pr_number}-${o.later.pr_number}-${idx}`}
                        className="rounded-sm border border-gitlore-border bg-gitlore-surface p-4 text-xs"
                      >
                        <div className="mb-2 font-code text-[10px] text-gitlore-text-secondary">
                          PR #{o.earlier.pr_number} → #{o.later.pr_number}
                        </div>
                        <p className="mb-1 line-clamp-2 text-gitlore-text-secondary">{o.earlier.title}</p>
                        <p className="mb-2 line-clamp-2 text-gitlore-text-secondary">{o.later.title}</p>
                        <div className="flex flex-wrap gap-1">
                          {o.sharedTerms.map((w) => (
                            <span key={w} className="rounded-sm bg-gitlore-code px-1.5 py-0.5 font-code text-[10px]">
                              {w}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </FadeIn>
              </div>
            )}

            {/* Code scan */}
            <div className="mb-10">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
                    Code scan (regex, sampled files)
                  </div>
                  <p className="mt-1 max-w-2xl text-xs text-gitlore-text-secondary/90">
                    Server scans up to 50 small text files (skips <span className="font-code text-[11px]">node_modules</span>
                    , locks, etc.). Results cache for about an hour per repo and branch query.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={scanLoading}
                  onClick={() => void loadScan(true)}
                  className="rounded-sm border border-gitlore-accent/50 bg-gitlore-accent/10 px-3 py-1.5 text-xs font-medium text-gitlore-accent transition-colors hover:bg-gitlore-accent/20 disabled:opacity-50"
                >
                  {scanLoading ? "Scanning…" : "Re-scan"}
                </button>
              </div>
              {scanError && (
                <p className="mb-3 text-sm text-gitlore-error">
                  {scanError}{" "}
                  <button type="button" className="underline" onClick={() => void loadScan(false)}>
                    Retry
                  </button>
                </p>
              )}
              <FadeIn direction="up">
                {scan && !scanLoading && (
                  <p className="mb-3 font-code text-[11px] text-gitlore-text-secondary">
                    Branch <span className="text-gitlore-text">{scan.branch || "—"}</span> · {scan.fileCount} files touched ·{" "}
                    {scan.cached ? "served from cache" : "fresh scan"} · {new Date(scan.scannedAt).toLocaleString()}
                  </p>
                )}
                {!scanLoading && scan && scan.patterns.length === 0 && (
                  <p className="text-sm text-gitlore-text-secondary">
                    No rule hits in the sampled files. Reference cards below are still useful for review; run Re-scan after
                    pushing changes.
                  </p>
                )}
                <div className="space-y-4">
                  {(scan?.patterns ?? []).map((row) => (
                    <div
                      key={row.patternId}
                      className="rounded-sm border border-gitlore-border bg-gitlore-surface p-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${severityDotClass(row.severity)}`} />
                        <span className="text-sm font-medium text-gitlore-text">{row.name}</span>
                        <span className="rounded-sm border border-gitlore-border/60 px-2 py-0.5 font-code text-[10px] uppercase text-gitlore-text-secondary">
                          {row.category}
                        </span>
                        <span className="font-code text-xs text-gitlore-accent">×{row.matchCount}</span>
                      </div>
                      <ul className="space-y-1 font-code text-[11px] text-gitlore-text-secondary">
                        {row.matches.slice(0, 12).map((m, i) => (
                          <li key={`${m.file}-${m.line}-${i}`} className="flex flex-wrap gap-2">
                            <Link
                              to="/app"
                              state={{ file: m.file, analyzeLine: m.line }}
                              className="text-gitlore-accent hover:underline"
                            >
                              {m.file}:{m.line}
                            </Link>
                            <span className="min-w-0 truncate text-gitlore-text-secondary/90" title={m.snippet}>
                              {m.snippet}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </FadeIn>
            </div>

            {/* Explain */}
            <div className="mb-10">
              <div className="mb-2">
                <div className="text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  From PR review explanations
                </div>
                <p className="mt-1 max-w-2xl text-xs text-gitlore-text-secondary/90">
                  Pattern names from Gemini (or regex slugs) stored when you run <span className="text-gitlore-text">Explain</span>{" "}
                  on review comments in Live repo.
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
                  Where you have used <span className="text-gitlore-text">Analyze</span> on a line in Live repo, we show
                  confidence mix and the files you investigated most.
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
            Curated anti-pattern vs better-pattern snippets. Cards with a gold border had at least one matching hit in the
            last code scan (rule ids line up with the scanner). Everything here is educational — always confirm in context.
          </p>

          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearCategories}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                activeCategories.size === 0
                  ? "border-gitlore-accent/60 bg-gitlore-accent/15 text-gitlore-accent"
                  : "border-gitlore-border text-gitlore-text-secondary hover:border-gitlore-accent/40"
              }`}
            >
              All categories
            </button>
            {CATEGORY_LABELS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCategory(c)}
                className={`rounded-full border px-3 py-1 text-[11px] font-medium capitalize transition-colors ${
                  activeCategories.has(c)
                    ? "border-gitlore-accent/60 bg-gitlore-accent/15 text-gitlore-accent"
                    : "border-gitlore-border text-gitlore-text-secondary hover:border-gitlore-accent/40"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {repoPrimaryLang && (
            <label className="mb-4 flex cursor-pointer items-center gap-2 text-xs text-gitlore-text-secondary">
              <input
                type="checkbox"
                checked={langOnly}
                onChange={(e) => setLangOnly(e.target.checked)}
                className="rounded border-gitlore-border"
              />
              Show only patterns tagged with <span className="font-code text-gitlore-text">{repoPrimaryLang}</span>
            </label>
          )}

          <input
            type="text"
            placeholder="Filter by name (e.g. memory, SQL)…"
            value={refSearch}
            onChange={(e) => setRefSearch(e.target.value)}
            className="mb-6 w-full max-w-md rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-sm font-body text-gitlore-text outline-none transition-colors placeholder:text-gitlore-text-secondary/50 focus:border-gitlore-accent"
          />
          <FadeIn direction="up">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredSortedRef.map((p) => {
                const detected = cardDetected(p);
                const relevant = matchesRepoLang(p, repoPrimaryLang);
                return (
                  <div
                    key={p.id}
                    className={`pattern-card flex flex-col rounded-sm border bg-gitlore-surface p-4 ${
                      detected ? "border-amber-400/90 ring-1 ring-amber-400/50" : "border-gitlore-border"
                    }`}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                        Reference
                      </span>
                      {detected && (
                        <span className="rounded-sm bg-amber-500/20 px-2 py-0.5 font-code text-[9px] font-medium uppercase text-amber-200">
                          Detected in repo
                        </span>
                      )}
                      {relevant && repoPrimaryLang && (
                        <span className="rounded-sm border border-gitlore-accent/30 bg-gitlore-accent/10 px-2 py-0.5 text-[9px] text-gitlore-accent">
                          Relevant to this repo
                        </span>
                      )}
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${severityDotClass(p.severity)}`} />
                      <span
                        className={`rounded-sm border px-2 py-0.5 font-code text-[9px] font-semibold uppercase ${severityBadgeClass(p.severity)}`}
                      >
                        {p.severity}
                      </span>
                      <span className="rounded-sm border border-gitlore-border/60 px-2 py-0.5 font-code text-[9px] uppercase text-gitlore-text-secondary">
                        {p.category}
                      </span>
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
                      Not a substitute for review — cross-check with the Live repo and your team&apos;s standards.
                    </div>
                  </div>
                );
              })}
            </div>
          </FadeIn>
        </div>
      </div>
    </div>
  );
};

export default Patterns;
