import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import gsap from "gsap";
import { animate as animeAnimate } from "animejs";
import { Group, Panel, Separator, useDefaultLayout, useGroupRef } from "react-resizable-panels";
import { useNavigate, useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import {
  analyzeLine,
  explainComment,
  validateRepo,
  fetchRepoIndex,
  fetchRepoFileRaw,
  type InsightExplanation,
  type InsightNarrative,
} from "@/lib/gitloreApi";
import { pathsToFileTree, type FileNode } from "@/lib/pathsToFileTree";
import { startGithubOAuth } from "@/lib/githubOAuth";

/* ─── Mock Data ─── */
const MOCK_PRS = [
  "PR #3: Fix user authentication flow",
  "PR #7: Add rate limiting middleware",
  "PR #12: Refactor payment service",
];

const FALLBACK_CODE = `// Select a file in the tree or set owner/repo/branch in the bar above.
// File list is loaded from GitHub (GET /api/repo/.../index).`;

function cmLanguageForPath(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".py")) return python();
  if (lower.endsWith(".tsx") || lower.endsWith(".ts"))
    return javascript({ typescript: true, jsx: true });
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return javascript({ jsx: true });
  return javascript({ jsx: false });
}

function getBlame(_line: number): string {
  return "Git blame \u00b7 use Analyze on a line for real history";
}

/* ─── Diff data ─── */
interface DiffLine {
  type: "context" | "added" | "removed" | "header";
  content: string;
  lineNum?: number;
}

const DIFF_LINES: DiffLine[] = [
  { type: "header", content: "@@ -10,6 +10,12 @@" },
  { type: "context", content: " function UserProfile({ userId }) {", lineNum: 10 },
  { type: "context", content: "   const [data, setData] = useState(null);", lineNum: 11 },
  { type: "added", content: "+  useEffect(() => {", lineNum: 12 },
  { type: "added", content: "+    fetch(`/api/users/${userId}`)", lineNum: 13 },
  { type: "added", content: "+      .then(res => res.json())", lineNum: 14 },
  { type: "added", content: "+      .then(data => setData(data));", lineNum: 15 },
  { type: "added", content: "+  }, [userId]);", lineNum: 16 },
  { type: "context", content: "   return <div>{data?.name}</div>;", lineNum: 17 },
  { type: "context", content: " }", lineNum: 18 },
];

interface ReviewComment { line: number; text: string; author: string; }

const COMMENTS: ReviewComment[] = [
  { line: 12, text: "memory leak", author: "senior-dev" },
  { line: 14, text: "N+1", author: "tech-lead" },
  { line: 16, text: "missing error handling", author: "reviewer-3" },
];

/** Diff text sent with review-comment explain API */
const DIFF_HUNK_STRING = DIFF_LINES.map((l) => l.content).join("\n");

