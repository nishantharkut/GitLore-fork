import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { FadeIn } from "../components/effects/FadeIn";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import { fetchRepoOverview, type RepoOverviewResponse } from "@/lib/gitloreApi";
import { startGithubOAuth as oauthNav } from "@/lib/githubOAuth";

interface GraphNode {
  id: string;
  label: string;
  fullName: string;
  x: number;
  y: number;
  size: number;
  color: string;
  changes: number;
  authors: number;
  floatDuration: number;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.75;
const NODE_DRAG_CLICK_THRESHOLD_PX = 6;

type NodeDragSession = {
  pointerId: number;
  nodeId: string;
  grabDx: number;
  grabDy: number;
  ox: number;
  oy: number;
  dragged: boolean;
};

function positionsFromNodes(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  return Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

const KnowledgeGraph = ({
  nodes,
  edges,
  onOpenFile,
}: {
  nodes: GraphNode[];
  edges: [string, string][];
  onOpenFile: (path: string) => void;
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const graphLayerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [positions, setPositions] = useState(() => positionsFromNodes(nodes));
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragSessionRef = useRef<NodeDragSession | null>(null);
  const suppressNextClickRef = useRef(false);

  const nodesKey = nodes.map((n) => n.id).join("|");
  useEffect(() => {
    setPositions(positionsFromNodes(nodes));
    setSelected(null);
    scaleRef.current = 1;
    setScale(1);
  }, [nodesKey, nodes]);

  scaleRef.current = scale;

  const clientToPercent = (clientX: number, clientY: number) => {
    const layer = graphLayerRef.current;
    if (!layer) return { x: 50, y: 50 };
    const w = layer.offsetWidth;
    const h = layer.offsetHeight;
    if (w < 1 || h < 1) return { x: 50, y: 50 };
    const rect = layer.getBoundingClientRect();
    const s = scaleRef.current;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const lx = w / 2 + (clientX - cx) / s;
    const ly = h / 2 + (clientY - cy) / s;
    return { x: (lx / w) * 100, y: (ly / h) * 100 };
  };

  const clampPct = (v: number) => Math.min(96, Math.max(4, v));

  const zoomByFactor = (factor: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * factor));
    scaleRef.current = next;
    setScale(next);
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * factor));
      scaleRef.current = next;
      setScale(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const endNodeDragListeners = (move: (e: PointerEvent) => void, up: (e: PointerEvent) => void) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };

