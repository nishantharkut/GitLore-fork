import { useRef, useEffect, useCallback } from "react";
import { FadeIn } from "../effects/FadeIn";

type SimNode = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseR: number;
  color: string;
  label: string;
};

const N = 25;
/** Main phase: attraction + repulsion (graph structure). */
const SIM_FRAMES = 56;
/** Final phase: repulsion + walls only — spreads nodes apart with visible gaps. */
const SPARSE_FRAMES = 36;
const TOTAL_PHYSICS_FRAMES = SIM_FRAMES + SPARSE_FRAMES;
const EDGE_OPACITY = 0.12;
const MIN_SIZE = 64;

function randomGraph(w: number, h: number): { nodes: SimNode[]; edges: [number, number][] } {
  const nodes: SimNode[] = [];
  const rand = () => Math.random();
  const pad = 28;
  const cx = w / 2;
  const cy = h / 2;
  const innerW = Math.max(40, w - pad * 2);
  const innerH = Math.max(40, h - pad * 2);
  /* Start from a wider disk so the sparse phase does not clip nodes at the walls. */
  const spread = Math.min(innerW, innerH) * 0.52;
  const golden = 2.39996322972865332; // ~π * (3 − √5); fills disk evenly, avoids a tight center blob
  for (let i = 0; i < N; i++) {
    const roll = rand();
    const color = roll < 0.8 ? "#34D399" : roll < 0.95 ? "#FBBF24" : "#F87171";
    const baseR = 4 + rand() * 6;
    const t = i + rand() * 0.35;
    const r = spread * Math.sqrt(t / N);
    const ang = t * golden;
    let x = cx + Math.cos(ang) * r + (rand() - 0.5) * 12;
    let y = cy + Math.sin(ang) * r + (rand() - 0.5) * 12;
    x = Math.max(pad + baseR, Math.min(w - pad - baseR, x));
    y = Math.max(pad + baseR, Math.min(h - pad - baseR, y));
    nodes.push({
      x,
      y,
      vx: 0,
      vy: 0,
      r: baseR,
      baseR,
      color,
      label: `auth_service.py · ${Math.floor(rand() * 80)} changes · ${2 + Math.floor(rand() * 5)} authors`,
    });
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const k = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < k; j++) {
      const t = Math.floor(rand() * N);
      if (t !== i) edges.push([i, t]);
    }
  }
  return { nodes, edges };
}

type Sim = {
  nodes: SimNode[];
  edges: [number, number][];
  raf: number | null;
  physicsSteps: number;
  settled: boolean;
};

function stepPhysics(sim: Sim, w: number, h: number) {
  const { nodes, edges } = sim;
  const pad = 26;
  const sparsePhase = sim.physicsSteps >= SIM_FRAMES;
  const kRep = sparsePhase ? 520 : 300;
  const kAtt = sparsePhase ? 0 : 0.0042;
  const kWall = sparsePhase ? 0.08 : 0.055;
  const damp = sparsePhase ? 0.82 : 0.86;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = kRep / (dist * dist);
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      nodes[i].vx -= fx;
      nodes[i].vy -= fy;
      nodes[j].vx += fx;
      nodes[j].vy += fy;
    }
  }
  if (!sparsePhase) {
    for (const [a, b] of edges) {
      const dx = nodes[b].x - nodes[a].x;
      const dy = nodes[b].y - nodes[a].y;
      nodes[a].vx += dx * kAtt;
      nodes[a].vy += dy * kAtt;
      nodes[b].vx -= dx * kAtt;
      nodes[b].vy -= dy * kAtt;
    }
  }
  for (const n of nodes) {
    // No center gravity: that collapsed everything to the middle. Soft walls keep the graph in the frame
    // while repulsion keeps nodes visually sparse.
    if (n.x < pad) n.vx += (pad - n.x) * kWall;
    if (n.x > w - pad) n.vx -= (n.x - (w - pad)) * kWall;
    if (n.y < pad) n.vy += (pad - n.y) * kWall;
    if (n.y > h - pad) n.vy -= (n.y - (h - pad)) * kWall;

    n.vx *= damp;
    n.vy *= damp;
    n.x += n.vx;
    n.y += n.vy;
    n.r = n.baseR;
    n.x = Math.max(n.r, Math.min(w - n.r, n.x));
    n.y = Math.max(n.r, Math.min(h - n.r, n.y));
  }
}

