import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useRepo } from "@/context/RepoContext";
import { fetchKnowledgeLayout, type KnowledgeLayoutResponse } from "@/lib/gitloreApi";

/** Normalize owner/name the same way the backend builds `repo` on nodes. */
function repoLayoutKey(owner: string, name: string) {
  return `${owner}/${name}`.toLowerCase().replace(/^\/+|\/+$/g, "");
}

/**
 * Survives Overview ↔ /app navigation: remounted component can paint the last good graph
 * immediately and tolerate transient GET failures without showing “re-ingest” empty state.
 */
const knowledgeLayoutCache = new Map<string, KnowledgeLayoutResponse>();

const EDGE_STROKE: Record<string, string> = {
  pr_pr_time: "rgba(148, 163, 184, 0.35)",
  pr_pr_issue: "rgba(52, 211, 153, 0.75)",
  repo_pr: "rgba(201, 168, 76, 0.5)",
  pr_issue: "rgba(34, 197, 94, 0.55)",
  contrib_pr: "rgba(129, 140, 248, 0.5)",
  pr_merge: "rgba(148, 163, 184, 0.55)",
};

const EDGE_ORDER: Record<string, number> = {
  pr_pr_time: 0,
  pr_pr_issue: 1,
  repo_pr: 2,
  contrib_pr: 3,
  pr_issue: 4,
  pr_merge: 5,
};