  const onNodePointerDown = (e: React.PointerEvent, nodeId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { x: xPct, y: yPct } = clientToPercent(e.clientX, e.clientY);
    const pos = positions[nodeId];
    if (!pos) return;
    const session: NodeDragSession = {
      pointerId: e.pointerId,
      nodeId,
      grabDx: pos.x - xPct,
      grabDy: pos.y - yPct,
      ox: e.clientX,
      oy: e.clientY,
      dragged: false,
    };
    dragSessionRef.current = session;
    setDraggingNodeId(nodeId);

    const onMove = (ev: PointerEvent) => {
      const s = dragSessionRef.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      const dx = ev.clientX - s.ox;
      const dy = ev.clientY - s.oy;
      if (!s.dragged) {
        if (dx * dx + dy * dy < NODE_DRAG_CLICK_THRESHOLD_PX * NODE_DRAG_CLICK_THRESHOLD_PX) return;
        s.dragged = true;
      }
      const p = clientToPercent(ev.clientX, ev.clientY);
      const nx = clampPct(p.x + s.grabDx);
      const ny = clampPct(p.y + s.grabDy);
      setPositions((prev) => ({ ...prev, [s.nodeId]: { x: nx, y: ny } }));
    };

    const onUp = (ev: PointerEvent) => {
      const s = dragSessionRef.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      endNodeDragListeners(onMove, onUp);
      dragSessionRef.current = null;
      setDraggingNodeId(null);
      if (s.dragged) suppressNextClickRef.current = true;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  if (!nodes.length) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-sm bg-gitlore-code px-4 text-center text-sm text-gitlore-text-secondary">
        No graph nodes yet. Overview uses recent commit file churn — try a busier branch or open Live repo after more activity.
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <div className="absolute right-2 top-2 z-20 flex gap-0.5 rounded-sm border border-gitlore-border bg-gitlore-bg/90 p-0.5 shadow-sm backdrop-blur-sm">
        <button
          type="button"
          title="Zoom out"
          className="rounded-sm p-1.5 text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface hover:text-gitlore-text"
          onClick={() => zoomByFactor(0.85)}
        >
          <ZoomOut className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          title="Zoom in"
          className="rounded-sm p-1.5 text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface hover:text-gitlore-text"
          onClick={() => zoomByFactor(1.15)}
        >
          <ZoomIn className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          title="Reset zoom and node positions"
          className="rounded-sm p-1.5 text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface hover:text-gitlore-text"
          onClick={() => {
            scaleRef.current = 1;
            setScale(1);
            setPositions(positionsFromNodes(nodes));
            setSelected(null);
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div
        ref={viewportRef}
        className="relative w-full touch-none select-none overflow-hidden rounded-sm bg-gitlore-code pb-[100%] md:pb-[80%]"
      >
        <div
          ref={graphLayerRef}
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "center center",
          }}
        >
          <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full">
            {edges.map(([a, b]) => {
              const pa = positions[a];
              const pb = positions[b];
              if (!pa || !pb) return null;
              return (
                <line key={`${a}-${b}`} x1={`${pa.x}%`} y1={`${pa.y}%`} x2={`${pb.x}%`} y2={`${pb.y}%`} stroke="#2A2A3A" strokeWidth={1} />
              );
            })}
          </svg>

          {nodes.map((node) => {
            const pos = positions[node.id];
            if (!pos) return null;
            return (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                className={`overview-node absolute z-[1] flex cursor-grab items-center justify-center rounded-full border-2 transition-[box-shadow,transform] ${
                  selected === node.id ? "ring-2 ring-gitlore-accent ring-offset-2 ring-offset-gitlore-code" : ""
                } ${draggingNodeId === node.id ? "z-[2] cursor-grabbing" : ""}`}
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  width: node.size,
                  height: node.size,
                  borderColor: node.color,
                }}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onPointerDown={(e) => onNodePointerDown(e, node.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (suppressNextClickRef.current) {
                    suppressNextClickRef.current = false;
                    return;
                  }
                  setSelected(node.id);
                  onOpenFile(node.fullName);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(node.id);
                    onOpenFile(node.fullName);
                  }
                }}
              >
                <span className={`pointer-events-none select-none font-code text-gitlore-text ${node.size > 30 ? "text-[8px]" : "text-[7px]"}`}>
                  {node.label}
                </span>

                {hovered === node.id && (
                  <div className="pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-sm border border-gitlore-border bg-gitlore-surface px-3 py-1.5 text-[11px] shadow-md">
                    <span className="font-code text-gitlore-text">{node.fullName}</span>
                    <span className="text-gitlore-text-secondary">
                      {" "}
                      &mdash; {node.changes} line churn, {node.authors} {node.authors === 1 ? "author" : "authors"} (recent commits)
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

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
  const { target, repoFull, setTarget, repoReady, repoResolving } = useRepo();
  const [data, setData] = useState<RepoOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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

  const graphNodes: GraphNode[] = useMemo(() => {
    const raw = data?.knowledgeGraph?.nodes || [];
    return raw.map((n) => ({
      id: n.id,
      label: n.label,
      fullName: n.fullName,
      x: n.x,
      y: n.y,
      size: n.size,
      color: n.color,
      changes: n.changes,
      authors: n.authors,
      floatDuration: n.floatDuration,
    }));
  }, [data]);

  const graphEdges = useMemo(() => data?.knowledgeGraph?.edges || [], [data]);

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

  if (repoResolving) {
    return (
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center bg-gitlore-bg px-4">
        <p className="text-sm text-gitlore-text-secondary">Loading your most recently updated repository…</p>
      </div>
    );
  }

  if (!repoReady) {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg px-4 py-12 text-center">
        <p className="mx-auto mb-2 max-w-md text-gitlore-text-secondary">
          No repository is selected yet. Use <strong className="text-gitlore-text">Repositories</strong> in the header search to find a GitHub repo, or push a repo to your account and refresh.
        </p>
      </div>
    );
  }

  const stats = data?.stats;
  const anti = data?.topAntiPatterns?.length ? data.topAntiPatterns : [];
  const mostChanged = data?.mostChangedFiles?.length ? data.mostChangedFiles : [];

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg">
      <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-12">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-5 md:gap-8">
          <div className="space-y-8 md:col-span-2">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">Repository</div>
              <h1 className="font-heading text-2xl font-bold text-gitlore-text">{repoFull}</h1>
              {data?.description && <p className="mt-2 text-sm text-gitlore-text-secondary">{data.description}</p>}
              {data?.language && (
                <p className="mt-1 font-code text-xs text-gitlore-accent">Primary language: {data.language}</p>
              )}
            </div>

            {err && <p className="text-sm text-gitlore-error">{err}</p>}
            {loading && <p className="text-sm text-gitlore-text-secondary">Loading overview from GitHub…</p>}

            <FadeIn direction="up">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { value: stats ? fmt(stats.pullRequests) : "—", label: "PRs" },
                  { value: stats ? fmt(stats.commits) : "—", label: "Commits (default branch)" },
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
                  mostChanged.map((file, i) => (
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
            </div>

            <button
              type="button"
              onClick={() => navigate("/app")}
              className="w-full rounded-sm bg-gitlore-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover"
            >
              Explore Code &rarr;
            </button>
          </div>

          <div className="md:col-span-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary">Visualization</div>
            <h2 className="mb-6 font-heading text-lg font-semibold text-gitlore-text">Hot files (commit churn)</h2>

            <div className="rounded-sm border border-gitlore-border bg-gitlore-surface p-4 md:p-6">
              <KnowledgeGraph nodes={graphNodes} edges={graphEdges} onOpenFile={onOpenFile} />
            </div>

            <p className="mt-3 text-sm leading-relaxed text-gitlore-text-secondary lg:text-xs">
              Bubble size reflects aggregate line churn in recent commits. Edges link consecutive hotspots. Drag to rearrange; click to open in Live repo. Data comes from the GitHub API (same repo as your Live tab target: {repoFull}).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Overview;