function renderGraph(canvas: HTMLCanvasElement, sim: Sim) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  if (w < 8 || h < 8) return;

  const { nodes, edges } = sim;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const light = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light";
  ctx.strokeStyle = light ? `rgba(0,0,0,${EDGE_OPACITY * 0.9})` : `rgba(255,255,255,${EDGE_OPACITY})`;
  ctx.lineWidth = 1;
  for (const [a, b] of edges) {
    ctx.beginPath();
    ctx.moveTo(nodes[a].x, nodes[a].y);
    ctx.lineTo(nodes[b].x, nodes[b].y);
    ctx.stroke();
  }

  for (const n of nodes) {
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = n.color;
    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function clearCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
}

function pickNodeIndex(sim: Sim, mx: number, my: number): number | null {
  for (let i = sim.nodes.length - 1; i >= 0; i--) {
    const n = sim.nodes[i];
    const dx = mx - n.x;
    const dy = my - n.y;
    if (dx * dx + dy * dy <= n.r * n.r * 4) return i;
  }
  return null;
}

export type KnowledgeGraphCanvasProps = {
  /** Outer wrapper (sets available space for layout / resize) */
  className?: string;
  /** Tailwind classes on the canvas (height, min-height, radius) */
  canvasClassName?: string;
  showCaption?: boolean;
  captionClassName?: string;
  /** Pin caption over the bottom of the canvas so the graph can use full height */
  captionOverlay?: boolean;
};

