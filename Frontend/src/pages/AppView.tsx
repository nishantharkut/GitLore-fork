import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";

import gsap from "gsap";
import { animate as animeAnimate } from "animejs";
import { Group, Panel, Separator, useDefaultLayout, useGroupRef } from "react-resizable-panels";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { WrapText } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import {
  analyzeLine,
  explainComment,
  validateRepo,
  fetchRepoIndex,
  fetchRepoFileRaw,
  fetchRepoPullRequests,
  fetchPullDiffReview,
  type InsightExplanation,
  type InsightNarrative,
  type RepoPullSummary,
  type PullDiffReviewFile,
} from "@/lib/gitloreApi";
import { pathsToFileTree, type FileNode } from "@/lib/pathsToFileTree";
import { parseUnifiedDiff, diffLinesToHunkString, type ParsedDiffLine } from "@/lib/parseUnifiedDiff";
import { pathsMatchPrCommentFile } from "@/lib/repoPath";
import { firstLineForPrFile } from "@/lib/prNavigation";
import { startGithubOAuth } from "@/lib/githubOAuth";
import { FeatureToggle, type ActiveFeature } from "@/components/shared/FeatureToggle";
import { ExplanationView } from "@/components/panel/ExplanationView";
import { PrReviewOverview } from "@/components/panel/PrReviewOverview";
import { inlineCommentsExtension } from "@/components/editor/InlineComments";

const StoryVoiceGate = lazy(() => import("@/components/StoryVoiceGate"));
import { CodeEditorSkeleton, DiffLoadingBlock, Spinner } from "@/components/Skeleton";

const AppViewCodeEditor = lazy(() => import("./AppViewCodeEditor"));

const FALLBACK_CODE = `// Select a file in the tree or set owner/repo/branch in the bar above.
// File list is loaded from GitHub (GET /api/repo/.../index).`;

