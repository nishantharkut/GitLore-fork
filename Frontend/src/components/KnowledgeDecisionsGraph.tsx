import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useRepo } from "@/context/RepoContext";
import { useTheme, type ThemeMode } from "@/context/ThemeContext";
import { fetchKnowledgeLayout, type KnowledgeLayoutResponse } from "@/lib/gitloreApi";
import {
  clearKnowledgeLayoutCache,
  loadKnowledgeLayoutCache,
  saveKnowledgeLayoutCache,
} from "@/lib/overviewSessionCache";

/** Normalize owner/name the same way the backend builds `repo` on nodes. */
function repoLayoutKey(owner: string, name: string) {
  return `${owner}/${name}`.toLowerCase().replace(/^\/+|\/+$/g, "");
}

/**
 * Survives Overview ↔ /app navigation: remounted component can paint the last good graph
 * immediately and tolerate transient GET failures without showing “re-ingest” empty state.
 */
const knowledgeLayoutCache = new Map<string, KnowledgeLayoutResponse>();

function edgePaint(kind: string, theme: ThemeMode): { stroke: string; sw: number; dashed?: string } {
  const d = theme === "dark";
  const muted = d ? "rgba(148, 163, 184, 0.45)" : "rgba(71, 85, 105, 0.55)";
  const gold = d ? "rgba(201, 168, 76, 0.75)" : "rgba(180, 83, 9, 0.85)";
  const green = d ? "rgba(52, 211, 153, 0.85)" : "rgba(21, 128, 61, 0.9)";
  const green2 = d ? "rgba(34, 197, 94, 0.65)" : "rgba(22, 101, 52, 0.85)";
  const violet = d ? "rgba(167, 139, 250, 0.65)" : "rgba(109, 40, 217, 0.75)";
  const indigo = d ? "rgba(129, 140, 248, 0.65)" : "rgba(67, 56, 202, 0.8)";
  const slate = d ? "rgba(148, 163, 184, 0.55)" : "rgba(100, 116, 139, 0.75)";
  switch (kind) {
    case "repo_pr":
      return { stroke: gold, sw: 2.4 };
    case "pr_pr_issue":
      return { stroke: green, sw: 2.5 };
    case "pr_topic":
      return { stroke: violet, sw: 1.6, dashed: "4 4" };
    case "pr_issue":
      return { stroke: green2, sw: 2 };
    case "contrib_pr":
      return { stroke: indigo, sw: 1.85 };
    case "pr_merge":
      return { stroke: slate, sw: 1.7 };
    case "pr_pr_time":
      return { stroke: muted, sw: 1.25, dashed: "5 8" };
    default:
      return { stroke: muted, sw: 1.4 };
  }
}

const EDGE_ORDER: Record<string, number> = {
  pr_pr_time: 0,
  pr_pr_issue: 1,
  pr_topic: 2,
  repo_pr: 3,
  contrib_pr: 4,
  pr_issue: 5,
  pr_merge: 6,
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

type LayoutNode = KnowledgeLayoutResponse["nodes"][0];

/** Bounding box in layout coordinates (aligned with `nodeShape` sizes) for fit-to-view. */
function nodeBBox(n: LayoutNode): { minX: number; maxX: number; minY: number; maxY: number } {
  const r = n.r ?? 20;
  const label = n.label || "";
  if (n.kind === "repository") {
    const ww = r * 2.2;
    const hh = r * 1.15;
    return { minX: n.x - ww / 2, maxX: n.x + ww / 2, minY: n.y - hh / 2, maxY: n.y + hh / 2 };
  }
  if (n.kind === "topic") {
    const tw = Math.max(56, label.length * 5.8 + 16);
    const th = 28;
    return { minX: n.x - tw / 2, maxX: n.x + tw / 2, minY: n.y - th / 2, maxY: n.y + th / 2 };
  }
  if (n.kind === "contributor") {
    const ww = Math.max(72, label.length * 6.5);
    const hh = 34;
    return { minX: n.x - ww / 2, maxX: n.x + ww / 2, minY: n.y - hh / 2, maxY: n.y + hh / 2 };
  }
  if (n.kind === "issue") {
    const s = r * 1.15;
    return { minX: n.x - s, maxX: n.x + s, minY: n.y - s, maxY: n.y + s };
  }
  if (n.kind === "merge_commit") {
    const s = r * 1.05;
    return { minX: n.x - s, maxX: n.x + s, minY: n.y - s, maxY: n.y + s };
  }
  return { minX: n.x - r, maxX: n.x + r, minY: n.y - r, maxY: n.y + r };
}

function useGraphElements(layout: KnowledgeLayoutResponse | null, theme: ThemeMode) {
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
      const { stroke, sw, dashed } = edgePaint(e.kind, theme);
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

    const nodes = layout.nodes.map((n) => nodeShape(n, n.id, theme));

    return { w: w0, h: h0, edgeEls: edges, nodeEls: nodes };
  }, [layout, theme]);
}

