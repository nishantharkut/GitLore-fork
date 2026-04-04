import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FadeIn } from "../components/effects/FadeIn";
import { ChatPanel } from "../components/ChatPanel";
import { IngestButton } from "../components/IngestButton";
import { KnowledgeDecisionsGraph } from "../components/KnowledgeDecisionsGraph";
import { OverviewSkeleton, Spinner } from "../components/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import { fetchRepoOverview, fetchRepoPullRequests, type RepoOverviewResponse, type RepoPullSummary } from "@/lib/gitloreApi";
import { startGithubOAuth as oauthNav } from "@/lib/githubOAuth";

const HealthBar = ({ score, max }: { score: number; max: number }) => (
  <div className="flex items-center gap-3">
    <progress className="overview-health-progress h-2 w-full overflow-hidden rounded-sm" value={score} max={max} />
    <span className="shrink-0 font-code text-sm text-gitlore-text">
      {typeof score === "number" ? score.toFixed(1) : score} / {max}
    </span>
  </div>
);

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return n.toLocaleString();
  return String(n);
}

const Overview = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { target, repoFull, setTarget, repoReady } = useRepo();
  const [data, setData] = useState<RepoOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [recentPulls, setRecentPulls] = useState<RepoPullSummary[]>([]);
  const [pullsLoading, setPullsLoading] = useState(false);
  const [pullsErr, setPullsErr] = useState<string | null>(null);
  const [refreshChat, setRefreshChat] = useState(0);
  const [showAllPRs, setShowAllPRs] = useState(false);
  const [showAllFiles, setShowAllFiles] = useState(false);

  useEffect(() => {
    if (!user) {
      setData(null);
      setLoading(false);
      setErr(null);
      return;
    }
    if (!repoReady) {
      setData(null);
      setLoading(false);
      setErr(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const o = await fetchRepoOverview(target.owner, target.name, target.branch);
        if (!cancelled) {
          setData(o);
          if (o.defaultBranch && o.defaultBranch !== target.branch) {
            /* optional: don’t auto-overwrite user branch */
          }
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load overview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, repoReady, target.owner, target.name, target.branch]);

  useEffect(() => {
    if (!user || !repoReady) {
      setRecentPulls([]);
      setPullsLoading(false);
      setPullsErr(null);
      return;
    }
    let cancelled = false;
    setPullsLoading(true);
    setPullsErr(null);
    void fetchRepoPullRequests(target.owner, target.name, 12)
      .then((list) => {
        if (!cancelled) setRecentPulls(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setRecentPulls([]);
          setPullsErr(e instanceof Error ? e.message : "Could not load pull requests");
        }
      })
      .finally(() => {
        if (!cancelled) setPullsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, repoReady, target.owner, target.name]);

  const onOpenFile = useCallback(
    (filePath: string) => {
      setTarget({ filePath });
      navigate("/app", { state: { file: filePath } });
    },
    [navigate, setTarget]
  );

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg px-4 py-12 text-center">
        <p className="mb-4 text-gitlore-text-secondary">Sign in to load repository overview from GitHub.</p>
        <button type="button" onClick={() => oauthNav()} className="rounded-sm bg-gitlore-accent px-4 py-2 text-sm text-white">
          Connect GitHub
        </button>
      </div>
    );
  }

  if (!repoReady) {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg px-4 py-12 text-center">
        <p className="mx-auto mb-2 max-w-md text-gitlore-text-secondary">
          No repository is selected yet. Open{" "}
          <Link to="/repos" className="text-gitlore-accent hover:text-gitlore-accent-hover">
            repository selection
          </Link>
          , or use <strong className="text-gitlore-text">Repositories</strong> in the header search.
        </p>
      </div>
    );
  }

  const awaitingInitialContent = loading || pullsLoading || (data === null && !err);
  if (awaitingInitialContent) {
    const loadMessage =
      loading && data === null
        ? "Loading repository overview from GitHub…"
        : pullsLoading
          ? "Loading pull requests and wiring the overview…"
          : "Preparing your overview…";
    return <OverviewSkeleton message={loadMessage} />;
  }

  const stats = data?.stats;
  const anti = data?.topAntiPatterns?.length ? data.topAntiPatterns : [];
  const mostChanged = data?.mostChangedFiles?.length ? data.mostChangedFiles : [];
  const visiblePRs = showAllPRs ? recentPulls : recentPulls.slice(0, 5);
  const visibleFiles = showAllFiles ? mostChanged : mostChanged.slice(0, 5);

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg">
      <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 md:py-12">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:gap-8">
          {/* Left Column: Stats & Info */}
          <div className="space-y-8 md:col-span-5">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">Repository</div>
              <h1 className="font-heading text-2xl font-bold text-gitlore-text">{repoFull}</h1>
              {data?.description && <p className="mt-2 text-sm text-gitlore-text-secondary">{data.description}</p>}
              {data?.language && (
                <p className="mt-1 font-code text-xs text-gitlore-accent">Primary language: {data.language}</p>
              )}
            </div>

            {err && <p className="text-sm text-gitlore-error">{err}</p>}
            {loading && data && (
              <p className="flex items-center gap-2 text-sm text-gitlore-text-secondary" role="status" aria-live="polite">
                <Spinner className="h-4 w-4" label="Refreshing overview" />
                Refreshing overview…
              </p>
            )}

            <FadeIn direction="up">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {[
                  { value: stats ? fmt(stats.stars) : "—", label: "Stars" },
                  { value: stats ? fmt(stats.forks) : "—", label: "Forks" },
                  { value: stats ? fmt(stats.pullRequests) : "—", label: "Open + closed PRs (total)" },
                  { value: stats ? fmt(stats.commits) : "—", label: "Commits (default branch)" },
                  { value: stats?.issues != null ? fmt(stats.issues) : "—", label: "Issues" },
                  { value: stats?.contributors != null ? fmt(stats.contributors) : "—", label: "Contributors" },
                  { value: stats?.files != null ? fmt(stats.files) : "—", label: "Files (tree)" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-sm border border-gitlore-border bg-gitlore-surface p-3">
                    <div className="font-heading text-xl font-bold text-gitlore-text">{stat.value}</div>
                    <div className="mt-0.5 text-xs text-gitlore-text-secondary">{stat.label}</div>
                  </div>
                ))}
              </div>
            </FadeIn>

            <div>
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">Recent pull requests</div>
              {pullsErr && <p className="mb-2 text-sm text-gitlore-error">{pullsErr}</p>}
              {pullsLoading && (
                <p className="mb-2 flex items-center gap-2 text-sm text-gitlore-text-secondary" role="status" aria-live="polite">
                  <Spinner className="h-4 w-4" label="Loading pull requests" />
                  Loading PRs from GitHub…
                </p>
              )}
              {!pullsLoading && !pullsErr && recentPulls.length === 0 && (
                <p className="text-sm text-gitlore-text-secondary">No pull requests returned (empty repo or API scope).</p>
              )}
              <ul className="space-y-2">
                {visiblePRs.map((pr) => (
                  <li key={pr.number} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                    <a
                      href={pr.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 font-code text-gitlore-accent hover:text-gitlore-accent-hover"
                    >
                      #{pr.number}
                    </a>
                    <span className="min-w-0 flex-1 text-gitlore-text">{pr.title}</span>
                    <span className="font-code text-[11px] uppercase text-gitlore-text-secondary">{pr.state}</span>
                    {pr.authorLogin ? (
                      <span className="font-code text-[11px] text-gitlore-text-secondary">@{pr.authorLogin}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {recentPulls.length > 5 ? (
                <button
                  type="button"
                  onClick={() => setShowAllPRs((v) => !v)}
                  className="mt-2 cursor-pointer text-xs text-gitlore-accent hover:text-gitlore-accent-hover"
                >
                  {showAllPRs ? "Show less" : `Show all ${recentPulls.length}`}
                </button>
              ) : null}
            </div>

            <div>
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">Code Health Score</div>
              <HealthBar score={data?.healthScore ?? 0} max={10} />
            </div>

            <div>
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">Patterns (from cached reviews)</div>
              <div className="space-y-2">
                {anti.length ? (
                  anti.map((item) => (
                    <div key={item.text} className="flex items-center gap-2 text-sm">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
                      <span className="text-gitlore-text">{item.text}</span>
                      <span className="text-gitlore-text-secondary">&mdash; found {item.count} times</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gitlore-text-secondary">No cached explain() pattern hits yet. Run review explanations on Live repo to populate.</p>
                )}
              </div>
            </div>

            <div>
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">Most churned files (recent commits)</div>
              <ol className="space-y-1.5">
                {mostChanged.length ? (
                  visibleFiles.map((file, i) => (
                    <li key={file.name} className="flex items-baseline gap-2 text-sm">
                      <span className="w-4 shrink-0 text-xs text-gitlore-text-secondary">{i + 1}.</span>
                      <button
                        type="button"
                        className="text-left font-code text-gitlore-accent transition-colors hover:text-gitlore-accent-hover"
                        onClick={() => onOpenFile(file.name)}
                      >
                        {file.name}
                      </button>
                      <span className="text-xs text-gitlore-text-secondary">({file.changes} line changes)</span>
                    </li>
                  ))
                ) : (
                  <p className="text-sm text-gitlore-text-secondary">No churn data yet (private repo scope or no recent commits).</p>
                )}
              </ol>
              {mostChanged.length > 5 ? (
                <button
                  type="button"
                  onClick={() => setShowAllFiles((v) => !v)}
                  className="mt-2 cursor-pointer text-xs text-gitlore-accent hover:text-gitlore-accent-hover"
                >
                  {showAllFiles ? "Show less" : `Show all ${mostChanged.length}`}
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => navigate("/app")}
              className="w-full rounded-sm bg-gitlore-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover"
            >
              Explore Code &rarr;
            </button>
          </div>

          {/* Knowledge graph, ingest, chat */}
          <div className="flex min-h-0 flex-col gap-4 md:col-span-7">
            <KnowledgeDecisionsGraph refreshKey={refreshChat} />
            <IngestButton
              onComplete={() => {
                setRefreshChat((p) => p + 1);
              }}
            />
            <ChatPanel key={refreshChat} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Overview;