const TYPE_LEGEND: Record<string, string> = {
  feature: "#60a5fa",
  bugfix: "#f87171",
  refactor: "#34d399",
  architecture: "#a78bfa",
  security: "#fb923c",
  performance: "#fbbf24",
  documentation: "#9ca3af",
  other: "#6b7280",
};

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.75;
const ZOOM_STEP = 0.12;

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function useGraphElements(layout: KnowledgeLayoutResponse | null) {
  return useMemo(() => {
    if (!layout?.viewBox || !layout.nodes?.length) {
      return { w: 1000, h: 640, edgeEls: null as ReactNode, nodeEls: null as ReactNode };
    }
    const w0 = layout.viewBox.w;
    const h0 = layout.viewBox.h;
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]));

    const sortedEdges = [...layout.edges].sort(
      (x, y) => (EDGE_ORDER[x.kind] ?? 9) - (EDGE_ORDER[y.kind] ?? 9)
    );

    const edges = sortedEdges.map((e, i) => {
      const a = byId[e.from];
      const b = byId[e.to];
      if (!a || !b) return null;
      const stroke = EDGE_STROKE[e.kind] || "rgba(148, 163, 184, 0.4)";
      const sw =
        e.kind === "repo_pr"
          ? 2.2
          : e.kind === "pr_pr_issue"
            ? 2.4
            : e.kind === "pr_issue"
              ? 1.9
              : e.kind === "pr_pr_time"
                ? 1.2
                : 1.45;
      const dashed = e.kind === "pr_pr_time" ? "5 8" : undefined;
      return (
        <line
          key={`e-${e.from}-${e.to}-${e.kind}-${i}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dashed}
        />
      );
    });

    const nodes = layout.nodes.map((n) => nodeShape(n, n.id));

    return { w: w0, h: h0, edgeEls: edges, nodeEls: nodes };
  }, [layout]);
}

function nodeShape(n: KnowledgeLayoutResponse["nodes"][0], key: string): ReactNode {
  const r = n.r ?? 20;
  const fill = n.color;
  const stroke = n.color;
  const label = n.label;
  const sub = n.sublabel ? `${n.sublabel.slice(0, 48)}${n.sublabel.length > 48 ? "…" : ""}` : "";
  const tooltip = [n.label, n.sublabel].filter(Boolean).join(" — ");

  const textFill = "#f1f5f9";
  const subFill = "#94a3b8";
  const fontSmall = 11;
  const fontTiny = 9;

  const wrap = (body: ReactNode) =>
    n.href ? (
      <a key={key} href={n.href} target="_blank" rel="noreferrer">
        {body}
      </a>
    ) : (
      <g key={key}>{body}</g>
    );

  if (n.kind === "repository") {
    const w = r * 2.2;
    const h = r * 1.15;
    return wrap(
      <g transform={`translate(${n.x}, ${n.y})`}>
        <title>{tooltip}</title>
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={10}
          fill={fill}
          fillOpacity={0.25}
          stroke={stroke}
          strokeWidth={3}
        />
        <text textAnchor="middle" y={4} fill={textFill} fontSize={fontSmall} fontWeight={600} fontFamily="system-ui, sans-serif">
          {label.length > 28 ? `${label.slice(0, 26)}…` : label}
        </text>
      </g>
    );
  }

  if (n.kind === "contributor") {
    const w = Math.max(72, label.length * 6.5);
    const h = 34;
    return wrap(
      <g transform={`translate(${n.x}, ${n.y})`}>
        <title>{tooltip}</title>
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={8}
          fill={fill}
          fillOpacity={0.22}
          stroke={stroke}
          strokeWidth={2}
        />
        <text textAnchor="middle" y={5} fill={textFill} fontSize={fontTiny} fontFamily="ui-monospace, monospace">
          {label}
        </text>
      </g>
    );
  }

  if (n.kind === "issue") {
    const s = r * 1.15;
    const pts = `0,-${s} ${s},0 0,${s} -${s},0`;
    return wrap(
      <g transform={`translate(${n.x}, ${n.y})`}>
        <title>{tooltip}</title>
        <polygon points={pts} fill={fill} fillOpacity={0.3} stroke={stroke} strokeWidth={2.5} />
        <text textAnchor="middle" y={4} fill={textFill} fontSize={fontTiny} fontWeight={600} fontFamily="ui-monospace, monospace">
          {label}
        </text>
        {sub ? (
          <text textAnchor="middle" y={16} fill={subFill} fontSize={8} fontFamily="system-ui, sans-serif">
            {sub}
          </text>
        ) : null}
      </g>
    );
  }

  if (n.kind === "merge_commit") {
    const s = r * 1.05;
    const pts = `0,-${s} ${s},0 0,${s} -${s},0`;
    return wrap(
      <g transform={`translate(${n.x}, ${n.y})`}>
        <title>{tooltip}</title>
        <polygon
          points={pts}
          fill={fill}
          fillOpacity={0.45}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray="3 2"
        />
        <text textAnchor="middle" y={4} fill={textFill} fontSize={7} fontFamily="ui-monospace, monospace">
          {label.length > 10 ? `${label.slice(0, 8)}…` : label}
        </text>
      </g>
    );
  }

  return wrap(
    <g transform={`translate(${n.x}, ${n.y})`}>
      {n.sublabel ? <title>{tooltip}</title> : <title>{n.label}</title>}
      <circle r={r} fill={fill} fillOpacity={0.5} stroke={stroke} strokeWidth={3} />
      <text textAnchor="middle" y={5} fill={textFill} fontSize={fontSmall} fontWeight={700} fontFamily="ui-monospace, monospace">
        {label}
      </text>
    </g>
  );
}

function ZoomToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onExpand,
  showFullscreenButton = true,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onExpand?: () => void;
  showFullscreenButton?: boolean;
}) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-sm border border-gitlore-border bg-gitlore-bg/95 px-1 py-0.5 shadow-md backdrop-blur-sm">
      <button
        type="button"
        title="Zoom out"
        className="rounded-sm p-2 text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface hover:text-gitlore-text"
        onClick={onZoomOut}
      >
        <ZoomOut className="h-4 w-4" aria-hidden />
      </button>
      <span className="min-w-[3rem] text-center font-code text-[11px] text-gitlore-text">{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        title="Zoom in"
        className="rounded-sm p-2 text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface hover:text-gitlore-text"
        onClick={onZoomIn}
      >
        <ZoomIn className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        title="Reset zoom"
        className="rounded-sm p-2 text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface hover:text-gitlore-text"
        onClick={onReset}
      >
        <RotateCcw className="h-4 w-4" aria-hidden />
      </button>
      {showFullscreenButton && onExpand ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-gitlore-border" aria-hidden />
          <button
            type="button"
            title="Open large view"
            className="rounded-sm p-2 text-gitlore-accent transition-colors hover:bg-gitlore-surface hover:text-gitlore-accent-hover"
            onClick={onExpand}
          >
            <Maximize2 className="h-4 w-4" aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  );
}

function GraphSvg({
  w,
  h,
  edgeEls,
  nodeEls,
  zoom,
  className,
}: {
  w: number;
  h: number;
  edgeEls: ReactNode;
  nodeEls: ReactNode;
  zoom: number;
  className?: string;
}) {
  const cx = w / 2;
  const cy = h / 2;
  const t = `translate(${cx} ${cy}) scale(${zoom}) translate(${-cx} ${-cy})`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      role="img"
      aria-label="Knowledge graph"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={w} height={h} fill="transparent" />
      <g transform={t}>
        <g>{edgeEls}</g>
        <g>{nodeEls}</g>
      </g>
    </svg>
  );
}

export function KnowledgeDecisionsGraph({ refreshKey = 0 }: { refreshKey?: number }) {
  const { target, repoReady } = useRepo();
  const [layout, setLayout] = useState<KnowledgeLayoutResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [modalZoom, setModalZoom] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);

  const lastRepoKeyRef = useRef<string | null>(null);
  const prevRefreshKeyRef = useRef(refreshKey);

  useEffect(() => {
    if (!repoReady) {
      setLayout(null);
      setErr(null);
      setLoading(false);
      lastRepoKeyRef.current = null;
      return;
    }

    const key = repoLayoutKey(target.owner, target.name);
    const switchedRepo =
      lastRepoKeyRef.current !== null && lastRepoKeyRef.current !== key;
    lastRepoKeyRef.current = key;

    if (switchedRepo) {
      setLayout(null);
      setErr(null);
    }

    const refreshBumped = prevRefreshKeyRef.current !== refreshKey;
    prevRefreshKeyRef.current = refreshKey;
    if (refreshBumped) {
      knowledgeLayoutCache.delete(key);
    }

    const cached = knowledgeLayoutCache.get(key);
    if (cached?.nodes?.length) {
      setLayout(cached);
    }

    let cancelled = false;
    const hasInstantLayout = !!(cached?.nodes?.length);
    if (!hasInstantLayout) {
      setLoading(true);
    } else {
      setLoading(false);
    }
    setErr(null);

    void fetchKnowledgeLayout(target.owner, target.name)
      .then((res) => {
        if (cancelled) return;
        knowledgeLayoutCache.set(key, res);
        setLayout(res);
        setErr(null);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not load knowledge graph";
        setErr(msg);
        setLayout((prev) => {
          if (prev?.nodes?.length) return prev;
          const fromCache = knowledgeLayoutCache.get(key);
          if (fromCache?.nodes?.length) return fromCache;
          return prev;
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repoReady, target.owner, target.name, refreshKey, retryTick]);

  const { w, h, edgeEls, nodeEls } = useGraphElements(layout);

  useEffect(() => {
    if (!modalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [modalOpen]);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z - ZOOM_STEP)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  const modalZoomIn = useCallback(() => setModalZoom((z) => clampZoom(z + ZOOM_STEP)), []);
  const modalZoomOut = useCallback(() => setModalZoom((z) => clampZoom(z - ZOOM_STEP)), []);
  const modalZoomReset = useCallback(() => setModalZoom(1), []);

  const wheelZoomInline = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => clampZoom(z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
  }, []);

  const wheelZoomModal = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setModalZoom((z) => clampZoom(z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
  }, []);

  if (!repoReady) return null;

  const hasGraph = layout && layout.nodes && layout.nodes.length > 0;
  const canRenderSvg = edgeEls != null && nodeEls != null && hasGraph;

  return (
    <div className="rounded-sm border border-gitlore-border bg-gitlore-surface">
      <div className="border-b border-gitlore-border px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-gitlore-text">Knowledge graph</h3>
            <p className="mt-0.5 max-w-[52rem] text-xs leading-relaxed text-gitlore-text-secondary">
              Contributors sit in a row at the bottom (lines go up to their PRs). Use zoom and the expand control for a large
              popup. <span className="text-emerald-400/90">Solid green</span> = PRs share a closing issue;{" "}
              <span className="text-slate-400">dotted</span> = merge-time neighbors. Hover PRs for titles.
            </p>
          </div>
        </div>
      </div>

      <div className="relative w-full p-2 md:p-3">
        {loading && !hasGraph && (
          <div className="flex min-h-[280px] items-center justify-center text-sm text-gitlore-text-secondary">
            Loading graph…
          </div>
        )}
        {loading && hasGraph ? (
          <p className="mb-2 text-center text-[11px] text-gitlore-text-secondary" role="status">
            Refreshing graph…
          </p>
        ) : null}
        {!loading && err && !hasGraph && (
          <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-gitlore-error">
            <p>{err}</p>
            <button
              type="button"
              className="rounded-sm border border-gitlore-border px-3 py-1 text-xs text-gitlore-accent transition-colors hover:bg-gitlore-surface-hover"
              onClick={() => setRetryTick((t) => t + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {!loading && err && hasGraph && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-gitlore-text-secondary">
            <span>Could not refresh the graph ({err}). Showing the last successful load.</span>
            <button
              type="button"
              className="shrink-0 rounded-sm border border-gitlore-border bg-gitlore-surface px-2 py-1 text-[11px] text-gitlore-accent transition-colors hover:bg-gitlore-surface-hover"
              onClick={() => setRetryTick((t) => t + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !err && !hasGraph && (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-gitlore-text-secondary">
              No ingested decisions yet. Run <span className="text-gitlore-text">Build Knowledge Graph</span> to index merged PRs.
            </p>
          </div>
        )}
        {canRenderSvg && (
          <>
            <div className="pointer-events-none absolute right-3 top-3 z-20 md:right-4 md:top-4">
              <ZoomToolbar
                zoom={zoom}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onReset={zoomReset}
                onExpand={() => {
                  setModalZoom(1);
                  setModalOpen(true);
                }}
              />
            </div>
            <div
              className="overflow-auto rounded-sm border border-gitlore-border/60 bg-gitlore-code/30 pt-10"
              onWheel={wheelZoomInline}
            >
              <GraphSvg
                w={w}
                h={h}
                edgeEls={edgeEls}
                nodeEls={nodeEls}
                zoom={zoom}
                className="mx-auto block min-h-[min(68vh,760px)] w-full min-w-[1000px] max-w-full"
              />
            </div>
          </>
        )}

        {hasGraph && (
          <div className="mt-3 space-y-2 border-t border-gitlore-border/60 pt-3 text-[10px] text-gitlore-text-secondary">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="uppercase tracking-wider">PR types</span>
              {Object.entries(TYPE_LEGEND).map(([t, c]) => (
                <span key={t} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
                  {t}
                </span>
              ))}
            </div>
            <p className="leading-relaxed">
              <span className="text-gitlore-accent">■</span> repo &nbsp;
              <span style={{ color: "#818cf8" }}>■</span> contributor (bottom) &nbsp;
              <span style={{ color: "#22c55e" }}>◆</span> linked issue &nbsp;
              <span className="text-slate-400">◇</span> merge commit &nbsp;
              <span className="text-emerald-400/80">━</span> shared issue &nbsp;
              <span className="text-slate-500">┅</span> time — click nodes for GitHub. &nbsp;
              <span className="text-gitlore-text-secondary/90">Ctrl/Cmd+wheel on graph to zoom.</span>
            </p>
          </div>
        )}
      </div>

      {modalOpen && canRenderSvg && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-3 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kg-modal-title"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-[min(96vw,1880px)] flex-col overflow-hidden rounded-sm border border-gitlore-border bg-gitlore-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gitlore-border bg-gitlore-bg/80 px-4 py-3">
              <h2 id="kg-modal-title" className="text-sm font-medium text-gitlore-text">
                Knowledge graph — full view
              </h2>
              <div className="flex items-center gap-2">
                <ZoomToolbar
                  zoom={modalZoom}
                  onZoomIn={modalZoomIn}
                  onZoomOut={modalZoomOut}
                  onReset={modalZoomReset}
                  showFullscreenButton={false}
                />
                <button
                  type="button"
                  title="Close"
                  className="rounded-sm p-2 text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface hover:text-gitlore-text"
                  onClick={() => setModalOpen(false)}
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-auto bg-gitlore-code/20 p-2 md:p-4"
              onWheel={wheelZoomModal}
            >
              <GraphSvg
                w={w}
                h={h}
                edgeEls={edgeEls}
                nodeEls={nodeEls}
                zoom={modalZoom}
                className="mx-auto block min-h-[75vh] w-full min-w-[1100px]"
              />
            </div>
            <p className="shrink-0 border-t border-gitlore-border px-4 py-2 text-center text-[10px] text-gitlore-text-secondary">
              Scroll to pan. Ctrl/Cmd + wheel to zoom. Esc or backdrop to close.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
