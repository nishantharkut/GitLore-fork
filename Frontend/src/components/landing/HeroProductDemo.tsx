import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  GutterMarker,
  WidgetType,
  gutterLineClass,
  lineNumbers,
} from "@codemirror/view";
import gsap from "gsap";
import { animate, stagger } from "animejs";

const DEMO_PYTHON = `import time
from collections import defaultdict

class RateLimiter:
    def __init__(self, max_requests=100, window=60):
        self.requests = defaultdict(list)
        self.max_requests = max_requests
        self.window = window
    
    def is_allowed(self, client_id: str) -> bool:
        now = time.time()
        window_start = now - self.window
        
        # Clean expired requests
        self.requests[client_id] = [
            req for req in self.requests[client_id]
            if req > window_start
        ]
        
        if len(self.requests[client_id]) < self.max_requests:
            self.requests[client_id].append(now)
            return True
        return False`;

const IF_LEN_LINE = 17;

class Line5Gutter extends GutterMarker {
  elementClass = "gitlore-clickable-line";
  eq(other: GutterMarker): boolean {
    return other instanceof Line5Gutter;
  }
}

class CommentBadgeWidget extends WidgetType {
  constructor(readonly onBadgeClick: () => void) {
    super();
  }

  eq(other: CommentBadgeWidget): boolean {
    return other === this;
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "inline-comment-badge";
    wrap.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onBadgeClick();
    });
    const dot = document.createElement("span");
    dot.className = "badge-dot";
    const t = document.createElement("span");
    t.textContent = "memory: in-memory only";
    const a = document.createElement("span");
    a.className = "badge-author";
    a.textContent = "@senior-dev";
    wrap.append(dot, t, a);
    requestAnimationFrame(() => {
      animate(dot, {
        opacity: [1, 0.3],
        scale: [1, 0.8],
        duration: 1200,
        loop: true,
        ease: "inOutSine",
        alternate: true,
      });
    });
    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}

function line5GutterSet(state: EditorState) {
  const l5 = state.doc.line(5);
  const b = new RangeSetBuilder<GutterMarker>();
  b.add(l5.from, l5.to, new Line5Gutter());
  return b.finish();
}

const clickableLine5 = gutterLineClass.compute(["doc"], line5GutterSet);