function nodeShape(n: KnowledgeLayoutResponse["nodes"][0], key: string, theme: ThemeMode): ReactNode {
  const r = n.r ?? 20;
  const accent = n.color;
  const label = n.label;
  const sub = n.sublabel ? `${n.sublabel.slice(0, 48)}${n.sublabel.length > 48 ? "…" : ""}` : "";
  const tooltip = [n.label, n.sublabel].filter(Boolean).join(" — ");
  const L = theme === "light";

  const textMain = L ? "#0f172a" : "#f8fafc";
  const textSub = L ? "#475569" : "#cbd5e1";
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
    const fill = L ? "#fffbeb" : "#1c1917";
    const stroke = L ? "#d97706" : accent;
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
          fillOpacity={L ? 0.95 : 0.92}
          stroke={stroke}
          strokeWidth={L ? 2.5 : 2.5}
        />
        <text textAnchor="middle" y={4} fill={L ? "#78350f" : textMain} fontSize={fontSmall} fontWeight={600} fontFamily="system-ui, sans-serif">
          {label.length > 28 ? `${label.slice(0, 26)}…` : label}
        </text>
      </g>
    );
  }

  if (n.kind === "topic") {
    const tw = Math.max(56, label.length * 5.8 + 16);
    const th = 28;
    const fill = L ? "#f5f3ff" : "#2e1065";
    const stroke = L ? "#7c3aed" : "#c4b5fd";
    return wrap(
      <g transform={`translate(${n.x}, ${n.y})`}>
        <title>{tooltip}</title>
        <rect
          x={-tw / 2}
          y={-th / 2}
          width={tw}
          height={th}
          rx={12}
          fill={fill}
          fillOpacity={L ? 0.98 : 0.9}
          stroke={stroke}
          strokeWidth={L ? 2 : 1.8}
        />
        <text textAnchor="middle" y={4} fill={L ? "#4c1d95" : "#ede9fe"} fontSize={9} fontWeight={600} fontFamily="system-ui, sans-serif">
          {label}
        </text>
      </g>
    );
  }

  if (n.kind === "contributor") {
    const w = Math.max(72, label.length * 6.5);
    const h = 34;
    const fill = L ? "#eef2ff" : "#1e1b4b";
    const stroke = L ? "#4f46e5" : "#818cf8";
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
          fillOpacity={L ? 0.95 : 0.9}
          stroke={stroke}
          strokeWidth={L ? 2 : 1.8}
        />
        <text textAnchor="middle" y={5} fill={L ? "#312e81" : textMain} fontSize={fontTiny} fontFamily="ui-monospace, monospace">
          {label}
        </text>
      </g>
    );
  }

  if (n.kind === "issue") {
    const s = r * 1.15;
    const pts = `0,-${s} ${s},0 0,${s} -${s},0`;
    const fill = L ? "#ecfdf5" : "#064e3b";
    const stroke = L ? "#059669" : "#34d399";
    return wrap(
      <g transform={`translate(${n.x}, ${n.y})`}>
        <title>{tooltip}</title>
        <polygon points={pts} fill={fill} fillOpacity={L ? 0.95 : 0.88} stroke={stroke} strokeWidth={L ? 2.5 : 2.2} />
        <text textAnchor="middle" y={4} fill={L ? "#065f46" : textMain} fontSize={fontTiny} fontWeight={600} fontFamily="ui-monospace, monospace">
          {label}
        </text>
        {sub ? (
          <text textAnchor="middle" y={16} fill={textSub} fontSize={8} fontFamily="system-ui, sans-serif">
            {sub}
          </text>
        ) : null}
      </g>
    );
  }

  if (n.kind === "merge_commit") {
    const s = r * 1.05;
    const pts = `0,-${s} ${s},0 0,${s} -${s},0`;
    const fill = L ? "#f8fafc" : "#334155";
    const stroke = L ? "#64748b" : "#94a3b8";
    return wrap(
      <g transform={`translate(${n.x}, ${n.y})`}>
        <title>{tooltip}</title>
        <polygon
          points={pts}
          fill={fill}
          fillOpacity={L ? 0.95 : 0.85}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray="3 2"
        />
        <text textAnchor="middle" y={4} fill={L ? "#1e293b" : textMain} fontSize={7} fontFamily="ui-monospace, monospace">
          {label.length > 10 ? `${label.slice(0, 8)}…` : label}
        </text>
      </g>
    );
  }

  const fill = L ? "#ffffff" : "#0f172a";
  const stroke = accent;
  return wrap(
    <g transform={`translate(${n.x}, ${n.y})`}>
      {n.sublabel ? <title>{tooltip}</title> : <title>{n.label}</title>}
      <circle
        r={r}
        fill={fill}
        fillOpacity={L ? 1 : 0.95}
        stroke={stroke}
        strokeWidth={L ? 3 : 2.8}
      />
      <text textAnchor="middle" y={5} fill={textMain} fontSize={fontSmall} fontWeight={700} fontFamily="ui-monospace, monospace">
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
  vx,
  vy,
  vw,
  vh,
  edgeEls,
  nodeEls,
  className,
  theme,
  svgRef,
}: {
  w: number;
  h: number;
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  edgeEls: ReactNode;
  nodeEls: ReactNode;
  className?: string;
  theme: ThemeMode;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const bg = theme === "light" ? "#f8fafc" : "#0b0b12";
  return (
    <svg
      ref={svgRef}
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      className={className}
      role="img"
      aria-label="Knowledge graph"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={vx} y={vy} width={vw} height={vh} fill={bg} />
      <g>
        <g>{edgeEls}</g>
        <g>{nodeEls}</g>
      </g>
    </svg>
  );
}

