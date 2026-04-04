import type {
  AutoFixClassifiedRow,
  AutoFixClassifyResponse,
  PullDiffReviewFile,
} from "@/lib/gitloreApi";
import { AutoFixSummary } from "./AutoFixSummary";

export type PrReviewOverviewComment = {
  id: number;
  path: string;
  line: number | null;
  text: string;
  author: string;
};

type PrMeta = {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  authorLogin: string | null;
};

type Props = {
  meta: PrMeta | null;
  changedFiles: PullDiffReviewFile[];
  comments: PrReviewOverviewComment[];
  loading: boolean;
  error: string | null;
  onCommentClick: (c: PrReviewOverviewComment) => void;
  autoFix?: AutoFixClassifyResponse | null;
  autoFixScanning?: boolean;
  autoFixApplying?: boolean;
  autoFixApproved?: Record<number, boolean>;
  onAutoFixScan?: () => void;
  onAutoFixApplyAuto?: () => void;
  onAutoFixCreateDraft?: () => void;
  onAutoFixToggleApprove?: (commentId: number) => void;
};

function autoFixRowById(rows: AutoFixClassifiedRow[] | undefined): Map<number, AutoFixClassifiedRow> {
  const m = new Map<number, AutoFixClassifiedRow>();
  if (!rows) return m;
  for (const r of rows) m.set(r.comment_id, r);
  return m;
}

function classificationBadge(row: AutoFixClassifiedRow | undefined) {
  if (!row || row.classification === "COMPLEX") return null;
  const base =
    row.classification === "AUTO_FIXABLE"
      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
      : row.classification === "SUGGEST_FIX"
        ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
        : "border-gitlore-border bg-gitlore-code/60 text-gitlore-text-secondary";
  const label =
    row.classification === "AUTO_FIXABLE"
      ? "Auto-fix"
      : row.classification === "SUGGEST_FIX"
        ? "Suggest fix"
        : "Manual";
  const tier =
    row.fix != null ? ` · T${row.fix.tier}: ${row.fix.tier_label}` : "";
  return (
    <span className={`mt-1 inline-flex flex-wrap items-center gap-1 rounded border px-1.5 py-0.5 font-code text-[9px] uppercase tracking-wide ${base}`}>
      {label}
      {tier}
    </span>
  );
}

function groupCommentsByPath(comments: PrReviewOverviewComment[]): Map<string, PrReviewOverviewComment[]> {
  const m = new Map<string, PrReviewOverviewComment[]>();
  for (const c of comments) {
    const p = c.path || "(unknown)";
    const list = m.get(p) ?? [];
    list.push(c);
    m.set(p, list);
  }
  const sorted = new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  return sorted;
}

export function PrReviewOverview({
  meta,
  changedFiles,
  comments,
  loading,
  error,
  onCommentClick,
  autoFix = null,
  autoFixScanning = false,
  autoFixApplying = false,
  autoFixApproved = {},
  onAutoFixScan,
  onAutoFixApplyAuto,
  onAutoFixCreateDraft,
  onAutoFixToggleApprove,
}: Props) {
  if (error) {
    return (
      <div className="p-5">
        <p className="text-sm text-gitlore-error">{error}</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-center text-sm text-gitlore-text-secondary">Loading pull request…</p>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-center text-sm text-gitlore-text-secondary">Select a pull request to see details and comments.</p>
      </div>
    );
  }

  const grouped = groupCommentsByPath(comments);
  const fixMap = autoFixRowById(autoFix?.classified);
  const approvedCount = Object.values(autoFixApproved).filter(Boolean).length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-gitlore-border p-3 md:px-4 md:pt-4">
        <div className="rounded-sm border border-gitlore-border bg-[var(--elevated)] px-3.5 py-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-code text-sm font-semibold text-gitlore-accent">#{meta.number}</span>
            <span className="min-w-0 flex-1 font-body text-sm font-medium leading-snug text-gitlore-text">{meta.title}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-code text-[11px] text-gitlore-text-secondary md:text-xs">
            <span className="capitalize">{meta.state}</span>
            {meta.authorLogin && <span>@{meta.authorLogin}</span>}
            <span>
              {changedFiles.length} file{changedFiles.length === 1 ? "" : "s"} · {comments.length} comment
              {comments.length === 1 ? "" : "s"}
            </span>
          </div>
          <a
            href={meta.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-code text-xs text-gitlore-accent hover:underline"
          >
            Open on GitHub
          </a>
        </div>
        {onAutoFixScan && meta && (
          <div className="mt-3">
            {autoFix ? (
              <AutoFixSummary
                data={autoFix}
                scanning={autoFixScanning}
                applying={autoFixApplying}
                approvedCount={approvedCount}
                onScan={onAutoFixScan}
                onApplyAutoOnly={onAutoFixApplyAuto ?? (() => {})}
                onCreateDraftPr={onAutoFixCreateDraft ?? (() => {})}
              />
            ) : (
              <div className="rounded-sm border border-gitlore-border bg-[var(--elevated)] px-3 py-2">
                <button
                  type="button"
                  disabled={autoFixScanning}
                  onClick={onAutoFixScan}
                  className="w-full rounded-sm border border-gitlore-accent/40 bg-gitlore-accent/10 py-2 text-xs font-medium text-gitlore-accent transition-colors hover:bg-gitlore-accent/20 disabled:opacity-50"
                >
                  {autoFixScanning
                    ? `Scanning ${comments.length} comment${comments.length === 1 ? "" : "s"}…`
                    : "Scan for Auto-Fixes"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4">
        <div className="mb-3 font-code text-[10px] font-bold uppercase tracking-wider text-gitlore-text-secondary">
          Review comments
        </div>
        {comments.length === 0 ? (
          <div className="rounded-sm border border-gitlore-border bg-[var(--elevated)] px-3.5 py-3">
            <p className="text-sm text-gitlore-text-secondary">No inline review comments on this pull request.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {[...grouped.entries()].map(([path, rows]) => (
              <li
                key={path}
                className="rounded-sm border border-gitlore-border bg-[var(--elevated)] p-3"
              >
                <div className="mb-2 truncate border-b border-gitlore-border pb-2 font-code text-[11px] text-gitlore-accent" title={path}>
                  {path}
                </div>
                <ul className="space-y-1.5">
                  {rows.map((c) => {
                    const row = fixMap.get(c.id);
                    const canApprove =
                      row?.fix &&
                      (row.classification === "AUTO_FIXABLE" || row.classification === "SUGGEST_FIX");
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => onCommentClick(c)}
                          className="w-full rounded-sm border border-gitlore-border bg-gitlore-surface px-2.5 py-2 text-left transition-colors hover:border-[var(--border-accent)] hover:bg-gitlore-surface-hover"
                        >
                          <div className="flex items-center justify-between gap-2 font-code text-[10px] text-gitlore-text-secondary">
                            <span>@{c.author}</span>
                            {c.line != null && <span>L{c.line}</span>}
                          </div>
                          {classificationBadge(row)}
                          <p className="mt-1 line-clamp-3 font-body text-xs leading-relaxed text-gitlore-text">{c.text}</p>
                          {canApprove && onAutoFixToggleApprove && (
                            <label
                              className="mt-2 flex cursor-pointer items-center gap-2 border-t border-gitlore-border pt-2 font-body text-[11px] text-gitlore-text-secondary"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={!!autoFixApproved[c.id]}
                                onChange={() => onAutoFixToggleApprove(c.id)}
                                className="rounded border-gitlore-border"
                              />
                              Approve for draft PR
                            </label>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