function parsePrNumber(prLabel: string): number {
  const m = prLabel.match(/PR\s*#(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}

/* ─── Narrative / explanation panels ─── */
interface TimelineDot { color: string; label: string; sublabel: string; date: string; }

type PanelContent =
  | { type: "idle" }
  | { type: "need-auth" }
  | { type: "error"; message: string }
  | { type: "explanation"; data: InsightExplanation }
  | { type: "narrative"; line: number; data: InsightNarrative };

/* ─── CodeMirror theme ─── */
/** `mobileSoftWrap` applies only when `mobile`; desktop always uses no-wrap + horizontal scroll. */
function buildCmTheme(mobile: boolean, mobileSoftWrap: boolean) {
  const fontSize = mobile ? "12px" : "13px";
  const wrap = mobile && mobileSoftWrap;
  return EditorView.theme({
    "&": { backgroundColor: "#0A0A0D", color: "#EDEDEF", fontSize },
    ".cm-content": { fontFamily: '"JetBrains Mono", monospace', padding: mobile ? "6px 0" : "8px 0" },
    ".cm-scroller": { overflowX: wrap ? "hidden" : "auto" },
    ".cm-gutters": { backgroundColor: "#0A0A0D", color: "#7C7C86", border: "none", minWidth: mobile ? "32px" : "40px" },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: mobile ? "0 6px 0 2px" : "0 8px 0 4px",
      minWidth: mobile ? "24px" : "32px",
      cursor: "pointer",
    },
    ".cm-activeLine": { backgroundColor: "rgba(201, 168, 76, 0.08)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(201, 168, 76, 0.08)" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#C9A84C" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(201, 168, 76, 0.2)" },
    ".cm-line": {
      padding: mobile ? "0 6px" : "0 8px",
      whiteSpace: wrap ? "pre-wrap" : "pre",
      overflowWrap: wrap ? "anywhere" : "normal",
    },
  });
}

/* ─── Sub-components ─── */

const Chevron = ({ open }: { open: boolean }) => (
  <span
    className={`mr-1.5 inline-block h-0 w-0 border-y-[4px] border-y-transparent border-l-[5px] border-l-current transition-transform duration-150 ${open ? "rotate-90" : "rotate-0"}`}
  />
);

const FILE_INDENT_CLASSES = [
  "pl-[20px]",
  "pl-[36px]",
  "pl-[52px]",
  "pl-[68px]",
  "pl-[84px]",
  "pl-[100px]",
  "pl-[116px]",
  "pl-[132px]",
  "pl-[148px]",
  "pl-[164px]",
] as const;

const FOLDER_INDENT_CLASSES = [
  "pl-[8px]",
  "pl-[24px]",
  "pl-[40px]",
  "pl-[56px]",
  "pl-[72px]",
  "pl-[88px]",
  "pl-[104px]",
  "pl-[120px]",
  "pl-[136px]",
  "pl-[152px]",
] as const;

const pickIndentClass = (depth: number, classes: readonly string[]) => classes[Math.min(depth, classes.length - 1)];

const FileTreeNode = ({
  node,
  depth = 0,
  selectedPath,
  onSelectFile,
}: {
  node: FileNode;
  depth?: number;
  selectedPath: string;
  onSelectFile: (path: string) => void;
}) => {
  const [open, setOpen] = useState(depth < 2);
  const isSelected = node.type === "file" && node.path === selectedPath;

  if (node.type === "file") {
    return (
      <button
        type="button"
        onClick={() => node.path && onSelectFile(node.path)}
        className={`flex w-full items-center py-1 px-2 text-left text-sm md:text-xs font-code transition-colors ${
          isSelected ? "bg-gitlore-accent/10 text-gitlore-accent" : "text-gitlore-text-secondary hover:text-gitlore-text hover:bg-gitlore-surface-hover"
        } ${pickIndentClass(depth, FILE_INDENT_CLASSES)}`}
      >
        {node.name}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center px-2 py-1 text-sm font-code text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface-hover hover:text-gitlore-text md:text-xs ${pickIndentClass(depth, FOLDER_INDENT_CLASSES)}`}
      >
        <Chevron open={open} />
        {node.name}
      </button>
      {open &&
        node.children?.map((child) => (
          <FileTreeNode
            key={`${depth}-${child.name}`}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        ))}
    </div>
  );
};

const PRDropdown = ({ selected, onSelect }: { selected: string; onSelect: (pr: string) => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-code bg-gitlore-code border border-gitlore-border rounded-sm text-gitlore-text hover:bg-gitlore-surface-hover transition-colors"
      >
        <span className="truncate">{selected}</span>
        <svg className={`w-4 h-4 ml-2 shrink-0 text-gitlore-text-secondary transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-gitlore-surface border border-gitlore-border rounded-sm overflow-hidden">
          {MOCK_PRS.map((pr) => (
            <button key={pr} onClick={() => { onSelect(pr); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm font-code transition-colors ${pr === selected ? "bg-gitlore-accent/10 text-gitlore-accent" : "text-gitlore-text hover:bg-gitlore-surface-hover"}`}
            >{pr}</button>
          ))}
        </div>
      )}
    </div>
  );
};

const DiffViewer = ({ onCommentClick, onLineClick, activeComment }: {
  onCommentClick: (comment: ReviewComment) => void;
  onLineClick: (lineNum: number, el: HTMLElement) => void;
  activeComment: string | null;
}) => {
  const badgesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = badgesRef.current;
    if (!root) return;
    const badges = root.querySelectorAll(".comment-badge");
    if (!badges.length) return;
    // Anime.js v4: animate(targets, params) — not a single { targets, ... } object (v3).
    const anim = animeAnimate(badges, {
      scale: [1, 1.05, 1],
      opacity: [0.8, 1, 0.8],
      duration: 2000,
      loop: true,
      ease: "inOutSine",
    });
    return () => {
      anim.revert();
    };
  }, []);

  return (
    <div className="w-full overflow-hidden md:overflow-x-auto md:overscroll-x-contain">
      <div ref={badgesRef} className="min-w-0 w-full font-code text-xs md:w-max md:min-w-full md:text-sm md:max-lg:text-[13px]">
        {DIFF_LINES.map((line, i) => {
          const commentsOnLine = COMMENTS.filter((c) => c.line === line.lineNum);
          return (
            <div key={i} className="min-w-0">
              <div
                className={`diff-line flex w-full min-w-0 cursor-pointer items-start ${
                  line.type === "added" ? "bg-[rgba(46,204,113,0.08)]"
                  : line.type === "removed" ? "bg-[rgba(231,76,60,0.08)]" : ""
                } md:w-max md:min-w-full`}
                onClick={(e) => { if (line.lineNum) onLineClick(line.lineNum, e.currentTarget); }}
              >
                <span className="w-10 shrink-0 select-none pr-2 text-right text-[11px] leading-6 text-gitlore-text-secondary/50 md:w-12 md:pr-3 md:text-xs">
                  {line.type === "header" ? "" : line.lineNum}
                </span>
                <pre className={`min-w-0 flex-1 whitespace-pre-wrap break-words leading-6 text-gitlore-text md:flex-none md:shrink-0 md:whitespace-pre ${
                  line.type === "header" ? "text-gitlore-text-secondary/60 italic" : ""
                }`}>{line.content}</pre>
              </div>
              {commentsOnLine.map((comment) => (
                <button
                  key={comment.text}
                  onClick={() => onCommentClick(comment)}
                  className={`comment-badge ml-10 mr-2 my-1 flex w-[calc(100%-3rem)] flex-wrap items-center gap-2 rounded-sm border px-3 py-1 text-left text-[11px] transition-colors cursor-pointer md:ml-12 md:mr-0 md:inline-flex md:w-auto md:text-xs ${
                    activeComment === comment.text
                      ? "bg-gitlore-accent/15 border-gitlore-accent/40 text-gitlore-accent"
                      : "bg-gitlore-error/10 border-gitlore-error/20 text-gitlore-error hover:bg-gitlore-error/15"
                  }`}
                >
                  <span className="font-semibold">{comment.text}</span>
                  <span className="break-all text-gitlore-text-secondary">@{comment.author}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const StoryTimeline = ({ dots }: { dots: TimelineDot[] }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerWidth = 320;
  const dotR = 6;
  const spacing = (containerWidth - 40) / (dots.length - 1);

  useEffect(() => {
    if (!svgRef.current) return;
    const circles = svgRef.current.querySelectorAll(".timeline-dot");
    const ctx = gsap.context(() => {
      gsap.from(circles, { scale: 0, opacity: 0, stagger: 0.2, duration: 0.4, ease: "back.out(1.7)", transformOrigin: "center" });
    });
    return () => ctx.revert();
  }, []);

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <svg ref={svgRef} viewBox={`0 0 ${containerWidth} 100`} className="block w-full max-w-[520px]" preserveAspectRatio="xMidYMid meet">
        <line x1={20} y1={20} x2={20 + spacing * (dots.length - 1)} y2={20} stroke="#2A2A3A" strokeWidth={2} />
        {dots.map((dot, i) => {
          const cx = 20 + i * spacing;
          return (
            <g key={i}>
              <circle className="timeline-dot" cx={cx} cy={20} r={dotR} fill={dot.color} />
              <text x={cx} y={42} textAnchor="middle" fill="#E8E8ED" fontSize={11} fontFamily="'Inter', sans-serif" fontWeight={500}>{dot.label}</text>
              <text x={cx} y={56} textAnchor="middle" fill="#8888A0" fontSize={10} fontFamily="'Inter', sans-serif">{dot.sublabel}</text>
              <text x={cx} y={70} textAnchor="middle" fill="#8888A0" fontSize={10} fontFamily="'Inter', sans-serif" fontStyle="italic">{dot.date}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const NarrativePanel = ({ narrative, line }: { narrative: InsightNarrative | null; line: number | null }) => {
  if (!narrative) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-sm text-gitlore-text-secondary text-center leading-relaxed">Click a line to see its story</p>
      </div>
    );
  }
  return (
    <div className="p-4 md:p-5 space-y-4 md:space-y-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm lg:text-base font-heading font-semibold text-gitlore-text leading-snug md:max-lg:text-[15px]">{narrative.oneLiner}</p>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-sm border border-gitlore-border text-gitlore-success shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-gitlore-success" />{narrative.confidence}
        </span>
      </div>
      {line !== null && <div className="text-sm text-gitlore-text-secondary">Line {line} -- Narrative</div>}
      <StoryTimeline dots={narrative.timeline} />
      <div>
        <div className="text-xs font-medium text-gitlore-text-secondary uppercase tracking-wider mb-1.5">The Debate</div>
        <p className="text-sm text-gitlore-text leading-relaxed md:max-lg:text-[13px] lg:text-[15px]">{narrative.debate}</p>
      </div>
      <div className="px-3 py-2.5 bg-gitlore-success/10 border border-gitlore-success/20 rounded-sm">
        <div className="text-xs font-medium text-gitlore-success mb-1">Impact</div>
        <div className="text-sm text-gitlore-text md:max-lg:text-[13px] lg:text-[15px]">{narrative.impact}</div>
      </div>
      <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gitlore-accent text-gitlore-accent rounded-sm hover:bg-gitlore-accent/10 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M12 6.253v11.494M18.364 5.636a9 9 0 010 12.728M8.464 15.536a5 5 0 010-7.072M5.636 18.364a9 9 0 010-12.728" />
        </svg>
        Listen
      </button>
    </div>
  );
};

const SplitDiffView = ({ buggyCode, fixedCode }: { buggyCode: string; fixedCode: string }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    <div className="min-w-0">
      <div className="text-xs font-medium text-gitlore-error mb-1.5 uppercase tracking-wider">Your code</div>
      <pre className="p-3 text-sm md:text-xs leading-5 font-code bg-[rgba(231,76,60,0.08)] border border-gitlore-error/20 rounded-sm text-gitlore-text overflow-x-auto whitespace-pre">{buggyCode}</pre>
    </div>
    <div className="min-w-0">
      <div className="text-xs font-medium text-gitlore-success mb-1.5 uppercase tracking-wider">Fixed</div>
      <pre className="p-3 text-sm md:text-xs leading-5 font-code bg-[rgba(46,204,113,0.08)] border border-gitlore-success/20 rounded-sm text-gitlore-text overflow-x-auto whitespace-pre">{fixedCode}</pre>
    </div>
  </div>
);

const ExplanationPanel = ({ explanation }: { explanation: InsightExplanation | null }) => {
  if (!explanation) return null;
  const confidenceColor = explanation.confidence === "HIGH" ? "text-gitlore-success" : explanation.confidence === "MEDIUM" ? "text-gitlore-warning" : "text-gitlore-error";
  const dotColor = explanation.confidence === "HIGH" ? "bg-gitlore-success" : explanation.confidence === "MEDIUM" ? "bg-gitlore-warning" : "bg-gitlore-error";

  return (
    <div className="p-4 md:p-5 space-y-4 md:space-y-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm lg:text-base font-heading font-semibold text-gitlore-accent md:max-lg:text-[15px]">{explanation.header}</h3>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-sm border border-gitlore-border ${confidenceColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />{explanation.confidence}
        </span>
      </div>
      <SplitDiffView buggyCode={explanation.buggyCode} fixedCode={explanation.fixedCode} />
      <div>
        <div className="text-xs font-medium text-gitlore-text-secondary uppercase tracking-wider mb-1.5">Why it matters</div>
        <p className="text-sm text-gitlore-text leading-relaxed md:max-lg:text-[13px] lg:text-[15px]">{explanation.why}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gitlore-text-secondary">Principle:</span>
        <span className="text-gitlore-text font-medium">{explanation.principle}</span>
      </div>
      <a href={`https://${explanation.link}`} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-gitlore-text-secondary hover:text-gitlore-accent transition-colors break-all">
        {explanation.link} &rarr;
      </a>
    </div>
  );
};

/* ─── Main ─── */
type LeftTab = "diff" | "code";

/** Draggable IDE splitters (react-resizable-panels v4 `Separator`). */
const IdeResizeHandle = () => (
  <Separator className="relative z-10 flex w-3 shrink-0 items-stretch justify-center border-0 bg-transparent px-0 outline-none hover:[&>span]:bg-gitlore-accent/70 data-[separator=active]:[&>span]:bg-gitlore-accent focus-visible:ring-2 focus-visible:ring-gitlore-accent/50 focus-visible:ring-offset-0">
    <span className="my-auto h-12 w-1 shrink-0 rounded-full bg-gitlore-border transition-colors" aria-hidden />
  </Separator>
);

const AppView = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { target, repoFull, setTarget, repoReady, repoResolving } = useRepo();
  const isMobile = useIsMobile();
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [sourceCode, setSourceCode] = useState(FALLBACK_CODE);
  const [fileLoading, setFileLoading] = useState(false);
  const [mobileCodeWrap, setMobileCodeWrap] = useState(true);
  const [selectedPR, setSelectedPR] = useState(MOCK_PRS[0]);
  const [panel, setPanel] = useState<PanelContent>({ type: "idle" });
  const [insightLoading, setInsightLoading] = useState(false);
  const [repoCheckMsg, setRepoCheckMsg] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("code");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  const cmTheme = useMemo(() => buildCmTheme(isMobile, mobileCodeWrap), [isMobile, mobileCodeWrap]);
  const cmExtensions = useMemo(
    () => [
      cmLanguageForPath(target.filePath || ""),
      ...(isMobile && mobileCodeWrap ? [EditorView.lineWrapping] : []),
    ],
    [target.filePath, isMobile, mobileCodeWrap]
  );

  const onSelectFile = useCallback(
    (path: string) => {
      setTarget({ filePath: path });
    },
    [setTarget]
  );

  useEffect(() => {
    const st = location.state as { file?: string } | null;
    if (st?.file) {
      setTarget({ filePath: st.file });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate, setTarget]);

  useEffect(() => {
    if (!user || !repoReady) {
      setFileTree([]);
      setTreeLoading(false);
      if (!repoReady) setTreeError(null);
      return;
    }
    let cancelled = false;
    setTreeLoading(true);
    setTreeError(null);
    void fetchRepoIndex(target.owner, target.name, target.branch, 500)
      .then((idx) => {
        if (cancelled) return;
        setFileTree(pathsToFileTree(idx.paths));
      })
      .catch((e) => {
        if (!cancelled) setTreeError(e instanceof Error ? e.message : "Failed to load tree");
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, repoReady, target.owner, target.name, target.branch]);

  useEffect(() => {
    if (!user || !repoReady || !target.filePath?.trim()) {
      setSourceCode(FALLBACK_CODE);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    void fetchRepoFileRaw(target.owner, target.name, target.filePath, target.branch)
      .then((r) => {
        if (cancelled) return;
        if (r.isBinary) {
          setSourceCode(`// ${r.message || "Binary or unreadable file"}\n`);
        } else {
          setSourceCode(r.text ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) setSourceCode("// Could not load file (check path, branch, or permissions).\n");
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, repoReady, target.owner, target.name, target.filePath, target.branch]);

  const desktopPanelRef = useRef<HTMLDivElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const prevPanelType = useRef<string>("idle");

  const outerLayout = useDefaultLayout({ id: "gitlore-app-outer", storage: localStorage });
  const workspaceLayout = useDefaultLayout({ id: "gitlore-app-workspace", storage: localStorage });
  const blameLayout = useDefaultLayout({ id: "gitlore-app-blame", storage: localStorage });
  const outerGroupRef = useGroupRef();
  const workspaceGroupRef = useGroupRef();
  const blameGroupRef = useGroupRef();

  const resetIdeLayout = useCallback(() => {
    for (const id of ["gitlore-app-outer", "gitlore-app-workspace", "gitlore-app-blame"] as const) {
      try {
        localStorage.removeItem(`react-resizable-panels:${id}`);
      } catch {
        /* ignore quota / private mode */
      }
    }
    outerGroupRef.current?.setLayout({ fileTree: 18, workspace: 82 });
    workspaceGroupRef.current?.setLayout({ editor: 63, insight: 37 });
    blameGroupRef.current?.setLayout({ blame: 15, code: 85 });
  }, []);

  // Animate panel slide-in
  useEffect(() => {
    if (panel.type === "idle" || panel.type === prevPanelType.current) {
      prevPanelType.current = panel.type;
      return;
    }
    prevPanelType.current = panel.type;

    // Desktop slide
    if (desktopPanelRef.current) {
      gsap.fromTo(desktopPanelRef.current, { x: "20%", opacity: 0 }, { x: "0%", opacity: 1, duration: 0.4, ease: "power3.out" });
    }
    // Mobile slide
    if (mobilePanelRef.current) {
      gsap.fromTo(mobilePanelRef.current, { y: "100%" }, { y: "0%", duration: 0.35, ease: "power3.out" });
    }
  }, [panel]);

  const handleCommentClick = useCallback(
    async (comment: ReviewComment) => {
      if (!user) {
        setPanel({ type: "need-auth" });
        setPanelOpen(true);
        return;
      }
      setPanelOpen(true);
      setInsightLoading(true);
      setPanel({ type: "idle" });
      try {
        const data = await explainComment({
          comment: comment.text,
          diff_hunk: DIFF_HUNK_STRING,
          file_path: target.filePath || "demo.tsx",
          line: comment.line,
          repo: repoFull,
          pr_number: parsePrNumber(selectedPR),
        });
        setPanel({ type: "explanation", data });
      } catch (e) {
        setPanel({ type: "error", message: e instanceof Error ? e.message : "Explain request failed" });
      } finally {
        setInsightLoading(false);
      }
    },
    [user, repoFull, selectedPR, target.filePath]
  );

  const handleLineClickAnime = useCallback(
    async (lineNum: number, el?: HTMLElement) => {
      if (el) {
        animeAnimate(el, {
          backgroundColor: ["rgba(201,168,76,0)", "rgba(201,168,76,0.15)", "rgba(201,168,76,0.05)"],
          duration: 800,
          ease: "outQuad",
        });
      }
      setSelectedLine(lineNum);
      if (!user) {
        setPanel({ type: "need-auth" });
        setPanelOpen(true);
        return;
      }
      setPanelOpen(true);
      setInsightLoading(true);
      setPanel({ type: "idle" });
      try {
        const data = await analyzeLine({
          repo: repoFull,
          file_path: target.filePath,
          line_number: lineNum,
          branch: target.branch,
        });
        setPanel({ type: "narrative", line: lineNum, data });
      } catch (e) {
        setPanel({ type: "error", message: e instanceof Error ? e.message : "Analyze request failed" });
      } finally {
        setInsightLoading(false);
      }
    },
    [user, repoFull, target.filePath, target.branch]
  );

  const handleDiffLineClick = useCallback((lineNum: number, el: HTMLElement) => {
    animeAnimate(el, {
      backgroundColor: ["rgba(201,168,76,0)", "rgba(201,168,76,0.15)", "rgba(201,168,76,0.05)"],
      duration: 800,
      ease: "outQuad",
    });
  }, []);

  const codeLines = sourceCode.split("\n");
  const blameLines = codeLines.map((_, i) => getBlame(i + 1));

  const panelUI =
    insightLoading ? (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-center text-sm text-gitlore-text-secondary">Loading insight…</p>
      </div>
    ) : panel.type === "need-auth" ? (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <p className="text-center text-sm text-gitlore-text-secondary">
          Sign in with GitHub to run blame narratives and review explanations against the configured repository.
        </p>
        <button
          type="button"
          onClick={() => startGithubOAuth()}
          className="rounded-sm bg-gitlore-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover"
        >
          Sign in with GitHub
        </button>
      </div>
    ) : panel.type === "error" ? (
      <div className="p-5">
        <p className="text-sm text-gitlore-error">{panel.message}</p>
      </div>
    ) : panel.type === "explanation" ? (
      <ExplanationPanel explanation={panel.data} />
    ) : panel.type === "narrative" ? (
      <NarrativePanel narrative={panel.data} line={panel.line} />
    ) : (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-center text-sm text-gitlore-text-secondary">
          {leftTab === "code"
            ? "Click a line to analyze the configured file path with Git blame (see bar above)."
            : "Click a review comment to get an AI explanation via the API."}
        </p>
      </div>
    );

  const blameRowClass = isMobile ? "h-[22px] leading-[22px] text-[13px]" : "h-[20.8px] leading-[20.8px] text-[11px]";

  const blameColumn = (
    <>
      <div className="h-2 md:h-[8px]" />
      {blameLines.map((blame, i) => {
        const isActive = selectedLine === i + 1;
        const showText = i === 0 || blameLines[i - 1] !== blame;
        return (
          <div
            key={i}
            className={`px-2 whitespace-nowrap transition-colors ${blameRowClass} ${isActive ? "bg-gitlore-accent/8" : ""}`}
          >
            <span className="font-code text-gitlore-text-secondary/50 max-md:text-[13px]">{showText ? blame : ""}</span>
          </div>
        );
      })}
    </>
  );

  const mobileBlameRanges = [
    { range: "1–5", label: "teammate-b · 3 months ago" },
    { range: "6–10", label: "teammate-a · 8 months ago" },
    { range: "11–20", label: "teammate-b · 3 months ago" },
    { range: "21–28", label: "teammate-c · 1 year ago" },
  ];

  const selectedBlame = selectedLine ? getBlame(selectedLine) : null;

  const codeEditor = (
    <div className="relative min-w-0 flex-1 min-h-0 [&_.cm-editor]:h-full [&_.cm-editor]:min-w-0">
      {fileLoading && (
        <div className="absolute right-2 top-2 z-10 rounded bg-gitlore-surface px-2 py-0.5 font-code text-[10px] text-gitlore-text-secondary">
          Loading…
        </div>
      )}
      <CodeMirror
        value={sourceCode}
        key={`${target.filePath}-${isMobile ? `m-${mobileCodeWrap ? "wrap" : "nowrap"}` : "d"}`}
        extensions={cmExtensions}
        theme={cmTheme}
        editable={false}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, highlightActiveLineGutter: true }}
        onStatistics={(stats) => {
          const line = stats.line.number;
          if (line !== selectedLine) handleLineClickAnime(line);
        }}
        className="h-full min-h-[18rem] md:min-h-0"
      />
    </div>
  );

  const mobileRepoAccordion = (
    <div className="md:hidden border-b border-gitlore-border bg-gitlore-surface shrink-0">
      <button
        type="button"
        onClick={() => setMobileTreeOpen(!mobileTreeOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gitlore-text hover:bg-gitlore-surface-hover transition-colors"
      >
        <span>Repository &amp; files</span>
        <svg
          className={`h-4 w-4 text-gitlore-text-secondary transition-transform ${mobileTreeOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {mobileTreeOpen && (
        <div className="space-y-3 border-t border-gitlore-border px-3 pb-3 pt-2">
          <div>
            <div className="text-xs text-gitlore-text-secondary uppercase tracking-wider mb-2 font-medium">Pull Request</div>
            <PRDropdown selected={selectedPR} onSelect={setSelectedPR} />
          </div>
          <div>
            <div className="text-xs text-gitlore-text-secondary uppercase tracking-wider mb-2 px-1 font-medium">Files</div>
            {treeError && (
              <p className="px-2 py-1 font-code text-[11px] text-gitlore-error">{treeError}</p>
            )}
            {treeLoading && <p className="px-2 py-1 text-xs text-gitlore-text-secondary">Loading tree…</p>}
            {!treeLoading &&
              fileTree.map((node) => (
                <FileTreeNode
                  key={node.name}
                  node={node}
                  selectedPath={target.filePath}
                  onSelectFile={onSelectFile}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );

  const tabBar = (opts: { showResetLayout: boolean }) => (
    <div className="shrink-0 border-b border-gitlore-border bg-gitlore-surface">
      <div className="flex items-center gap-2 pl-2 pr-1 md:px-0">
        <div className="flex items-center gap-1 md:hidden">
          <button
            type="button"
            onClick={() => {
              setLeftTab("code");
              setPanel({ type: "idle" });
              setPanelOpen(false);
            }}
            className={`px-3 py-2 text-sm font-medium ${leftTab === "code" ? "text-gitlore-accent" : "text-gitlore-text-secondary"}`}
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => {
              setLeftTab("diff");
              setPanel({ type: "idle" });
              setPanelOpen(false);
            }}
            className={`px-3 py-2 text-sm font-medium ${leftTab === "diff" ? "text-gitlore-accent" : "text-gitlore-text-secondary"}`}
          >
            Diff
          </button>
        </div>

        <button
          type="button"
          onClick={() => { setLeftTab("code"); setPanel({ type: "idle" }); setPanelOpen(false); }}
          className={`hidden md:block px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors border-b-2 md:max-lg:text-[11px] ${leftTab === "code" ? "border-gitlore-accent text-gitlore-accent" : "border-transparent text-gitlore-text-secondary hover:text-gitlore-text"}`}
        >
          Code
        </button>
        <button
          type="button"
          onClick={() => { setLeftTab("diff"); setPanel({ type: "idle" }); setPanelOpen(false); }}
          className={`hidden md:block px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors border-b-2 md:max-lg:text-[11px] ${leftTab === "diff" ? "border-gitlore-accent text-gitlore-accent" : "border-transparent text-gitlore-text-secondary hover:text-gitlore-text"}`}
        >
          Diff
        </button>
        {opts.showResetLayout && (
          <button
            type="button"
            onClick={resetIdeLayout}
            className="hidden shrink-0 rounded border border-transparent px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary hover:border-gitlore-border hover:text-gitlore-accent md:block"
            title="Restore default panel widths (saved layout cleared for this session until you resize again)"
          >
            Reset layout
          </button>
        )}
        <div className="min-w-0 flex-1" />
        <span className="hidden truncate px-3 py-2 font-code text-sm text-gitlore-text-secondary md:block md:max-lg:text-xs">
          {target.filePath || "— no file selected —"}
        </span>
      </div>
      <div className="border-t border-gitlore-border/60 px-3 py-2 md:hidden">
        <span className="block truncate font-code text-[11px] leading-5 text-gitlore-text-secondary">
          {target.filePath || "— no file selected —"}
        </span>
      </div>
    </div>
  );

  const fileTreeAside = (
    <aside className="flex h-full w-full flex-col overflow-auto bg-gitlore-surface md:border-r md:border-gitlore-border">
      <div className="p-3 border-b border-gitlore-border">
        <div className="text-xs text-gitlore-text-secondary uppercase tracking-wider mb-2 font-medium md:max-lg:text-[11px]">Pull Request</div>
        <PRDropdown selected={selectedPR} onSelect={setSelectedPR} />
      </div>
      <div className="p-2">
        <div className="text-xs text-gitlore-text-secondary uppercase tracking-wider mb-2 px-2 font-medium md:max-lg:text-[11px]">Files</div>
        {treeError && (
          <p className="px-2 py-1 font-code text-[11px] text-gitlore-error">{treeError}</p>
        )}
        {treeLoading && <p className="px-2 py-1 text-xs text-gitlore-text-secondary">Loading tree…</p>}
        {!treeLoading &&
          fileTree.map((node) => (
            <FileTreeNode
              key={node.name}
              node={node}
              selectedPath={target.filePath}
              onSelectFile={onSelectFile}
            />
          ))}
      </div>
    </aside>
  );

  const checkRepo = async () => {
    if (!user) {
      setRepoCheckMsg("Sign in first to validate private repos");
      return;
    }
    setRepoCheckMsg(null);
    try {
      const r = await validateRepo(target.owner.trim(), target.name.trim());
      setRepoCheckMsg(r.found ? `OK${r.url ? ` · ${r.url}` : ""}` : "Not found or no access");
    } catch (e) {
      setRepoCheckMsg(e instanceof Error ? e.message : "Validation failed");
    }
  };

  const repoTargetBar = (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gitlore-border bg-gitlore-surface px-3 py-2 text-[11px] md:text-xs">
      <span className="font-medium text-gitlore-text-secondary">Blame / analyze target</span>
      <input
        aria-label="Owner"
        value={target.owner}
        onChange={(e) => setTarget({ owner: e.target.value })}
        className="w-[88px] rounded-sm border border-gitlore-border bg-gitlore-code px-2 py-1 font-code text-gitlore-text outline-none focus:border-gitlore-accent md:w-[100px]"
        placeholder="owner"
      />
      <span className="text-gitlore-text-secondary">/</span>
      <input
        aria-label="Repository"
        value={target.name}
        onChange={(e) => setTarget({ name: e.target.value })}
        className="w-[100px] rounded-sm border border-gitlore-border bg-gitlore-code px-2 py-1 font-code text-gitlore-text outline-none focus:border-gitlore-accent md:w-[120px]"
        placeholder="repo"
      />
      <input
        aria-label="File path"
        value={target.filePath}
        onChange={(e) => setTarget({ filePath: e.target.value })}
        className="min-w-[120px] flex-1 rounded-sm border border-gitlore-border bg-gitlore-code px-2 py-1 font-code text-gitlore-text outline-none focus:border-gitlore-accent"
        placeholder="path/to/file.py"
      />
      <input
        aria-label="Branch"
        value={target.branch}
        onChange={(e) => setTarget({ branch: e.target.value })}
        className="w-[72px] rounded-sm border border-gitlore-border bg-gitlore-code px-2 py-1 font-code text-gitlore-text outline-none focus:border-gitlore-accent md:w-[84px]"
        placeholder="branch"
      />
      <button
        type="button"
        onClick={() => void checkRepo()}
        className="rounded-sm border border-gitlore-border px-2 py-1 font-medium text-gitlore-text transition-colors hover:border-gitlore-accent hover:text-gitlore-accent"
      >
        Validate
      </button>
      {repoCheckMsg && <span className="font-code text-gitlore-text-secondary">{repoCheckMsg}</span>}
    </div>
  );

  const authBanner =
    !authLoading && !user ? (
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gitlore-border bg-gitlore-accent/10 px-3 py-2 text-xs md:text-sm">
        <span className="text-gitlore-text">Connect GitHub to use narratives, explain, and repo APIs.</span>
        <button
          type="button"
          onClick={() => startGithubOAuth()}
          className="shrink-0 rounded-sm bg-gitlore-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-gitlore-accent-hover"
        >
          Sign in
        </button>
      </div>
    ) : null;

  const repoGate =
    user && repoResolving ? (
      <div className="flex shrink-0 items-center justify-center border-b border-gitlore-border bg-gitlore-surface px-3 py-6 text-sm text-gitlore-text-secondary">
        Loading your most recently updated repository…
      </div>
    ) : user && !repoReady ? (
      <div className="flex shrink-0 flex-col items-center justify-center gap-2 border-b border-gitlore-border bg-gitlore-surface px-3 py-8 text-center text-sm text-gitlore-text-secondary">
        <p className="max-w-md">
          No repository selected. Open the header search, choose <span className="text-gitlore-text">Repositories</span>, and pick a repo to load the file tree and editor.
        </p>
      </div>
    ) : null;

  const showRepoBar = !user || !repoResolving;
  const showIde = !user || repoReady;

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 flex-col overflow-hidden">
      {authBanner}
      {repoGate}
      {showRepoBar ? repoTargetBar : null}
      {showIde ? (
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {isMobile ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {mobileRepoAccordion}
          {tabBar({ showResetLayout: false })}
          <div className="min-h-0 flex-1 overflow-hidden bg-gitlore-code">
            {leftTab === "code" ? (
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="shrink-0 border-b border-gitlore-border bg-gitlore-surface px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-gitlore-text-secondary">Line context</div>
                      <div className="mt-1 text-sm text-gitlore-text">
                        {selectedLine ? `Line ${selectedLine}` : "Tap a line number to inspect its origin"}
                      </div>
                    </div>
                    {selectedBlame && (
                      <div className="max-w-[42%] text-right font-code text-[10px] leading-4 text-gitlore-text-secondary">
                        {selectedBlame}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {mobileBlameRanges.map((item) => (
                      <div key={item.range} className="shrink-0 rounded-sm border border-gitlore-border bg-gitlore-code px-2.5 py-1.5">
                        <div className="font-code text-[10px] text-gitlore-accent">{item.range}</div>
                        <div className="font-code text-[10px] text-gitlore-text-secondary">{item.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-gitlore-border/60 pt-2.5">
                    <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-gitlore-text-secondary">Code lines</span>
                    <div className="ml-auto flex rounded-sm border border-gitlore-border p-0.5 font-code text-[10px] font-medium">
                      <button
                        type="button"
                        onClick={() => setMobileCodeWrap(true)}
                        className={`rounded-[2px] px-2 py-1 transition-colors ${mobileCodeWrap ? "bg-gitlore-accent/20 text-gitlore-accent" : "text-gitlore-text-secondary hover:text-gitlore-text"}`}
                      >
                        Wrap
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobileCodeWrap(false)}
                        className={`rounded-[2px] px-2 py-1 transition-colors ${!mobileCodeWrap ? "bg-gitlore-accent/20 text-gitlore-accent" : "text-gitlore-text-secondary hover:text-gitlore-text"}`}
                      >
                        No wrap
                      </button>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {codeEditor}
                </div>
              </div>
            ) : (
              <div className="h-full overflow-auto p-3">
                <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary md:max-lg:text-[11px]">Changes</div>
                <DiffViewer onCommentClick={handleCommentClick} onLineClick={handleDiffLineClick} activeComment={panel.type === "explanation" ? null : null} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <Group
          className="flex min-h-0 min-w-0 flex-1"
          orientation="horizontal"
          id="gitlore-app-outer"
          defaultLayout={outerLayout.defaultLayout}
          onLayoutChanged={outerLayout.onLayoutChanged}
          groupRef={outerGroupRef}
        >
          <Panel id="fileTree" defaultSize="18%" minSize="12%" maxSize="42%" className="min-h-0 min-w-0">
            {fileTreeAside}
          </Panel>
          <IdeResizeHandle />
          <Panel id="workspace" defaultSize="82%" minSize="28%" className="min-h-0 min-w-0">
            <Group
              className="h-full min-h-0 w-full"
              orientation="horizontal"
              id="gitlore-app-workspace"
              defaultLayout={workspaceLayout.defaultLayout}
              onLayoutChanged={workspaceLayout.onLayoutChanged}
              groupRef={workspaceGroupRef}
            >
              <Panel id="editor" defaultSize="63%" minSize="38%" className="min-h-0 min-w-0">
                <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gitlore-surface">
                  {tabBar({ showResetLayout: true })}
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gitlore-code">
                    {leftTab === "code" ? (
                      <Group
                        className="h-full min-h-0 w-full"
                        orientation="horizontal"
                        id="gitlore-app-blame"
                        defaultLayout={blameLayout.defaultLayout}
                        onLayoutChanged={blameLayout.onLayoutChanged}
                        groupRef={blameGroupRef}
                      >
                        <Panel id="blame" defaultSize="15%" minSize="11%" maxSize="34%" className="min-h-0 min-w-0">
                          <div className="flex h-full min-h-0 select-none flex-col overflow-hidden border-r border-gitlore-border bg-gitlore-code">
                            {blameColumn}
                          </div>
                        </Panel>
                        <IdeResizeHandle />
                        <Panel id="code" defaultSize="85%" minSize="40%" className="min-h-0 min-w-0">
                          <div className="h-full min-h-0 min-w-0 overflow-auto bg-gitlore-code">{codeEditor}</div>
                        </Panel>
                      </Group>
                    ) : (
                      <div className="min-h-0 flex-1 overflow-auto">
                        <div className="w-full min-w-0 p-3 md:p-4">
                          <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary md:max-lg:text-[11px]">Changes</div>
                          <DiffViewer onCommentClick={handleCommentClick} onLineClick={handleDiffLineClick} activeComment={panel.type === "explanation" ? null : null} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
              <IdeResizeHandle />
              <Panel id="insight" defaultSize="37%" minSize="18%" maxSize="55%" className="min-h-0 min-w-0">
                <div
                  ref={desktopPanelRef}
                  className="h-full overflow-auto bg-gitlore-surface"
                >
                  {panelUI}
                </div>
              </Panel>
            </Group>
          </Panel>
        </Group>
      )}

      {panelOpen && (insightLoading || panel.type !== "idle") && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:hidden">
          <button
            type="button"
            aria-label="Close panel"
            className="absolute inset-0 bg-[#0A0A0F]/60"
            onClick={() => setPanelOpen(false)}
          />
          <div
            ref={mobilePanelRef}
            className="relative z-10 flex max-h-[75dvh] flex-col rounded-t-xl border-t border-gitlore-border bg-gitlore-surface shadow-2xl"
          >
            <div className="flex shrink-0 justify-center pt-3 pb-2">
              <div className="h-1 w-10 shrink-0 rounded-full bg-[#2A2A3A]" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panelUI}</div>
          </div>
        </div>
      )}
      </div>
      ) : null}
    </div>
  );
};

export default AppView;
