import { Wand2 } from "lucide-react";
import type { AutoFixClassifyResponse } from "@/lib/gitloreApi";

type Props = {
  data: AutoFixClassifyResponse;
  scanning: boolean;
  applying: boolean;
  approvedCount: number;
  onScan: () => void;
  onApplyAutoOnly: () => void;
  onCreateDraftPr: () => void;
};

export function AutoFixSummary({
  data,
  scanning,
  applying,
  approvedCount,
  onScan,
  onApplyAutoOnly,
  onCreateDraftPr,
}: Props) {
  const { summary } = data;
  return (
    <div className="mb-3 rounded-sm border border-gitlore-border bg-[var(--elevated)] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gitlore-text-secondary">Auto-fix scan</p>
        <button
          type="button"
          disabled={scanning}
          onClick={onScan}
          className="inline-flex items-center gap-1.5 rounded-sm border border-gitlore-accent/50 bg-gitlore-accent/10 px-2.5 py-1 font-code text-[11px] font-medium text-gitlore-accent transition-colors hover:bg-gitlore-accent/20 disabled:opacity-50"
        >
          <Wand2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {scanning ? "Scanning…" : "Scan for Auto-Fixes"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-body text-xs text-gitlore-text-secondary">
        <span>
          <span className="text-emerald-400">●</span> {summary.auto_fixable} auto-fixable
        </span>
        <span>
          <span className="text-amber-400">●</span> {summary.suggest_fix} suggestions
        </span>
        <span>
          <span className="text-gitlore-text-secondary">○</span> {summary.manual_review} manual
        </span>
        <span>
          <span className="opacity-50">○</span> {summary.complex} complex
        </span>
      </div>
      {summary.auto_fixable > 0 && (
        <button
          type="button"
          disabled={applying || scanning}
          onClick={onApplyAutoOnly}
          className="mt-2 w-full rounded-sm border border-emerald-500/40 bg-emerald-500/10 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
        >
          Apply {summary.auto_fixable} auto-fix{summary.auto_fixable === 1 ? "" : "es"} (draft PR)
        </button>
      )}
      {approvedCount > 0 && (
        <div className="mt-2 flex flex-col gap-2 border-t border-gitlore-border pt-2">
          <p className="text-center text-xs text-gitlore-text-secondary">{approvedCount} fix(es) approved for draft PR</p>
          <button
            type="button"
            disabled={applying || scanning}
            onClick={onCreateDraftPr}
            className="w-full rounded-sm bg-gitlore-accent py-2 text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover disabled:opacity-50"
          >
            {applying ? "Creating draft PR…" : "Create Draft PR"}
          </button>
        </div>
      )}
    </div>
  );
}