type GraphView = { zoom: number; x: number; y: number };

function clampView(w: number, h: number, v: GraphView): GraphView {
  const z = clampZoom(v.zoom);
  const vw = w / z;
  const vh = h / z;
  /** When zoomed out, vw can exceed w; we must allow negative x/y so the graph can be centered in the viewport. */
  const minX = Math.min(0, w - vw);
  const maxX = Math.max(0, w - vw);
  const minY = Math.min(0, h - vh);
  const maxY = Math.max(0, h - vh);
  return {
    zoom: z,
    x: Math.min(maxX, Math.max(minX, v.x)),
    y: Math.min(maxY, Math.max(minY, v.y)),
  };
}

/** Initial / reset view: frame all nodes with padding instead of full empty viewBox. */
function computeFitView(w: number, h: number, nodes: LayoutNode[]): GraphView {
  if (!nodes.length) return { zoom: 1, x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const b = nodeBBox(n);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const pad = 64;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const zoomFit = Math.min(w / bw, h / bh);
  const zoom = clampZoom(zoomFit);
  const vw = w / zoom;
  const vh = h / zoom;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const x = cx - vw / 2;
  const y = cy - vh / 2;
  return clampView(w, h, { zoom, x, y });
}

function zoomViewAroundCenter(w: number, h: number, prev: GraphView, factor: number): GraphView {
  const old = clampView(w, h, prev);
  const oldVw = w / old.zoom;
  const oldVh = h / old.zoom;
  const cx = old.x + oldVw / 2;
  const cy = old.y + oldVh / 2;
  const newZ = clampZoom(old.zoom * factor);
  const nvw = w / newZ;
  const nvh = h / newZ;
  let nx = cx - nvw / 2;
  let ny = cy - nvh / 2;
  return clampView(w, h, { zoom: newZ, x: nx, y: ny });
}

/** Zoom so the graph point under the pointer stays under the pointer (trackpad / wheel). */
function zoomViewAroundPointer(
  w: number,
  h: number,
  prev: GraphView,
  factor: number,
  clientX: number,
  clientY: number,
  rect: DOMRectReadOnly
): GraphView {
  if (rect.width < 2 || rect.height < 2) {
    return zoomViewAroundCenter(w, h, prev, factor);
  }
  const old = clampView(w, h, prev);
  const oldVw = w / old.zoom;
  const oldVh = h / old.zoom;
  const mx = Math.min(Math.max(0, clientX - rect.left), rect.width);
  const my = Math.min(Math.max(0, clientY - rect.top), rect.height);
  const nx = mx / rect.width;
  const ny = my / rect.height;
  const graphX = old.x + nx * oldVw;
  const graphY = old.y + ny * oldVh;
  const newZ = clampZoom(old.zoom * factor);
  const nvw = w / newZ;
  const nvh = h / newZ;
  const vx = graphX - nx * nvw;
  const vy = graphY - ny * nvh;
  return clampView(w, h, { zoom: newZ, x: vx, y: vy });
}

export function KnowledgeDecisionsGraph({ refreshKey = 0 }: { refreshKey?: number }) {
  const { target, repoReady } = useRepo();
  const { theme } = useTheme();
  const [layout, setLayout] = useState<KnowledgeLayoutResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [view, setView] = useState<GraphView>({ zoom: 1, x: 0, y: 0 });
  const [modalView, setModalView] = useState<GraphView>({ zoom: 1, x: 0, y: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  const lastRepoKeyRef = useRef<string | null>(null);
  const prevRefreshKeyRef = useRef(refreshKey);
  const dimsRef = useRef({ w: 1000, h: 640 });
  const dragRef = useRef(false);
  const modalDragRef = useRef(false);
  const inlineSvgRef = useRef<SVGSVGElement>(null);
  const modalSvgRef = useRef<SVGSVGElement>(null);
  const inlinePanSurfaceRef = useRef<HTMLDivElement>(null);
  const modalPanSurfaceRef = useRef<HTMLDivElement>(null);
  const inlinePanLastClient = useRef<{ x: number; y: number } | null>(null);
  const modalPanLastClient = useRef<{ x: number; y: number } | null>(null);
  const inlinePanPixelAccum = useRef({ dx: 0, dy: 0 });
  const modalPanPixelAccum = useRef({ dx: 0, dy: 0 });
  const inlinePanRaf = useRef<number | null>(null);
  const modalPanRaf = useRef<number | null>(null);

  useEffect(() => {
    if (!repoReady) {
      setLayout(null);
      setErr(null);
      setLoading(false);
      lastRepoKeyRef.current = null;
      return;
    }

    const { owner, name } = target;
    const key = repoLayoutKey(owner, name);
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
      clearKnowledgeLayoutCache(owner, name);
    }

    const cached =
      !refreshBumped
        ? knowledgeLayoutCache.get(key) ?? loadKnowledgeLayoutCache(owner, name)
        : null;
    if (cached?.nodes?.length) {
      knowledgeLayoutCache.set(key, cached);
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

    void fetchKnowledgeLayout(owner, name)
      .then((res) => {
        if (cancelled) return;
        knowledgeLayoutCache.set(key, res);
        saveKnowledgeLayoutCache(owner, name, res);
        setLayout(res);
        setErr(null);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not load knowledge graph";
        setErr(msg);
        setLayout((prev) => {
          if (prev?.nodes?.length) return prev;
          const fromMemory = knowledgeLayoutCache.get(key);
          if (fromMemory?.nodes?.length) return fromMemory;
          const fromLs = loadKnowledgeLayoutCache(owner, name);
          if (fromLs?.nodes?.length) return fromLs;
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

  const { w, h, edgeEls, nodeEls } = useGraphElements(layout, theme);
  dimsRef.current = { w, h };

  const layoutSig =
    layout?.viewBox && layout.nodes?.length
      ? `${layout.viewBox.w}x${layout.viewBox.h}-${layout.nodes.length}-${layout.edges?.length ?? 0}`
      : "";
  useEffect(() => {
    if (!layoutSig || !layout?.nodes?.length) return;
    const fit = computeFitView(w, h, layout.nodes);
    setView(fit);
    setModalView(fit);
  }, [layoutSig, w, h, layout]);

  const cv = useMemo(() => clampView(w, h, view), [w, h, view]);
  const vw = w / cv.zoom;
  const vh = h / cv.zoom;

  const modalCv = useMemo(() => clampView(w, h, modalView), [w, h, modalView]);
  const mvw = w / modalCv.zoom;
  const mvh = h / modalCv.zoom;

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

  const zoomIn = useCallback(() => {
    const { w: W, h: H } = dimsRef.current;
    setView((v) => zoomViewAroundCenter(W, H, v, 1 + ZOOM_STEP));
  }, []);
  const zoomOut = useCallback(() => {
    const { w: W, h: H } = dimsRef.current;
    setView((v) => zoomViewAroundCenter(W, H, v, 1 / (1 + ZOOM_STEP)));
  }, []);
  const zoomReset = useCallback(() => {
    const { w: W, h: H } = dimsRef.current;
    const nodes = layout?.nodes;
    if (nodes?.length) setView(computeFitView(W, H, nodes));
    else setView({ zoom: 1, x: 0, y: 0 });
  }, [layout]);

  const modalZoomIn = useCallback(() => {
    const { w: W, h: H } = dimsRef.current;
    setModalView((v) => zoomViewAroundCenter(W, H, v, 1 + ZOOM_STEP));
  }, []);
  const modalZoomOut = useCallback(() => {
    const { w: W, h: H } = dimsRef.current;
    setModalView((v) => zoomViewAroundCenter(W, H, v, 1 / (1 + ZOOM_STEP)));
  }, []);
  const modalZoomReset = useCallback(() => {
    const { w: W, h: H } = dimsRef.current;
    const nodes = layout?.nodes;
    if (nodes?.length) setModalView(computeFitView(W, H, nodes));
    else setModalView({ zoom: 1, x: 0, y: 0 });
  }, [layout]);

  /** Pan on background/edges; on PR/issue links use Ctrl/Cmd+drag or middle mouse (middle on link = open in new tab). */
  const wantsPan = (e: React.PointerEvent) => {
    const el = e.target as Element | null;
    const onLink = Boolean(el?.closest?.("a"));
    if (e.button === 1) return !onLink;
    if (e.button !== 0) return false;
    if (onLink) return e.ctrlKey || e.metaKey;
    return true;
  };

  const flushInlinePan = useCallback(() => {
    const acc = inlinePanPixelAccum.current;
    if (acc.dx === 0 && acc.dy === 0) return;
    const dx = acc.dx;
    const dy = acc.dy;
    acc.dx = 0;
    acc.dy = 0;
    const svg = inlineSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const { w: W, h: H } = dimsRef.current;
    setView((v) => {
      const vbw = W / v.zoom;
      const vbh = H / v.zoom;
      const sx = -(dx / rect.width) * vbw;
      const sy = -(dy / rect.height) * vbh;
      return clampView(W, H, { ...v, x: v.x + sx, y: v.y + sy });
    });
  }, []);

  const flushModalPan = useCallback(() => {
    const acc = modalPanPixelAccum.current;
    if (acc.dx === 0 && acc.dy === 0) return;
    const dx = acc.dx;
    const dy = acc.dy;
    acc.dx = 0;
    acc.dy = 0;
    const svg = modalSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const { w: W, h: H } = dimsRef.current;
    setModalView((v) => {
      const vbw = W / v.zoom;
      const vbh = H / v.zoom;
      const sx = -(dx / rect.width) * vbw;
      const sy = -(dy / rect.height) * vbh;
      return clampView(W, H, { ...v, x: v.x + sx, y: v.y + sy });
    });
  }, []);

  const onInlinePointerDown = useCallback((e: React.PointerEvent) => {
    if (!wantsPan(e)) return;
    e.preventDefault();
    dragRef.current = true;
    inlinePanLastClient.current = { x: e.clientX, y: e.clientY };
    inlinePanPixelAccum.current = { dx: 0, dy: 0 };
    if (inlinePanRaf.current != null) {
      cancelAnimationFrame(inlinePanRaf.current);
      inlinePanRaf.current = null;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onInlinePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current || !inlinePanLastClient.current || !inlineSvgRef.current) return;
      const last = inlinePanLastClient.current;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      inlinePanLastClient.current = { x: e.clientX, y: e.clientY };
      inlinePanPixelAccum.current.dx += dx;
      inlinePanPixelAccum.current.dy += dy;
      if (inlinePanRaf.current == null) {
        inlinePanRaf.current = requestAnimationFrame(() => {
          inlinePanRaf.current = null;
          flushInlinePan();
        });
      }
    },
    [flushInlinePan]
  );
  const onInlinePointerUp = useCallback(() => {
    if (inlinePanRaf.current != null) {
      cancelAnimationFrame(inlinePanRaf.current);
      inlinePanRaf.current = null;
    }
    flushInlinePan();
    dragRef.current = false;
    inlinePanLastClient.current = null;
  }, [flushInlinePan]);

  const onModalPointerDown = useCallback((e: React.PointerEvent) => {
    if (!wantsPan(e)) return;
    e.preventDefault();
    modalDragRef.current = true;
    modalPanLastClient.current = { x: e.clientX, y: e.clientY };
    modalPanPixelAccum.current = { dx: 0, dy: 0 };
    if (modalPanRaf.current != null) {
      cancelAnimationFrame(modalPanRaf.current);
      modalPanRaf.current = null;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onModalPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!modalDragRef.current || !modalPanLastClient.current || !modalSvgRef.current) return;
      const last = modalPanLastClient.current;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      modalPanLastClient.current = { x: e.clientX, y: e.clientY };
      modalPanPixelAccum.current.dx += dx;
      modalPanPixelAccum.current.dy += dy;
      if (modalPanRaf.current == null) {
        modalPanRaf.current = requestAnimationFrame(() => {
          modalPanRaf.current = null;
          flushModalPan();
        });
      }
    },
    [flushModalPan]
  );
  const onModalPointerUp = useCallback(() => {
    if (modalPanRaf.current != null) {
      cancelAnimationFrame(modalPanRaf.current);
      modalPanRaf.current = null;
    }
    flushModalPan();
    modalDragRef.current = false;
    modalPanLastClient.current = null;
  }, [flushModalPan]);

  const hasGraph = Boolean(layout?.nodes?.length);
  const canRenderSvg = edgeEls != null && nodeEls != null && hasGraph;

  /** Wheel zoom toward cursor; non-passive so the page doesn’t scroll while over the graph. */
  useEffect(() => {
    const el = inlinePanSurfaceRef.current;
    if (!el || !canRenderSvg) return;
    const onWheel = (e: WheelEvent) => {
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      const svg = inlineSvgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const { w: W, h: H } = dimsRef.current;
      const factor = delta < 0 ? 1 + ZOOM_STEP * 0.85 : 1 / (1 + ZOOM_STEP * 0.85);
      setView((v) => zoomViewAroundPointer(W, H, v, factor, e.clientX, e.clientY, rect));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [canRenderSvg, w, h]);

  useEffect(() => {
    const el = modalPanSurfaceRef.current;
    if (!el || !modalOpen || !canRenderSvg) return;
    const onWheel = (e: WheelEvent) => {
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      const svg = modalSvgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const { w: W, h: H } = dimsRef.current;
      const factor = delta < 0 ? 1 + ZOOM_STEP * 0.85 : 1 / (1 + ZOOM_STEP * 0.85);
      setModalView((v) => zoomViewAroundPointer(W, H, v, factor, e.clientX, e.clientY, rect));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [modalOpen, canRenderSvg, w, h]);

  if (!repoReady) return null;

  const showLoadingOverlay = loading && !hasGraph;

  return (
    <div className="rounded-sm border border-gitlore-border bg-gitlore-surface">
      <div className="border-b border-gitlore-border px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-gitlore-text">Knowledge graph</h3>
            <p className="mt-0.5 max-w-[52rem] text-xs leading-relaxed text-gitlore-text-secondary">
              Ingested PR decisions, themes, issues, authors, and merge history — the same evidence the side chat uses.{" "}
              <span className="text-gitlore-text">Drag</span> to pan (on nodes: use Ctrl/Cmd+drag or middle-drag on empty
              area). <span className="text-gitlore-text">Scroll</span> zooms toward the pointer. Green links = shared closing
              issue; dotted = merge-time neighbors; violet dashed = PR → theme.
            </p>
          </div>
        </div>
      </div>

      <div className="relative w-full p-2 md:p-3">
        {showLoadingOverlay && (
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
                zoom={cv.zoom}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onReset={zoomReset}
                onExpand={() => {
                  setModalView(cv);
                  setModalOpen(true);
                }}
              />
            </div>
            <div
              ref={inlinePanSurfaceRef}
              className="touch-none select-none overflow-hidden rounded-sm border border-gitlore-border/60 bg-gitlore-code/20 pt-10 cursor-grab active:cursor-grabbing [&_a]:cursor-pointer"
              onPointerDown={onInlinePointerDown}
              onPointerMove={onInlinePointerMove}
              onPointerUp={onInlinePointerUp}
              onPointerCancel={onInlinePointerUp}
              onLostPointerCapture={onInlinePointerUp}
            >
              <GraphSvg
                svgRef={inlineSvgRef}
                w={w}
                h={h}
                vx={cv.x}
                vy={cv.y}
                vw={vw}
                vh={vh}
                edgeEls={edgeEls}
                nodeEls={nodeEls}
                theme={theme}
                className="block h-[min(48vh,520px)] min-h-[220px] w-full cursor-grab active:cursor-grabbing [&_a]:cursor-pointer"
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
              <span className="text-violet-500 dark:text-violet-300">▬</span> theme (from ingest) &nbsp;
              <span className="text-indigo-600 dark:text-indigo-300">■</span> contributor &nbsp;
              <span className="text-emerald-600 dark:text-emerald-400">◆</span> issue &nbsp;
              <span className="text-slate-500 dark:text-slate-400">◇</span> merge &nbsp;
              <span className="text-emerald-600 dark:text-emerald-400">━</span> shared issue &nbsp;
              <span className="text-slate-500 dark:text-slate-400">┅</span> time order — open nodes on GitHub.
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
                  zoom={modalCv.zoom}
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
              ref={modalPanSurfaceRef}
              className="min-h-0 flex-1 touch-none select-none overflow-hidden bg-gitlore-code/20 p-2 md:p-4 cursor-grab active:cursor-grabbing [&_a]:cursor-pointer"
              onPointerDown={onModalPointerDown}
              onPointerMove={onModalPointerMove}
              onPointerUp={onModalPointerUp}
              onPointerCancel={onModalPointerUp}
              onLostPointerCapture={onModalPointerUp}
            >
              <GraphSvg
                svgRef={modalSvgRef}
                w={w}
                h={h}
                vx={modalCv.x}
                vy={modalCv.y}
                vw={mvw}
                vh={mvh}
                edgeEls={edgeEls}
                nodeEls={nodeEls}
                theme={theme}
                className="block h-[75vh] w-full cursor-grab active:cursor-grabbing [&_a]:cursor-pointer"
              />
            </div>
            <p className="shrink-0 border-t border-gitlore-border px-4 py-2 text-center text-[10px] text-gitlore-text-secondary">
              Drag to pan · scroll zooms under cursor · Ctrl/Cmd+drag on nodes to pan · Esc or backdrop to close
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
