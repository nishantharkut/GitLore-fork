import type { PullDiffReviewFile } from "@/lib/gitloreApi";

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
};

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

export function PrReviewOverview({ meta, changedFiles, comments, loading, error, onCommentClick }: Props) {
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
                  {rows.map((c) => (
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
                        <p className="mt-1 line-clamp-3 font-body text-xs leading-relaxed text-gitlore-text">{c.text}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