function makeBadgeField(onClick: () => void) {
  return StateField.define<DecorationSet>({
    create(state) {
      const line = state.doc.line(15);
      return Decoration.set([
        Decoration.widget({
          widget: new CommentBadgeWidget(onClick),
          block: true,
          side: 1,
        }).range(line.to),
      ]);
    },
    update(decs, tr) {
      if (!tr.docChanged) return decs.map(tr.changes);
      const line = tr.state.doc.line(15);
      return Decoration.set([
        Decoration.widget({
          widget: new CommentBadgeWidget(onClick),
          block: true,
          side: 1,
        }).range(line.to),
      ]);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

type PanelMode = "empty" | "comment" | "line";

function clearLineHighlights(root: HTMLElement | null) {
  if (!root) return;
  root.querySelectorAll(".cm-line").forEach((el) => {
    gsap.set(el, { clearProps: "backgroundColor" });
  });
}

const HeroProductDemo = () => {
  const [panelMode, setPanelMode] = useState<PanelMode>("empty");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 768);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelInnerRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const onLine5Ref = useRef<() => void>(() => {});

  const badgeClickRef = useRef(() => {});
  badgeClickRef.current = () => {
    clearLineHighlights(editorRef.current);
    setPanelMode("comment");
    setMobileOpen(true);
    const view = editorRef.current?.querySelector(".cm-editor") as HTMLElement | undefined;
    const lineEl = view?.querySelectorAll(".cm-line")[IF_LEN_LINE - 1] as HTMLElement | undefined;
    if (lineEl) gsap.to(lineEl, { backgroundColor: "rgba(201, 168, 76, 0.15)", duration: 0.3 });
    requestAnimationFrame(() => {
      const inner = panelInnerRef.current;
      if (!inner) return;
      gsap.fromTo(inner, { x: 24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "power2.out" });
    });
  };

  const onLine5 = useCallback(() => {
    clearLineHighlights(editorRef.current);
    setPanelMode("line");
    setMobileOpen(true);
    const view = editorRef.current?.querySelector(".cm-editor") as HTMLElement | undefined;
    const lineEl = view?.querySelectorAll(".cm-line")[4] as HTMLElement | undefined;
    if (lineEl) gsap.to(lineEl, { backgroundColor: "rgba(201, 168, 76, 0.15)", duration: 0.3 });
    requestAnimationFrame(() => {
      const inner = panelInnerRef.current;
      if (!inner) return;
      gsap.fromTo(inner, { x: 24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "power2.out" });
    });
  }, []);

  onLine5Ref.current = onLine5;

  const closeMobilePanel = useCallback(() => {
    clearLineHighlights(editorRef.current);
    setPanelMode("empty");
    setMobileOpen(false);
  }, []);

  const extensions = useMemo(
    () => [
      python(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      clickableLine5,
      lineNumbers({
        domEventHandlers: {
          mousedown(view, line) {
            const n = view.state.doc.lineAt(line.from).number;
            if (n === 5) {
              onLine5Ref.current();
              return true;
            }
            return false;
          },
        },
      }),
      makeBadgeField(() => badgeClickRef.current()),
      EditorView.theme({
        ".inline-comment-badge": {
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          marginTop: "4px",
          marginLeft: "48px",
          padding: "4px 10px",
          borderRadius: "4px",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "11px",
          letterSpacing: "0.01em",
          color: "var(--warning)",
          background: "var(--warning-dim)",
          border: "1px solid rgba(251, 191, 36, 0.3)",
        },
        ".badge-author": { opacity: 0.85 },
        ".badge-dot": {
          display: "inline-block",
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: "var(--warning)",
        },
      }),
    ],
    []
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const fn = () => setIsNarrow(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  useEffect(() => {
    if (panelMode !== "comment") return;
    const root = panelInnerRef.current;
    if (!root) return;
    const lines = root.querySelectorAll(".diff-line");
    if (!lines.length) return;
    animate(lines, {
      opacity: [0, 1],
      x: [-8, 0],
      duration: 200,
      delay: stagger(40),
      ease: "outQuart",
    });
  }, [panelMode]);

  useEffect(() => {
    if (panelMode !== "comment") return;
    const badge = panelInnerRef.current?.querySelector(".confidence-pulse");
    if (!badge) return;
    const anim = animate(badge, {
      opacity: [1, 0.6],
      loop: true,
      alternate: true,
      duration: 2000,
      ease: "inOutSine",
    });
    return () => { anim.cancel(); };
  }, [panelMode]);

  useEffect(() => {
    if (panelMode !== "line" || !pathRef.current) return;
    const path = pathRef.current;
    const nodes = panelInnerRef.current?.querySelectorAll(".story-node");
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    gsap.to(path, { strokeDashoffset: 0, duration: 1, ease: "power2.inOut" });
    if (nodes && nodes.length) {
      gsap.from(nodes, {
        scale: 0,
        duration: 0.45,
        ease: "back.out(1.5)",
        stagger: 0.2,
        transformOrigin: "50% 50%",
      });
    }
  }, [panelMode]);

  useLayoutEffect(() => {
    const sheet = panelRef.current;
    if (!sheet) return;
    if (!isNarrow) {
      gsap.set(sheet, { clearProps: "transform" });
      return;
    }
    gsap.set(sheet, { y: mobileOpen ? "0%" : "100%" });
  }, [isNarrow]);

  useEffect(() => {
    const sheet = panelRef.current;
    if (!sheet) return;
    if (isNarrow) {
      gsap.to(sheet, { y: mobileOpen ? "0%" : "100%", duration: 0.4, ease: "power3.out" });
    } else {
      gsap.set(sheet, { clearProps: "transform" });
    }
  }, [isNarrow, mobileOpen]);

  useEffect(() => {
    if (!isNarrow || !mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobilePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isNarrow, mobileOpen, closeMobilePanel]);

  useEffect(() => {
    if (!isNarrow || !mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isNarrow, mobileOpen]);

  return (
    <div
      ref={editorRef}
      className="hero-demo-frame relative z-0 w-full max-w-[960px] overflow-hidden rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] shadow-[0_0_0_1px_var(--border),0_40px_80px_rgba(0,0,0,0.5)]"
    >
      <div className="flex h-10 min-w-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--elevated)] px-2 sm:gap-3 sm:px-4">
        <div className="flex shrink-0 gap-1.5">
          <span className="h-[9px] w-[9px] rounded-full bg-[#FF5F57]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#FEBC2E]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#28C840]" />
        </div>
        <span className="min-w-0 flex-1 truncate text-center font-code text-[10px] font-normal tracking-[0.01em] text-[var(--text-ghost)] sm:text-left sm:text-[11px]">
          gitlore-demo-fintech / rate_limiter.py
        </span>
        <span className="hidden max-w-[42%] shrink-0 truncate font-code text-[10px] font-normal tracking-[0.01em] text-[var(--text-ghost)] sm:inline sm:text-[11px]">
          PR #2 - Add rate limiting
        </span>
      </div>

      {isNarrow && mobileOpen && (
        <button
          type="button"
          aria-label="Close demo panel"
          className="fixed inset-0 z-[90] bg-[#0A0A0F]/55"
          onClick={closeMobilePanel}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_380px] max-md:max-h-[70vh] max-md:overflow-y-auto">
        <div className="min-h-[280px] min-w-0">
          <CodeMirror
            value={DEMO_PYTHON}
            theme="dark"
            extensions={extensions}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            className="gitlore-cm !h-full min-h-[280px]"
          />
        </div>

        <div
          ref={panelRef}
          className={`flex flex-col border-[var(--border)] bg-[var(--elevated)] ${
            isNarrow
              ? `fixed bottom-0 left-0 right-0 z-[100] max-h-[60vh] rounded-t-[16px] border-t pt-3 will-change-transform ${mobileOpen ? "pointer-events-auto" : "pointer-events-none"}`
              : "min-h-[320px] border-t p-5 md:relative md:border-l md:border-t-0"
          }`}
        >
          {isNarrow && <div className="mx-auto mb-3 h-1 w-10 rounded-[2px] bg-[var(--border-strong)]" />}
          <div ref={panelInnerRef} className="flex flex-1 flex-col px-5 pb-5 md:px-0 md:pb-0">
            {panelMode === "empty" && (
              <div className="m-auto text-center text-[var(--text-ghost)]">
                <span className="mx-auto mb-2 block font-code text-[24px] font-medium leading-none text-[var(--accent)] opacity-70" aria-hidden>
                  |
                </span>
                <p className="font-heading text-[13px] font-medium leading-relaxed">
                  Click a line number
                  <br />
                  to see why it exists.
                </p>
                <p className="mt-4 font-heading text-[13px] font-medium leading-relaxed">
                  Click a comment
                  <br />
                  to understand what it means.
                </p>
              </div>
            )}

            {panelMode === "comment" && (
              <div className="flex flex-1 flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-code text-[10px] font-medium uppercase tracking-widest text-[var(--text-ghost)]">PATTERN DETECTED</span>
                  <span className="confidence-pulse rounded-[3px] border border-[rgba(52,211,153,0.3)] bg-[var(--success-dim)] px-2 py-[2px] font-body text-[10px] font-medium text-[var(--success)]">
                    HIGH
                  </span>
                </div>
                <div className="h-px w-full bg-[var(--border-strong)]" />
                <h3 className="font-heading text-[15px] font-semibold text-[var(--text)]">In-Memory State Not Persistent</h3>
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--border)] font-code text-[11px] sm:grid-cols-[1fr_1fr] sm:text-[12px]">
                  <div className="space-y-0 bg-[var(--code-removed)]">
                    <div className="diff-line px-3 py-1 text-[var(--error)]">self.requests = defaultdict(list)</div>
                  </div>
                  <div className="space-y-0 bg-[var(--code-added)]">
                    <div className="diff-line px-3 py-1 text-[var(--success)]"># Use Redis for distributed support</div>
                    <div className="diff-line px-3 py-1 text-[var(--success)]">import redis</div>
                    <div className="diff-line px-3 py-1 text-[var(--success)]">self.redis = redis.Redis()</div>
                  </div>
                </div>
                <div>
                  <p className="font-body text-[12px] font-medium text-[var(--text)]">Why it matters:</p>
                  <p className="mt-1 font-body text-[13px] leading-[1.75] tracking-[-0.01em] text-[var(--text-secondary)]">
                    This rate limiter resets on every deploy. In production with multiple instances, each server has independent state.
                  </p>
                </div>
                <p className="font-body text-[12px] text-[var(--text-secondary)]">Principle: Distributed State Management</p>
                <p className="font-code text-[11px] tracking-[0.01em] text-[var(--accent)]">Source: PR #2 review by @senior-dev - opens GitHub</p>
              </div>
            )}

            {panelMode === "line" && (
              <div className="flex flex-1 flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-code text-[10px] font-medium uppercase tracking-widest text-[var(--text-ghost)]">DECISION NARRATIVE</span>
                  <span className="confidence-pulse rounded-[3px] border border-[rgba(52,211,153,0.3)] bg-[var(--success-dim)] px-2 py-[2px] font-body text-[10px] font-medium text-[var(--success)]">
                    HIGH
                  </span>
                </div>
                <div className="h-px w-full bg-[var(--border-strong)]" />
                <p className="font-heading text-[14px] font-semibold text-[var(--text)]">Rate limiting added after DDoS incident in March 2022</p>
                <svg width="100%" height="72" viewBox="0 0 260 72" preserveAspectRatio="xMidYMid meet" className="shrink-0" aria-hidden>
                  <path ref={pathRef} d="M 24 36 L 80 36 L 140 36 L 200 36" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
                  <circle className="story-node" cx="24" cy="36" r="6" fill="var(--accent)" />
                  <circle className="story-node" cx="80" cy="36" r="6" fill="var(--accent)" />
                  <circle className="story-node" cx="140" cy="36" r="6" fill="var(--accent)" />
                  <circle className="story-node" cx="200" cy="36" r="6" fill="var(--accent)" />
                </svg>
                <div className="grid grid-cols-4 gap-1 text-center font-code text-[9px] tracking-[0.01em] text-[var(--text-ghost)]">
                  <span>Issue #820</span>
                  <span>PR #2</span>
                  <span>Review</span>
                  <span>Merged</span>
                </div>
                <div>
                  <p className="font-body text-[12px] font-medium text-[var(--text)]">Debate (from PR #2):</p>
                  <p className="mt-1 font-body text-[13px] leading-[1.7] tracking-[-0.01em] text-[var(--text-secondary)]">
                    @teammate-a &quot;Why not Redis? We need distributed support.&quot;
                    <br />
                    @teammate-b &quot;DevOps can&apos;t provision Redis before Friday.&quot;
                  </p>
                </div>
                <p className="font-body text-[13px] leading-[1.7] tracking-[-0.01em] text-[var(--text-secondary)]">
                  Decision: In-memory chosen for speed. Tech debt noted.
                  <br />
                  Impact: 503 error rate dropped from 12% to 0.1%.
                </p>
                <p className="font-code text-[11px] tracking-[0.01em] text-[var(--text-ghost)]">Sources: 1 issue · 1 PR · 3 review comments</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroProductDemo;