function truncBlameText(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function compactBlameFromNarrative(data: InsightNarrative): string {
  const t = data.timeline[0];
  if (!t) return "Git blame · analyze line";
  const author = (t.sublabel || "").trim() || "?";
  const when = (t.date || "").trim();
  const msg = (t.label || "").replace(/\s+/g, " ").trim();
  const parts: string[] = [author];
  if (when) parts.push(when);
  if (msg) parts.push(truncBlameText(msg, 14));
  return truncBlameText(parts.join(" · "), 32);
}

type DiffLine = ParsedDiffLine;

interface ReviewComment {
  id: number;
  path: string;
  line: number | null;
  text: string;
  author: string;
  diff_hunk: string | null;
}

/* ─── Narrative / explanation panels ─── */
interface TimelineDot { color: string; label: string; sublabel: string; date: string; }

type PanelContent =
  | { type: "idle" }
  | { type: "need-auth" }
  | { type: "error"; message: string }
  | {
      type: "explanation";
      data: InsightExplanation;
      diffHunk?: string | null;
      prNumber?: number | null;
    }
  | { type: "narrative"; line: number; data: InsightNarrative };

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

const PRDropdown = ({
  pulls,
  selectedNumber,
  onSelect,
  loading,
  emptyHint,
}: {
  pulls: RepoPullSummary[];
  selectedNumber: number | null;
  onSelect: (n: number) => void;
  loading: boolean;
  emptyHint: string;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = pulls.find((p) => p.number === selectedNumber);
  const label = loading
    ? "Loading PRs…"
    : selected
      ? `PR #${selected.number}: ${selected.title}`
      : pulls.length === 0
        ? emptyHint
        : "Select a PR";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={loading || pulls.length === 0}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-sm border border-gitlore-border bg-gitlore-code px-3 py-2 text-left text-sm font-code text-gitlore-text transition-colors hover:bg-gitlore-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">{label}</span>
        <svg className={`ml-2 h-4 w-4 shrink-0 text-gitlore-text-secondary transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && pulls.length > 0 && (
        <div className="absolute z-[100] mt-1 max-h-64 w-full overflow-y-auto rounded-sm border border-gitlore-border bg-gitlore-surface shadow-lg">
          {pulls.map((pr) => (
            <button
              key={pr.number}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(pr.number);
                setOpen(false);
              }}
              className={`w-full px-3 py-2 text-left text-sm font-code transition-colors ${
                pr.number === selectedNumber ? "bg-gitlore-accent/10 text-gitlore-accent" : "text-gitlore-text hover:bg-gitlore-surface-hover"
              }`}
            >
              <span className="text-gitlore-text-secondary">#{pr.number}</span> {pr.title}{" "}
              <span className="text-xs text-gitlore-text-secondary">({pr.state})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const DiffViewer = ({
  lines,
  comments,
  onCommentClick,
  onLineClick,
  activeCommentId,
}: {
  lines: DiffLine[];
  comments: ReviewComment[];
  onCommentClick: (comment: ReviewComment) => void;
  onLineClick: (lineNum: number, el: HTMLElement) => void;
  activeCommentId: number | null;
}) => {
  const badgesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = badgesRef.current;
    if (!root) return;
    const badges = root.querySelectorAll(".comment-badge");
    if (!badges.length) return;
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
  }, [lines, comments]);

  if (!lines.length) {
    return (
      <p className="text-sm text-gitlore-text-secondary">
        No diff loaded. Choose a pull request with changes, or check repo access.
      </p>
    );
  }

  return (
    <div className="w-full overflow-hidden md:overflow-x-auto md:overscroll-x-contain">
      <div ref={badgesRef} className="min-w-0 w-full font-code text-xs md:w-max md:min-w-full md:text-sm md:max-lg:text-[13px]">
        {lines.map((line, i) => {
          const commentsOnLine = comments.filter((c) => {
            if (c.line == null || line.lineNum == null || c.line !== line.lineNum) return false;
            if (!line.path) return true;
            return pathsMatchPrCommentFile(c.path, line.path);
          });
          return (
            <div key={i} className="min-w-0">
              <div
                className={`diff-line flex w-full min-w-0 cursor-pointer items-start ${
                  line.type === "added"
                    ? "bg-[var(--code-added)]"
                    : line.type === "removed"
                      ? "bg-[var(--code-removed)]"
                      : ""
                } md:w-max md:min-w-full`}
                onClick={(e) => {
                  if (line.lineNum) onLineClick(line.lineNum, e.currentTarget);
                }}
              >
                <span className="w-10 shrink-0 select-none pr-2 text-right text-[11px] leading-6 text-gitlore-text-secondary/50 md:w-12 md:pr-3 md:text-xs">
                  {line.type === "header" ? "" : line.lineNum}
                </span>
                <pre
                  className={`min-w-0 flex-1 whitespace-pre-wrap break-words leading-6 text-gitlore-text md:flex-none md:shrink-0 md:whitespace-pre ${
                    line.type === "header" ? "text-gitlore-text-secondary/60 italic" : ""
                  }`}
                >
                  {line.content}
                </pre>
              </div>
              {commentsOnLine.map((comment) => (
                <button
                  key={comment.id}
                  type="button"
                  onClick={() => onCommentClick(comment)}
                  className={`comment-badge my-1 ml-10 mr-2 flex w-[calc(100%-3rem)] cursor-pointer flex-wrap items-center gap-2 rounded-sm border px-3 py-1 text-left text-[11px] transition-colors md:ml-12 md:mr-0 md:inline-flex md:w-auto md:text-xs ${
                    activeCommentId === comment.id
                      ? "border-gitlore-accent/40 bg-gitlore-accent/15 text-gitlore-accent"
                      : "border-gitlore-border/80 bg-[var(--elevated)] text-gitlore-text hover:border-gitlore-accent/30 hover:bg-gitlore-surface-hover"
                  }`}
                >
                  <span className="font-semibold line-clamp-2">{comment.text}</span>
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

const TIMELINE_FONT = 'Inter, system-ui, sans-serif';

const StoryTimeline = ({ dots }: { dots: TimelineDot[] }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerWidth = 600;
  const dotR = 6;
  const spacing = dots.length > 1 ? (containerWidth - 40) / (dots.length - 1) : 0;

  useEffect(() => {
    if (!svgRef.current) return;
    const circles = svgRef.current.querySelectorAll(".timeline-dot");
    const ctx = gsap.context(() => {
      gsap.from(circles, { scale: 0, opacity: 0, stagger: 0.2, duration: 0.4, ease: "back.out(1.7)", transformOrigin: "center" });
    });
    return () => ctx.revert();
  }, []);

  return (
    <div className="-mx-1 min-h-[100px] overflow-x-auto px-1" style={{ minWidth: 280 }}>
      <svg ref={svgRef} viewBox={`0 0 ${containerWidth} 100`} className="block w-full" preserveAspectRatio="xMidYMid meet">
        {dots.length > 1 && (
          <line x1={20} y1={24} x2={20 + spacing * (dots.length - 1)} y2={24} stroke="#2A2A3A" strokeWidth={2} />
        )}
        {dots.map((dot, i) => {
          const cx = dots.length > 1 ? 20 + i * spacing : containerWidth / 2;
          return (
            <g key={i}>
              <circle className="timeline-dot" cx={cx} cy={24} r={dotR} fill={dot.color} />
              <text x={cx} y={48} textAnchor="middle" fill="var(--text)" fontSize={12} fontFamily={TIMELINE_FONT} fontWeight={500}>
                {dot.label}
              </text>
              <text x={cx} y={64} textAnchor="middle" fill="var(--text-secondary)" fontSize={11} fontFamily={TIMELINE_FONT}>
                {dot.sublabel}
              </text>
              <text x={cx} y={78} textAnchor="middle" fill="var(--text-secondary)" fontSize={11} fontFamily={TIMELINE_FONT} fontStyle="italic">
                {dot.date}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  pr_review: "PR review",
  pr_comment: "PR discussion",
  inline_review: "Code review",
  issue_comment: "Issue thread",
  commit_message: "Commit",
  unknown: "Source",
};

const SIGNAL_ICONS: Record<string, string> = {
  git_blame: "⎔",
  pull_request: "⑂",
  review_comments: "✎",
  pr_discussion: "💬",
  linked_issues: "◉",
  commit_message_only: "›",
  pattern_match: "⚡",
};

const NarrativePanel = ({
  narrative,
  line,
  onListenClick,
}: {
  narrative: InsightNarrative | null;
  line: number | null;
  onListenClick?: () => void;
}) => {
  if (!narrative) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="opacity-30">
          <rect x="6" y="10" width="36" height="28" rx="3" stroke="currentColor" strokeWidth="1.5" className="text-gitlore-text-secondary" />
          <line x1="12" y1="18" x2="36" y2="18" stroke="currentColor" strokeWidth="1.5" className="text-gitlore-accent" strokeOpacity="0.5" />
          <line x1="12" y1="24" x2="30" y2="24" stroke="currentColor" strokeWidth="1.5" className="text-gitlore-text-secondary" />
          <line x1="12" y1="30" x2="33" y2="30" stroke="currentColor" strokeWidth="1.5" className="text-gitlore-text-secondary" />
          <circle cx="40" cy="10" r="5" fill="currentColor" className="text-gitlore-accent" fillOpacity="0.3" />
        </svg>
        <div className="text-center">
          <p className="font-body text-sm font-medium text-gitlore-text-secondary">Click any line number</p>
          <p className="mt-1 font-body text-xs text-gitlore-text-secondary/60">to uncover the story behind the code</p>
        </div>
      </div>
    );
  }

  const confLevel = narrative.confidence;
  const confColor = confLevel === "HIGH" ? "#2ECC71" : confLevel === "MEDIUM" ? "#C9A84C" : "#666";
  const confGlow = confLevel === "HIGH" ? "0 0 8px rgba(46,204,113,0.3)" : confLevel === "MEDIUM" ? "0 0 8px rgba(201,168,76,0.3)" : "none";

  return (
    <div className="flex flex-col font-body" style={{ maxHeight: "100%", overflowY: "auto" }}>
      {/* ── Gradient accent bar ── */}
      <div
        style={{
          height: 3,
          background: confLevel === "HIGH"
            ? "linear-gradient(90deg, #2ECC71, #27AE60)"
            : confLevel === "MEDIUM"
              ? "linear-gradient(90deg, #C9A84C, #F39C12)"
              : "linear-gradient(90deg, #555, #444)",
        }}
      />

      <div className="space-y-4 p-4 md:p-5">
        {/* ── Header ── */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-snug text-gitlore-text">{narrative.oneLiner}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-gitlore-text-secondary">
              {line !== null && (
                <span className="inline-flex items-center gap-1">
                  <span style={{ color: confColor, fontSize: 10 }}>●</span>
                  Line {line}
                </span>
              )}
              {narrative.confidenceReason && (
                <>
                  <span className="text-gitlore-border/40">·</span>
                  <span>{narrative.confidenceReason}</span>
                </>
              )}
            </div>
          </div>
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[11px] font-bold tracking-wide"
            style={{
              color: confColor,
              background: `${confColor}15`,
              border: `1px solid ${confColor}30`,
              boxShadow: confGlow,
            }}
            title={narrative.confidenceReason || `Confidence: ${narrative.confidence}`}
          >
            {narrative.confidence}
          </span>
        </div>

        {/* ── Timeline ── */}
        <StoryTimeline dots={narrative.timeline} />

        {/* ── Context ── */}
        {narrative.context && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span style={{ fontSize: 10, color: "#C9A84C" }}>◆</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gitlore-text-secondary">Context</span>
            </div>
            <p className="text-[13px] leading-relaxed text-gitlore-text/90">{narrative.context}</p>
          </div>
        )}

        {/* ── The Debate ── */}
        {narrative.debate && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span style={{ fontSize: 10, color: "#E74C3C" }}>◆</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gitlore-text-secondary">The Debate</span>
            </div>
            <p className="text-[13px] leading-relaxed text-gitlore-text/90">{narrative.debate}</p>
          </div>
        )}

        {/* ── Debate Quotes ── */}
        {narrative.debateQuotes.length > 0 && (
          <div className="space-y-2">
            {narrative.debateQuotes.map((q, i) => (
              <div
                key={`quote-${i}`}
                className="relative overflow-hidden rounded border border-[var(--border-accent)]"
                style={{
                  background: "linear-gradient(135deg, var(--accent-dim), var(--elevated))",
                }}
              >
                {/* Left accent bar */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-[3px]"
                  style={{
                    background: q.sourceType === "pr_review" ? "#C9A84C"
                      : q.sourceType === "inline_review" ? "#9B59B6"
                      : q.sourceType === "issue_comment" ? "#2ECC71"
                      : "#F39C12",
                  }}
                />
                <div className="px-3.5 py-2.5 pl-4">
                  <p className="text-[13px] leading-relaxed text-gitlore-text" style={{ fontStyle: "italic" }}>
                    "{q.text}"
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ background: "rgba(201,168,76,0.15)", color: "#C9A84C" }}
                    >
                      @{q.author}
                    </span>
                    <span className="text-[10px] text-gitlore-text-secondary/60">
                      {SOURCE_TYPE_LABELS[q.sourceType] || q.sourceType || "Source"}
                    </span>
                    {q.url && (
                      <a
                        href={q.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-medium transition-colors"
                        style={{ color: "#C9A84C" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#F39C12")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#C9A84C")}
                      >
                        view on GitHub →
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Decision + Impact cards ── */}
        <div className="grid grid-cols-1 gap-2">
          {narrative.decision && (
            <div
              className="rounded px-3.5 py-2.5"
              style={{
                background: "linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.02))",
                border: "1px solid rgba(201,168,76,0.2)",
              }}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span style={{ fontSize: 8, color: "#C9A84C" }}>▶</span>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#C9A84C" }}>Decision</span>
              </div>
              <div className="text-[13px] leading-relaxed text-gitlore-text/90">{narrative.decision}</div>
            </div>
          )}

          {narrative.impact && (
            <div
              className="rounded px-3.5 py-2.5"
              style={{
                background: "linear-gradient(135deg, rgba(46,204,113,0.08), rgba(46,204,113,0.02))",
                border: "1px solid rgba(46,204,113,0.2)",
              }}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span style={{ fontSize: 8, color: "#2ECC71" }}>▶</span>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#2ECC71" }}>Impact</span>
              </div>
              <div className="text-[13px] leading-relaxed text-gitlore-text/90">{narrative.impact}</div>
            </div>
          )}
        </div>

        {/* ── Sources + Data Signals ── (theme tokens — was hardcoded dark panel, broke light mode) */}
        <div className="rounded border border-gitlore-border bg-[var(--elevated)] px-3.5 py-3">
          {/* Source links */}
          {(narrative.sources.prUrl || narrative.sources.issueUrls.length > 0) && (
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gitlore-text-secondary">Sources</span>
              {narrative.sources.prUrl && (
                <a
                  href={narrative.sources.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all"
                  style={{
                    background: "rgba(201,168,76,0.1)",
                    border: "1px solid rgba(201,168,76,0.25)",
                    color: "#C9A84C",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(201,168,76,0.2)";
                    e.currentTarget.style.borderColor = "rgba(201,168,76,0.5)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(201,168,76,0.1)";
                    e.currentTarget.style.borderColor = "rgba(201,168,76,0.25)";
                  }}
                >
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M7.177 3.073L9.573.677A3.214 3.214 0 0114.1.677a3.214 3.214 0 010 4.528l-2.396 2.396a.5.5 0 01-.707-.707l2.396-2.396a2.214 2.214 0 00-3.132-3.132L7.865 3.762a.5.5 0 01-.688-.689z"/><path fillRule="evenodd" d="M8.823 12.927l-2.396 2.396a3.214 3.214 0 01-4.528-4.528l2.396-2.396a.5.5 0 01.707.707L2.606 11.502a2.214 2.214 0 003.132 3.132l2.396-2.396a.5.5 0 01.689.689z"/><path fillRule="evenodd" d="M6.354 10.354a.5.5 0 010-.708l3.292-3.293a.5.5 0 01.708.708l-3.293 3.293a.5.5 0 01-.707 0z"/></svg>
                  Pull Request
                </a>
              )}
              {narrative.sources.issueUrls.map((url, i) => (
                <a
                  key={`issue-${i}`}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all"
                  style={{
                    background: "rgba(46,204,113,0.1)",
                    border: "1px solid rgba(46,204,113,0.25)",
                    color: "#2ECC71",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(46,204,113,0.2)";
                    e.currentTarget.style.borderColor = "rgba(46,204,113,0.5)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(46,204,113,0.1)";
                    e.currentTarget.style.borderColor = "rgba(46,204,113,0.25)";
                  }}
                >
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1" fill="none"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>
                  Issue #{url.split("/").pop()}
                </a>
              ))}
            </div>
          )}

          {/* Data signal tags */}
          {narrative.sources.dataSignals.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {narrative.sources.dataSignals.map((signal) => (
                <span
                  key={signal}
                  className="inline-flex items-center gap-1 rounded border border-gitlore-border bg-gitlore-surface px-2 py-0.5 text-[10px] font-medium text-gitlore-text-secondary"
                >
                  <span className="text-[10px] text-gitlore-text-secondary" aria-hidden>
                    {SIGNAL_ICONS[signal] || "·"}
                  </span>
                  {signal.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Listen button ── */}
        <button
          type="button"
          onClick={() => onListenClick?.()}
          className="group inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-all"
          style={{
            background: "linear-gradient(135deg, rgba(201,168,76,0.1), rgba(201,168,76,0.05))",
            border: "1px solid rgba(201,168,76,0.3)",
            color: "#C9A84C",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.1))";
            e.currentTarget.style.borderColor = "rgba(201,168,76,0.5)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "linear-gradient(135deg, rgba(201,168,76,0.1), rgba(201,168,76,0.05))";
            e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)";
          }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M12 6.253v11.494M18.364 5.636a9 9 0 010 12.728M8.464 15.536a5 5 0 010-7.072M5.636 18.364a9 9 0 010-12.728" />
          </svg>
          Listen to this story
        </button>
      </div>
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
  const { target, repoFull, setTarget, repoReady } = useRepo();
  const isMobile = useIsMobile();
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [sourceCode, setSourceCode] = useState(FALLBACK_CODE);
  const [fileLoading, setFileLoading] = useState(false);
  const [codeWrap, setCodeWrap] = useState(() => {
    try {
      return localStorage.getItem("gitlore-code-wrap") === "true";
    } catch {
      return false;
    }
  });
  const [pulls, setPulls] = useState<RepoPullSummary[]>([]);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [prListLoading, setPrListLoading] = useState(false);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [prDiffLoading, setPrDiffLoading] = useState(false);
  const [prDiffErr, setPrDiffErr] = useState<string | null>(null);
  const [prHeadRef, setPrHeadRef] = useState<string | null>(null);
  const [prChangedFiles, setPrChangedFiles] = useState<PullDiffReviewFile[]>([]);
  const [prBundleMeta, setPrBundleMeta] = useState<{
    number: number;
    title: string;
    state: string;
    htmlUrl: string;
    authorLogin: string | null;
  } | null>(null);
  const [pendingEditorScrollLine, setPendingEditorScrollLine] = useState<number | null>(null);
  const [browseRepoExpanded, setBrowseRepoExpanded] = useState(true);
  const [explanationCommentId, setExplanationCommentId] = useState<number | null>(null);
  const [panel, setPanel] = useState<PanelContent>({ type: "idle" });
  const [insightLoading, setInsightLoading] = useState(false);
  const [repoCheckMsg, setRepoCheckMsg] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("code");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [storyVoiceOpen, setStoryVoiceOpen] = useState(false);
  /** Frozen narrative context for voice UI so WebRTC is not torn down when panel goes `idle` during re-analyze. */
  const [storyVoiceSnapshot, setStoryVoiceSnapshot] = useState<{
    narrative: InsightNarrative;
    line: number;
    filePath: string;
  } | null>(null);
  /** Open narrative from navbar Decisions search after file content loads. */
  const [pendingDecisionOpen, setPendingDecisionOpen] = useState<{ file: string; line: number } | null>(null);
  const [activeFeature, setActiveFeature] = useState<ActiveFeature>("archaeology");
  const panelContentDesktopRef = useRef<HTMLDivElement>(null);
  const panelContentMobileRef = useRef<HTMLDivElement>(null);
  const prevFeatRef = useRef<ActiveFeature | null>(null);

  const effectiveFileRef = useMemo(() => {
    if (activeFeature !== "review") return target.branch;
    if (
      selectedPrNumber == null ||
      prDiffLoading ||
      prDiffErr ||
      !prHeadRef
    ) {
      return target.branch;
    }
    return prHeadRef;
  }, [
    activeFeature,
    selectedPrNumber,
    prDiffLoading,
    prDiffErr,
    prHeadRef,
    target.branch,
  ]);

  useEffect(() => {
    if (authLoading || !user || repoReady) return;
    navigate("/repos", { replace: true });
  }, [authLoading, user, repoReady, navigate]);

  useEffect(() => {
    const t = panel.type;
    if (t === "narrative" || t === "idle") return;
    setStoryVoiceOpen(false);
    setStoryVoiceSnapshot(null);
  }, [panel.type]);

  useEffect(() => {
    setExplanationCommentId(null);
  }, [selectedPrNumber]);

  /** Feature toggle: fade panel and reset without re-sliding the column. */
  useEffect(() => {
    if (prevFeatRef.current === null) {
      prevFeatRef.current = activeFeature;
      return;
    }
    if (prevFeatRef.current === activeFeature) return;
    prevFeatRef.current = activeFeature;
    const els = [panelContentDesktopRef.current, panelContentMobileRef.current].filter(
      Boolean
    ) as HTMLDivElement[];
    const reset = () => {
      setPanel({ type: "idle" });
      setInsightLoading(false);
      setExplanationCommentId(null);
    };
    if (els.length) {
      gsap.to(els, {
        opacity: 0,
        duration: 0.15,
        onComplete: () => {
          reset();
          gsap.to(els, { opacity: 1, duration: 0.15 });
        },
      });
    } else {
      reset();
    }
  }, [activeFeature]);

  const onSelectPrFile = useCallback(
    (path: string) => {
      if (!path.trim()) return;
      const line = firstLineForPrFile(path, reviewComments, diffLines);
      setTarget({ filePath: path });
      setPendingEditorScrollLine(line);
    },
    [setTarget, reviewComments, diffLines]
  );

  const onSelectFileTreeOnly = useCallback(
    (path: string) => {
      setTarget({ filePath: path });
      setPendingEditorScrollLine(null);
    },
    [setTarget]
  );

  const clearPendingEditorScroll = useCallback(() => setPendingEditorScrollLine(null), []);

  useEffect(() => {
    const st = location.state as { file?: string; analyzeLine?: number } | null;
    if (!st?.file) return;
    setTarget({ filePath: st.file });
    setLeftTab("code");
    if (typeof st.analyzeLine === "number" && st.analyzeLine > 0) {
      setPendingDecisionOpen({ file: st.file, line: st.analyzeLine });
    }
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate, setTarget]);

  useEffect(() => {
    if (!pendingDecisionOpen || !user || !repoReady || fileLoading) return;
    if (target.filePath !== pendingDecisionOpen.file) return;

    const { line } = pendingDecisionOpen;
    setPendingDecisionOpen(null);

    let cancelled = false;
    setPanelOpen(true);
    setInsightLoading(true);
    setPanel({ type: "idle" });
    setSelectedLine(line);
    void (async () => {
      try {
        const data = await analyzeLine({
          repo: repoFull,
          file_path: target.filePath,
          line_number: line,
          branch: target.branch,
        });
        if (!cancelled) setPanel({ type: "narrative", line, data });
      } catch (e) {
        if (!cancelled) {
          setPanel({ type: "error", message: e instanceof Error ? e.message : "Analyze request failed" });
        }
      } finally {
        if (!cancelled) setInsightLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingDecisionOpen, fileLoading, user, repoReady, target.filePath, target.branch, repoFull]);

  useEffect(() => {
    if (!user || !repoReady) {
      setPulls([]);
      setSelectedPrNumber(null);
      setPrListLoading(false);
      return;
    }
    let cancelled = false;
    setPrListLoading(true);
    void fetchRepoPullRequests(target.owner, target.name, 25)
      .then((list) => {
        if (cancelled) return;
        setPulls(list);
        setSelectedPrNumber((prev) => {
          if (prev != null && list.some((p) => p.number === prev)) return prev;
          return list[0]?.number ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPulls([]);
          setSelectedPrNumber(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPrListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, repoReady, target.owner, target.name]);

  useEffect(() => {
    if (!user || !repoReady || selectedPrNumber == null) {
      setDiffLines([]);
      setReviewComments([]);
      setPrDiffErr(null);
      setPrDiffLoading(false);
      setPrHeadRef(null);
      setPrChangedFiles([]);
      setPrBundleMeta(null);
      return;
    }
    let cancelled = false;
    setPrDiffLoading(true);
    setPrDiffErr(null);
    setPrHeadRef(null);
    setPrChangedFiles([]);
    setPrBundleMeta(null);
    void fetchPullDiffReview(target.owner, target.name, selectedPrNumber)
      .then((bundle) => {
        if (cancelled) return;
        const parsed = parseUnifiedDiff(bundle.diff || "");
        setDiffLines(parsed);
        setReviewComments(
          bundle.comments.map((c) => ({
            id: c.id,
            path: c.path,
            line: c.line,
            text: c.body,
            author: c.author,
            diff_hunk: c.diff_hunk,
          }))
        );
        setPrHeadRef(bundle.head.sha);
        setPrChangedFiles(
          [...bundle.files].sort((a, b) => a.filename.localeCompare(b.filename))
        );
        setPrBundleMeta({
          number: bundle.number,
          title: bundle.title,
          state: bundle.state,
          htmlUrl: bundle.htmlUrl,
          authorLogin: bundle.authorLogin,
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setDiffLines([]);
          setReviewComments([]);
          setPrHeadRef(null);
          setPrChangedFiles([]);
          setPrBundleMeta(null);
          setPrDiffErr(e instanceof Error ? e.message : "Failed to load PR diff");
        }
      })
      .finally(() => {
        if (!cancelled) setPrDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, repoReady, target.owner, target.name, selectedPrNumber]);

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
    void fetchRepoFileRaw(target.owner, target.name, target.filePath, effectiveFileRef)
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
  }, [user, repoReady, target.owner, target.name, target.filePath, effectiveFileRef]);

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
      if (selectedPrNumber == null) return;
      if (comment.path?.trim() && !pathsMatchPrCommentFile(comment.path, target.filePath)) {
        setTarget({ filePath: comment.path });
      }
      setPendingEditorScrollLine(comment.line ?? 1);
      const lineNo = comment.line ?? 1;
      setPanelOpen(true);
      setInsightLoading(true);
      setPanel({ type: "idle" });
      setExplanationCommentId(null);
      try {
        const diffPayload =
          (comment.diff_hunk && comment.diff_hunk.trim()) || diffLinesToHunkString(diffLines);
        const data = await explainComment({
          comment: comment.text,
          diff_hunk: diffPayload || "(no diff hunk)",
          file_path: comment.path || target.filePath || "file",
          line: lineNo,
          repo: repoFull,
          pr_number: selectedPrNumber,
        });
        setExplanationCommentId(comment.id);
        setPanel({
          type: "explanation",
          data: { ...data, prNumber: selectedPrNumber ?? undefined },
          diffHunk: comment.diff_hunk,
          prNumber: selectedPrNumber,
        });
      } catch (e) {
        setPanel({ type: "error", message: e instanceof Error ? e.message : "Explain request failed" });
      } finally {
        setInsightLoading(false);
      }
    },
    [user, repoFull, selectedPrNumber, target.filePath, diffLines, setTarget]
  );

  const inlineCommentRows = useMemo(
    () =>
      reviewComments
        .filter((c) => pathsMatchPrCommentFile(c.path, target.filePath) && c.line != null)
        .map((c) => ({
          id: String(c.id),
          line: c.line!,
          body: c.text,
          author: c.author,
          url:
            selectedPrNumber != null
              ? `https://github.com/${target.owner}/${target.name}/pull/${selectedPrNumber}#discussion_r${c.id}`
              : "",
          diff_hunk: c.diff_hunk ?? "",
        })),
    [reviewComments, target.filePath, target.owner, target.name, selectedPrNumber]
  );

  const cmInlineExtensions = useMemo(
    () =>
      inlineCommentsExtension(
        inlineCommentRows,
        activeFeature === "review",
        (badge) => {
          const c = reviewComments.find((x) => String(x.id) === badge.id);
          if (c) void handleCommentClick(c);
        }
      ),
    [inlineCommentRows, activeFeature, reviewComments, handleCommentClick]
  );

  /** Visible feedback when PR changes / comments load (Review Comments mode). */
  const reviewPrStatusBanner =
    activeFeature === "review" && leftTab === "code" ? (
      <div className="shrink-0 border-b border-gitlore-border bg-gitlore-surface/95 px-3 py-2 text-[11px] text-gitlore-text-secondary md:text-xs">
        {selectedPrNumber == null && (
          <span>Select a pull request in the sidebar to load review comments.</span>
        )}
        {selectedPrNumber != null && prDiffLoading && <span>Loading PR #{selectedPrNumber}…</span>}
        {selectedPrNumber != null && !prDiffLoading && prDiffErr && (
          <span className="text-gitlore-error">
            Could not load PR #{selectedPrNumber}: {prDiffErr}
          </span>
        )}
        {selectedPrNumber != null && !prDiffLoading && !prDiffErr && (
          <div className="space-y-1">
            <span className="block truncate">
              PR #{selectedPrNumber} · {reviewComments.length} review comment
              {reviewComments.length === 1 ? "" : "s"}
              {inlineCommentRows.length > 0 && ` · ${inlineCommentRows.length} on this file`}
            </span>
            {reviewComments.length === 0 && (
              <span className="block text-gitlore-text-secondary/90">
                No inline review comments on this pull request.
              </span>
            )}
            {reviewComments.length > 0 && inlineCommentRows.length === 0 && (
              <span className="block text-gitlore-text-secondary/90">
                No comments on the current file in this PR. Use &quot;Changed in this PR&quot; in the sidebar, browse the tree, or open the Diff tab.
              </span>
            )}
          </div>
        )}
      </div>
    ) : null;

  const handleLineClickAnime = useCallback(
    async (lineNum: number, el?: HTMLElement) => {
      if (activeFeature !== "archaeology") return;
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
    [user, repoFull, target.filePath, target.branch, activeFeature]
  );

  const handleDiffLineClick = useCallback((lineNum: number, el: HTMLElement) => {
    animeAnimate(el, {
      backgroundColor: ["rgba(201,168,76,0)", "rgba(201,168,76,0.15)", "rgba(201,168,76,0.05)"],
      duration: 800,
      ease: "outQuad",
    });
  }, []);

  const codeLines = sourceCode.split("\n");
  const blamePlaceholderShort = "Git blame · analyze line";
  const blameLines = codeLines.map((_, i) => {
    const ln = i + 1;
    if (panel.type === "narrative" && panel.line === ln) return compactBlameFromNarrative(panel.data);
    return blamePlaceholderShort;
  });

  const panelUI =
    insightLoading ? (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-center font-body text-sm text-gitlore-text-secondary">Loading insight…</p>
      </div>
    ) : panel.type === "need-auth" ? (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <p className="text-center font-body text-sm leading-relaxed text-gitlore-text-secondary">
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
      <div className="p-5 font-body">
        <p className="text-sm leading-relaxed text-gitlore-error">{panel.message}</p>
      </div>
    ) : panel.type === "explanation" ? (
      <ExplanationView
        data={panel.data}
        loading={false}
        error={null}
        diffHunk={panel.diffHunk}
        prNumber={panel.prNumber}
      />
    ) : panel.type === "narrative" ? (
      <NarrativePanel
        narrative={panel.data}
        line={panel.line}
        onListenClick={() => {
          setStoryVoiceSnapshot({
            narrative: panel.data,
            line: panel.line,
            filePath: target.filePath || "",
          });
          setStoryVoiceOpen(true);
        }}
      />
    ) : panel.type === "idle" && activeFeature === "review" && user ? (
      <PrReviewOverview
        meta={prBundleMeta}
        changedFiles={prChangedFiles}
        comments={reviewComments.map((c) => ({
          id: c.id,
          path: c.path,
          line: c.line,
          text: c.text,
          author: c.author,
        }))}
        loading={selectedPrNumber != null && prDiffLoading}
        error={prDiffErr}
        onCommentClick={(c) => {
          const rc = reviewComments.find((x) => x.id === c.id);
          if (rc) void handleCommentClick(rc);
        }}
      />
    ) : (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-center font-body text-sm leading-relaxed text-gitlore-text-secondary">
          {activeFeature === "archaeology"
            ? "Click a line to analyze the configured file path with Git blame (see bar above)."
            : "Sign in with GitHub to load pull requests and review comments in this panel."}
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
            title={showText && blame ? blame : undefined}
            className={`overflow-hidden text-ellipsis whitespace-nowrap px-2 transition-colors ${blameRowClass} ${isActive ? "bg-gitlore-accent/8" : ""}`}
          >
            <span className="block truncate font-code text-gitlore-text-secondary/50 max-md:text-[13px]">{showText ? blame : ""}</span>
          </div>
        );
      })}
    </>
  );


  const selectedBlame =
    selectedLine == null
      ? null
      : panel.type === "narrative" && panel.line === selectedLine
        ? compactBlameFromNarrative(panel.data)
        : blamePlaceholderShort;

  const codeEditor = (
    <Suspense fallback={<CodeEditorSkeleton mobile={isMobile} />}>
      <AppViewCodeEditor
        value={sourceCode}
        filePath={target.filePath || ""}
        isMobile={isMobile}
        mobileCodeWrap={codeWrap}
        fileLoading={fileLoading}
        selectedLine={selectedLine}
        onLineActivate={(line) => void handleLineClickAnime(line)}
        extraExtensions={cmInlineExtensions}
        enableLineHistory={activeFeature === "archaeology"}
        scrollToLine={pendingEditorScrollLine}
        onScrolledToLine={clearPendingEditorScroll}
      />
    </Suspense>
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
      <div className="px-4 pb-2">
        <FeatureToggle activeFeature={activeFeature} onToggle={setActiveFeature} />
      </div>
      {mobileTreeOpen && (
        <div className="space-y-3 border-t border-gitlore-border px-3 pb-3 pt-2">
          <div>
            <div className="text-xs text-gitlore-text-secondary uppercase tracking-wider mb-2 font-medium">Pull Request</div>
            <PRDropdown
              pulls={pulls}
              selectedNumber={selectedPrNumber}
              onSelect={setSelectedPrNumber}
              loading={prListLoading}
              emptyHint="No PRs in this repo"
            />
          </div>
          <div>
            {activeFeature === "review" && selectedPrNumber != null && (
              <div className="mb-3">
                <div className="mb-2 px-1 font-code text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
                  Changed in this PR
                </div>
                {prDiffLoading && (
                  <p className="flex items-center gap-2 px-2 py-1 text-xs text-gitlore-text-secondary" role="status">
                    <Spinner className="h-3.5 w-3.5" label="Loading PR files" />
                    Loading…
                  </p>
                )}
                {!prDiffLoading && prDiffErr && (
                  <p className="px-2 py-1 font-code text-[11px] text-gitlore-error">{prDiffErr}</p>
                )}
                {!prDiffLoading &&
                  !prDiffErr &&
                  prChangedFiles.map((f) => (
                    <button
                      key={f.filename}
                      type="button"
                      onClick={() => onSelectPrFile(f.filename)}
                      className={`mb-0.5 w-full rounded-sm px-2 py-1.5 text-left font-code text-[11px] ${
                        pathsMatchPrCommentFile(f.filename, target.filePath)
                          ? "bg-gitlore-accent/15 text-gitlore-accent"
                          : "text-gitlore-text hover:bg-gitlore-surface-hover"
                      }`}
                    >
                      <span className="block truncate">{f.filename}</span>
                      <span className="mt-0.5 block text-[10px] text-gitlore-text-secondary">
                        {f.status}
                        {f.additions + f.deletions > 0 ? ` · +${f.additions} −${f.deletions}` : ""}
                      </span>
                    </button>
                  ))}
              </div>
            )}
            {activeFeature === "review" && (
              <button
                type="button"
                onClick={() => setBrowseRepoExpanded((v) => !v)}
                className="mb-2 w-full rounded-sm border border-gitlore-border/80 px-2 py-1.5 text-left font-code text-[10px] text-gitlore-text-secondary"
              >
                {browseRepoExpanded ? "Hide repository tree" : "Show repository tree"}
              </button>
            )}
            {(activeFeature === "archaeology" || browseRepoExpanded) && (
              <>
                <div className="text-xs text-gitlore-text-secondary uppercase tracking-wider mb-2 px-1 font-medium">Files</div>
                {treeError && (
                  <p className="px-2 py-1 font-code text-[11px] text-gitlore-error">{treeError}</p>
                )}
                {treeLoading && (
                  <p className="flex items-center gap-2 px-2 py-1 text-xs text-gitlore-text-secondary" role="status">
                    <Spinner className="h-3.5 w-3.5" label="Loading file tree" />
                    Loading tree…
                  </p>
                )}
                {!treeLoading &&
                  fileTree.map((node) => (
                    <FileTreeNode
                      key={node.name}
                      node={node}
                      selectedPath={target.filePath}
                      onSelectFile={onSelectFileTreeOnly}
                    />
                  ))}
              </>
            )}
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
        <button
          type="button"
          onClick={() => {
            const next = !codeWrap;
            try {
              localStorage.setItem("gitlore-code-wrap", next ? "true" : "false");
            } catch {
              /* ignore */
            }
            setCodeWrap(next);
          }}
          className={`hidden shrink-0 md:inline-flex h-8 w-8 items-center justify-center rounded-sm border border-gitlore-border text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface-hover hover:text-gitlore-text ${codeWrap ? "border-gitlore-accent/60 text-gitlore-accent" : ""}`}
          title={codeWrap ? "Disable line wrap" : "Wrap long lines"}
          aria-pressed={codeWrap}
          aria-label={codeWrap ? "Disable line wrap" : "Wrap long lines"}
        >
          <WrapText className="h-4 w-4 shrink-0" aria-hidden />
        </button>
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
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gitlore-surface md:border-r md:border-gitlore-border">
      <div className="relative z-30 shrink-0 border-b border-gitlore-border bg-gitlore-surface p-3">
        <div className="text-xs text-gitlore-text-secondary uppercase tracking-wider mb-2 font-medium md:max-lg:text-[11px]">Pull Request</div>
        <PRDropdown
          pulls={pulls}
          selectedNumber={selectedPrNumber}
          onSelect={setSelectedPrNumber}
          loading={prListLoading}
          emptyHint="No PRs in this repo"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
        {activeFeature === "review" && selectedPrNumber != null && (
          <div className="mb-3">
            <div className="mb-2 px-2 font-code text-[10px] font-medium uppercase tracking-wider text-gitlore-text-secondary md:max-lg:text-[11px]">
              Changed in this PR
            </div>
            {prDiffLoading && (
              <p className="flex items-center gap-2 px-2 py-1 text-xs text-gitlore-text-secondary" role="status">
                <Spinner className="h-3.5 w-3.5" label="Loading PR files" />
                Loading…
              </p>
            )}
            {!prDiffLoading && prDiffErr && (
              <p className="px-2 py-1 font-code text-[11px] text-gitlore-error">{prDiffErr}</p>
            )}
            {!prDiffLoading && !prDiffErr &&
              prChangedFiles.map((f) => (
                <button
                  key={f.filename}
                  type="button"
                  onClick={() => onSelectPrFile(f.filename)}
                  className={`mb-0.5 w-full rounded-sm px-2 py-1.5 text-left font-code text-[11px] transition-colors md:text-xs ${
                    pathsMatchPrCommentFile(f.filename, target.filePath)
                      ? "bg-gitlore-accent/15 text-gitlore-accent"
                      : "text-gitlore-text hover:bg-gitlore-surface-hover"
                  }`}
                >
                  <span className="block truncate" title={f.filename}>
                    {f.filename}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-gitlore-text-secondary">
                    {f.status}
                    {f.additions + f.deletions > 0
                      ? ` · +${f.additions} −${f.deletions}`
                      : ""}
                  </span>
                </button>
              ))}
          </div>
        )}
        {activeFeature === "review" && (
          <button
            type="button"
            onClick={() => setBrowseRepoExpanded((v) => !v)}
            className="mb-2 w-full rounded-sm border border-gitlore-border/80 px-2 py-1.5 text-left font-code text-[10px] text-gitlore-text-secondary transition-colors hover:bg-gitlore-surface-hover md:text-[11px]"
          >
            {browseRepoExpanded ? "Hide repository tree" : "Show repository tree"}
          </button>
        )}
        {(activeFeature === "archaeology" || browseRepoExpanded) && (
          <>
            <div className="text-xs text-gitlore-text-secondary uppercase tracking-wider mb-2 px-2 font-medium md:max-lg:text-[11px]">
              Files
            </div>
            {treeError && (
              <p className="px-2 py-1 font-code text-[11px] text-gitlore-error">{treeError}</p>
            )}
            {treeLoading && (
              <p className="flex items-center gap-2 px-2 py-1 text-xs text-gitlore-text-secondary" role="status">
                <Spinner className="h-3.5 w-3.5" label="Loading file tree" />
                Loading tree…
              </p>
            )}
            {!treeLoading &&
              fileTree.map((node) => (
                <FileTreeNode
                  key={node.name}
                  node={node}
                  selectedPath={target.filePath}
                  onSelectFile={onSelectFileTreeOnly}
                />
              ))}
          </>
        )}
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
    <>
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
    <div className="flex shrink-0 items-center gap-3 border-b border-gitlore-border bg-gitlore-surface px-3 py-2">
      <FeatureToggle activeFeature={activeFeature} onToggle={setActiveFeature} />
    </div>
    </>
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
    user && !repoReady ? (
      <div className="flex shrink-0 flex-col items-center justify-center gap-2 border-b border-gitlore-border bg-gitlore-surface px-3 py-8 text-center text-sm text-gitlore-text-secondary">
        <p className="max-w-md">
          No repository selected. Go to{" "}
          <Link to="/repos" className="text-gitlore-accent hover:text-gitlore-accent-hover">
            repository selection
          </Link>{" "}
          or use the header search <span className="text-gitlore-text">Repositories</span> tab.
        </p>
      </div>
    ) : null;

  const showRepoBar = true;
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
                  <div className="mt-3 flex items-center gap-2 border-t border-gitlore-border/60 pt-2.5">
                    <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-gitlore-text-secondary">Code lines</span>
                    <div className="ml-auto flex rounded-sm border border-gitlore-border p-0.5 font-code text-[10px] font-medium">
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            localStorage.setItem("gitlore-code-wrap", "true");
                          } catch {
                            /* ignore */
                          }
                          setCodeWrap(true);
                        }}
                        className={`rounded-[2px] px-2 py-1 transition-colors ${codeWrap ? "bg-gitlore-accent/20 text-gitlore-accent" : "text-gitlore-text-secondary hover:text-gitlore-text"}`}
                      >
                        Wrap
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            localStorage.setItem("gitlore-code-wrap", "false");
                          } catch {
                            /* ignore */
                          }
                          setCodeWrap(false);
                        }}
                        className={`rounded-[2px] px-2 py-1 transition-colors ${!codeWrap ? "bg-gitlore-accent/20 text-gitlore-accent" : "text-gitlore-text-secondary hover:text-gitlore-text"}`}
                      >
                        No wrap
                      </button>
                    </div>
                  </div>
                </div>
                {reviewPrStatusBanner}
                <div className="min-h-0 flex-1 overflow-auto">
                  {codeEditor}
                </div>
              </div>
            ) : (
              <div className="h-full overflow-auto p-3">
                <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary md:max-lg:text-[11px]">Changes</div>
                {prDiffLoading && <DiffLoadingBlock />}
                {prDiffErr && <p className="text-sm text-gitlore-error">{prDiffErr}</p>}
                {!prDiffLoading && !prDiffErr && (
                  <DiffViewer
                    lines={diffLines}
                    comments={reviewComments}
                    onCommentClick={handleCommentClick}
                    onLineClick={handleDiffLineClick}
                    activeCommentId={panel.type === "explanation" ? explanationCommentId : null}
                  />
                )}
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
                      <>
                        {reviewPrStatusBanner}
                        <Group
                          className="min-h-0 flex-1 w-full"
                          orientation="horizontal"
                          id="gitlore-app-blame"
                          defaultLayout={blameLayout.defaultLayout}
                          onLayoutChanged={blameLayout.onLayoutChanged}
                          groupRef={blameGroupRef}
                        >
                        <Panel id="blame" defaultSize="15%" minSize="11%" maxSize="34%" className="min-h-0 min-w-0">
                          <div className="flex h-full min-h-0 w-[140px] min-w-0 select-none flex-col overflow-hidden border-l border-gitlore-border/30 border-r border-gitlore-border bg-gitlore-code md:w-[200px] md:min-w-[160px] md:max-w-[240px]">
                            {blameColumn}
                          </div>
                        </Panel>
                        <IdeResizeHandle />
                        <Panel id="code" defaultSize="85%" minSize="40%" className="min-h-0 min-w-0">
                          <div className="h-full min-h-0 min-w-0 overflow-auto bg-gitlore-code">{codeEditor}</div>
                        </Panel>
                      </Group>
                      </>
                    ) : (
                      <div className="min-h-0 flex-1 overflow-auto">
                        <div className="w-full min-w-0 p-3 md:p-4">
                          <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gitlore-text-secondary md:max-lg:text-[11px]">Changes</div>
                          {prDiffLoading && <DiffLoadingBlock />}
                          {prDiffErr && <p className="text-sm text-gitlore-error">{prDiffErr}</p>}
                          {!prDiffLoading && !prDiffErr && (
                            <DiffViewer
                              lines={diffLines}
                              comments={reviewComments}
                              onCommentClick={handleCommentClick}
                              onLineClick={handleDiffLineClick}
                              activeCommentId={panel.type === "explanation" ? explanationCommentId : null}
                            />
                          )}
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
                  className="h-full overflow-auto border-l border-gitlore-border bg-gitlore-surface"
                >
                  <div ref={panelContentDesktopRef} className="panel-content h-full min-h-0">
                    {panelUI}
                  </div>
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
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div ref={panelContentMobileRef} className="panel-content h-full min-h-0">
                {panelUI}
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
      ) : null}

      {storyVoiceOpen && storyVoiceSnapshot && (
        <Suspense fallback={null}>
          <StoryVoiceGate
            open={storyVoiceOpen}
            onClose={() => {
              setStoryVoiceOpen(false);
              setStoryVoiceSnapshot(null);
            }}
            narrative={storyVoiceSnapshot.narrative}
            line={storyVoiceSnapshot.line}
            repoFull={repoFull}
            filePath={storyVoiceSnapshot.filePath}
          />
        </Suspense>
      )}
    </div>
  );
};

export default AppView;