export function KnowledgeGraphCanvas({
  className = "",
  canvasClassName = "",
  showCaption = true,
  captionClassName = "mt-2 text-center font-body text-[11px] text-[var(--text-ghost)] md:text-[12px]",
  captionOverlay = false,
}: KnowledgeGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Sim | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(false);
  const runningRef = useRef(false);
  const layoutRetryRef = useRef(0);
  const resizeRafRef = useRef<number | null>(null);
  const dragRef = useRef<{ nodeIndex: number; offsetX: number; offsetY: number; pointerId: number } | null>(null);

  const tick = useCallback(() => {
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas || !visibleRef.current) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    if (sim.physicsSteps < TOTAL_PHYSICS_FRAMES) {
      stepPhysics(sim, w, h);
      sim.physicsSteps += 1;
    }

    renderGraph(canvas, sim);

    if (sim.physicsSteps >= TOTAL_PHYSICS_FRAMES) {
      sim.settled = true;
      sim.raf = null;
      runningRef.current = false;
    } else {
      sim.raf = requestAnimationFrame(tick);
    }
  }, []);

  const stopSim = useCallback(() => {
    const sim = simRef.current;
    if (sim?.raf != null) {
      cancelAnimationFrame(sim.raf);
      sim.raf = null;
    }
    simRef.current = null;
    runningRef.current = false;
    dragRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = "";
      clearCanvas(canvas);
    }
  }, []);

  const startSim = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !visibleRef.current) return;

    const rect = wrap.getBoundingClientRect();
    const cssW = Math.floor(rect.width);
    const cssH = Math.floor(rect.height || canvas.offsetHeight || 280);

    if (cssW < MIN_SIZE || cssH < MIN_SIZE) {
      if (layoutRetryRef.current < 48) {
        layoutRetryRef.current += 1;
        requestAnimationFrame(() => {
          if (visibleRef.current) startSim();
        });
      }
      return;
    }
    layoutRetryRef.current = 0;

    const prev = simRef.current;
    if (prev?.raf != null) cancelAnimationFrame(prev.raf);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const { nodes, edges } = randomGraph(cssW, cssH);
    simRef.current = {
      nodes,
      edges,
      raf: null,
      physicsSteps: 0,
      settled: false,
    };
    dragRef.current = null;
    runningRef.current = true;
    tick();
  }, [tick]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const clientToLocal = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return { mx: clientX - rect.left, my: clientY - rect.top };
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          layoutRetryRef.current = 0;
          requestAnimationFrame(() => startSim());
        } else {
          layoutRetryRef.current = 0;
          stopSim();
          if (tooltipRef.current) tooltipRef.current.style.display = "none";
        }
      },
      { threshold: 0.08, rootMargin: "80px 0px" },
    );

    observer.observe(wrap);

    const ro = new ResizeObserver(() => {
      if (!visibleRef.current) return;
      if (resizeRafRef.current != null) cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        stopSim();
        layoutRetryRef.current = 0;
        startSim();
      });
    });
    ro.observe(wrap);

    const onWinResize = () => {
      if (!visibleRef.current) return;
      startSim();
    };
    window.addEventListener("resize", onWinResize);

    const updateTooltip = (clientX: number, clientY: number) => {
      const sim = simRef.current;
      const tip = tooltipRef.current;
      if (!sim || !tip || dragRef.current) {
        if (tip) tip.style.display = "none";
        return;
      }
      const { mx, my } = clientToLocal(clientX, clientY);
      const hit = pickNodeIndex(sim, mx, my);
      if (hit != null) {
        tip.style.display = "block";
        tip.style.left = `${clientX + 12}px`;
        tip.style.top = `${clientY + 12}px`;
        tip.textContent = sim.nodes[hit].label;
      } else {
        tip.style.display = "none";
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const sim = simRef.current;
      if (!sim?.settled || !canvas) return;

      const { mx, my } = clientToLocal(e.clientX, e.clientY);
      const drag = dragRef.current;

      if (drag && e.pointerId === drag.pointerId) {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        const n = sim.nodes[drag.nodeIndex];
        n.x = mx - drag.offsetX;
        n.y = my - drag.offsetY;
        n.x = Math.max(n.r, Math.min(w - n.r, n.x));
        n.y = Math.max(n.r, Math.min(h - n.r, n.y));
        renderGraph(canvas, sim);
        if (tooltipRef.current) tooltipRef.current.style.display = "none";
        return;
      }

      if (!dragRef.current) {
        const hit = pickNodeIndex(sim, mx, my);
        canvas.style.cursor = hit != null ? "grab" : "default";
        updateTooltip(e.clientX, e.clientY);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const sim = simRef.current;
      if (!sim?.settled || e.button !== 0) return;
      const { mx, my } = clientToLocal(e.clientX, e.clientY);
      const hit = pickNodeIndex(sim, mx, my);
      if (hit == null) return;
      const n = sim.nodes[hit];
      dragRef.current = {
        nodeIndex: hit,
        offsetX: mx - n.x,
        offsetY: my - n.y,
        pointerId: e.pointerId,
      };
      canvas.style.cursor = "grabbing";
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
      e.preventDefault();
    };

    const endDrag = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragRef.current = null;
      canvas.style.cursor = "default";
      const sim = simRef.current;
      if (sim?.settled) {
        const { mx, my } = clientToLocal(e.clientX, e.clientY);
        const hit = pickNodeIndex(sim, mx, my);
        canvas.style.cursor = hit != null ? "grab" : "default";
      }
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", () => {
      if (dragRef.current) return;
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
      canvas.style.cursor = "";
    });

    return () => {
      observer.disconnect();
      ro.disconnect();
      if (resizeRafRef.current != null) cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
      window.removeEventListener("resize", onWinResize);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      stopSim();
    };
  }, [startSim, stopSim]);

  const caption = showCaption ? (
    <p
      className={
        captionOverlay
          ? "pointer-events-none absolute bottom-0 left-0 right-0 z-[1] border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--code-bg)_92%,transparent)] px-3 py-2.5 text-center font-body text-[10px] leading-snug text-[var(--text-ghost)] backdrop-blur-[6px] md:text-[11px]"
          : captionClassName
      }
    >
      Hover a node for details · <span className="text-[var(--text-secondary)]">Drag</span> to pull files and watch how PRs link them
    </p>
  ) : null;

  const graph = (
    <div
      ref={wrapRef}
      className={`relative w-full min-h-0 ${captionOverlay ? "min-h-[12rem] flex-1" : ""} ${className}`.trim()}
    >
      <canvas
        ref={canvasRef}
        className={`graph-canvas block w-full touch-none select-none bg-[var(--code-bg)] ${captionOverlay ? "h-full min-h-[12rem] rounded-none border-0" : "rounded-[6px] border border-[var(--border)]"} ${canvasClassName}`.trim()}
        aria-label="Interactive codebase knowledge graph: hover nodes for details, drag to rearrange"
      />
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed z-[60] hidden max-w-[240px] rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-code text-[11px] font-normal tracking-[0.01em] text-[var(--text)] [overflow-wrap:anywhere]"
      />
      {captionOverlay && caption}
    </div>
  );

  if (captionOverlay) {
    return <div className="relative flex min-h-0 w-full flex-1 flex-col">{graph}</div>;
  }

  return (
    <>
      {graph}
      {caption}
    </>
  );
}

export default function KnowledgeGraph() {
  return (
    <section className="py-16 md:py-24">
      <div className="landing-container">
        <FadeIn direction="up">
          <div className="section-label">
            <p>Repo intelligence</p>
          </div>
          <p className="font-heading mb-8 mt-2 text-[20px] font-medium leading-[1.25] tracking-[-0.02em] text-[var(--text)] md:text-[24px]">
            Your codebase as a knowledge graph.
          </p>
          <KnowledgeGraphCanvas
            className="min-h-[320px] md:min-h-[420px]"
            canvasClassName="h-[min(420px,55vw)] min-h-[320px] md:min-h-[420px]"
            captionClassName="mt-3 text-center font-body text-[12px] text-[var(--text-ghost)]"
          />
        </FadeIn>
      </div>
    </section>
  );
}



