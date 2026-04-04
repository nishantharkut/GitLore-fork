import { useState } from "react";
import type { AutoFixClassifiedRow, InsightExplanation } from "@/lib/gitloreApi";
import { postNarrate } from "@/lib/gitloreApi";
import { SplitDiffView } from "./SplitDiffView";

function extractAddedFromDiff(diffHunk: string | null | undefined): string {
  if (!diffHunk?.trim()) return "";
  return diffHunk
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}

function explanationConfidenceStyle(level: "HIGH" | "MEDIUM" | "LOW"): {
  color: string;
  background: string;
  border: string;
  bar: string;
} {
  if (level === "HIGH") {
    return {
      color: "var(--success)",
      background: "var(--success-dim)",
      border: "color-mix(in srgb, var(--success) 30%, transparent)",
      bar: "linear-gradient(90deg, var(--success), color-mix(in srgb, var(--success) 70%, black))",
    };
  }
  if (level === "MEDIUM") {
    return {
      color: "var(--accent)",
      background: "var(--accent-dim)",
      border: "color-mix(in srgb, var(--accent) 35%, transparent)",
      bar: "linear-gradient(90deg, var(--accent), var(--accent-hover))",
    };
  }
  return {
    color: "var(--text-secondary)",
    background: "color-mix(in srgb, var(--text-secondary) 12%, transparent)",
    border: "var(--border-strong)",
    bar: "linear-gradient(90deg, var(--text-secondary), var(--text-ghost))",
  };
}

const PREVIEW_DIFF_CAP = 14_000;

function capDiffPreview(s: string): string {
  if (s.length <= PREVIEW_DIFF_CAP) return s;
  return `${s.slice(0, PREVIEW_DIFF_CAP)}\n\n/* …truncated for preview (${s.length} chars) */`;
}

type Props = {
  data: InsightExplanation | null;
  loading: boolean;
  error: string | null;
  diffHunk?: string | null;
  prNumber?: number | null;
  onRetry?: () => void;
  /** When a scan was run, show tiered proposed fix for this comment. */
  autoFixRow?: AutoFixClassifiedRow | null;
  autoFixApproved?: boolean;
  onToggleAutoFixApprove?: () => void;
};

export function ExplanationView({
  data,
  loading,
  error,
  diffHunk,
  prNumber,
  onRetry,
  autoFixRow = null,
  autoFixApproved = false,
  onToggleAutoFixApprove,
}: Props) {
  const [narrateBusy, setNarrateBusy] = useState(false);

  if (loading) {
    return (
      <div className="panel-content space-y-4 p-4 font-body md:p-5">
        <div className="h-4 w-2/3 animate-pulse rounded-sm bg-gitlore-border/60" />
        <div className="h-3 w-full animate-pulse rounded-sm bg-gitlore-border/40" />
        <div className="h-3 w-5/6 animate-pulse rounded-sm bg-gitlore-border/40" />
        <div className="h-3 w-4/5 animate-pulse rounded-sm bg-gitlore-border/40" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-content space-y-4 p-4 font-body md:p-5">
        <p className="text-sm text-gitlore-error">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-sm bg-gitlore-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gitlore-accent-hover"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!data) return null;

  const conf = data.confidence;
  const confUi = explanationConfidenceStyle(conf);

  const buggy =
    extractAddedFromDiff(diffHunk ?? undefined) || data.whatsWrong || data.buggyCode;
  const fixedSide = data.fixedCode || "(no fix suggested)";

  const handleNarrate = async () => {
    const script = [
      data.patternName || data.header,
      data.whatsWrong,
      data.why,
      data.principle,
    ]
      .filter(Boolean)
      .join(". ");
    if (!script.trim()) return;
    setNarrateBusy(true);
    try {
      await postNarrate(script.slice(0, 8000));
    } finally {
      setNarrateBusy(false);
    }
  };

  return (
    <div className="panel-content flex flex-col font-body" style={{ maxHeight: "100%", overflowY: "auto" }}>
      <div className="shrink-0" style={{ height: 3, background: confUi.bar }} aria-hidden />

      <div className="flex flex-col gap-4 p-4 md:gap-5 md:p-5">
        {/* Match narrative “Sources” strip: neutral bordered elevated card */}
        <div className="rounded-sm border border-gitlore-border bg-[var(--elevated)] px-3.5 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gitlore-text-secondary">Review finding</p>
              <h3
                className="mt-1 text-[15px] font-semibold leading-snug"
                style={{ color: "var(--code-accent)" }}
              >
                {data.patternName || data.header}
              </h3>
              {data.confidenceReason && (
                <p className="mt-1.5 text-xs text-gitlore-text-secondary">{data.confidenceReason}</p>
              )}
            </div>
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] font-bold tracking-wide"
              style={{
                color: confUi.color,
                background: confUi.background,
                border: `1px solid ${confUi.border}`,
              }}
              title={data.confidenceReason || `Confidence: ${conf}`}
            >
              {conf}
            </span>
          </div>
        </div>

        <SplitDiffView buggyCode={buggy} fixedCode={fixedSide} />

        {autoFixRow?.fix && (
          <section className="rounded-sm border border-gitlore-border bg-[var(--elevated)] px-3.5 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gitlore-text-secondary">
                Proposed fix (ReviewLens)
              </p>
              <span className="rounded-sm border border-gitlore-accent/40 bg-gitlore-accent/10 px-2 py-0.5 font-code text-[10px] text-gitlore-accent">
                Tier {autoFixRow.fix.tier} · {autoFixRow.fix.tier_label}
              </span>
            </div>
            <p className="mb-2 text-xs text-gitlore-text-secondary">{autoFixRow.fix.description}</p>
            {autoFixRow.fix.validation.warnings.length > 0 && (
              <ul className="mb-2 list-inside list-disc text-[11px] text-amber-200/90">
                {autoFixRow.fix.validation.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {!autoFixRow.fix.validation.passed && (
              <p className="mb-2 text-[11px] text-gitlore-error">Validation did not pass; review carefully before approving.</p>
            )}
            <SplitDiffView
              buggyCode={capDiffPreview(autoFixRow.fix.original_code)}
              fixedCode={capDiffPreview(autoFixRow.fix.fixed_code)}
            />
            {(autoFixRow.classification === "AUTO_FIXABLE" || autoFixRow.classification === "SUGGEST_FIX") &&
              onToggleAutoFixApprove && (
                <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-gitlore-border pt-3 font-body text-xs text-gitlore-text-secondary">
                  <input
                    type="checkbox"
                    checked={autoFixApproved}
                    onChange={() => onToggleAutoFixApprove()}
                    className="rounded border-gitlore-border"
                  />
                  Approve for draft PR (with other approved comments)
                </label>
              )}
          </section>
        )}

        {/* Same card recipe as narrative “Impact” (error tint) */}
        <section
          className="rounded-sm px-3.5 py-2.5"
          style={{
            background: "linear-gradient(135deg, var(--error-dim), color-mix(in srgb, var(--elevated) 92%, var(--error) 8%))",
            border: "1px solid color-mix(in srgb, var(--error) 22%, transparent)",
          }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span style={{ fontSize: 8, color: "var(--error)" }} aria-hidden>
              ▶
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--error)" }}>
              What&apos;s wrong
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-gitlore-text/90">{data.whatsWrong}</p>
        </section>

        {/* Same as narrative “Decision” card (gold accent rgba) */}
        <section
          className="rounded-sm px-3.5 py-2.5"
          style={{
            background: "linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.02))",
            border: "1px solid rgba(201,168,76,0.2)",
          }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span style={{ fontSize: 8, color: "#C9A84C" }} aria-hidden>
              ▶
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#C9A84C" }}>
              Why it matters
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-gitlore-text/90">{data.whyItMatters ?? data.why}</p>
        </section>

        {/* Same layout as Decision/Impact, code-accent tint */}
        <section
          className="rounded-sm px-3.5 py-2.5"
          style={{
            background: "linear-gradient(135deg, var(--code-accent-dim), color-mix(in srgb, var(--elevated) 94%, var(--code-accent) 6%))",
            border: "1px solid color-mix(in srgb, var(--code-accent) 24%, transparent)",
          }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span style={{ fontSize: 8, color: "var(--code-accent)" }} aria-hidden>
              ▶
            </span>
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "var(--code-accent)" }}
            >
              The principle
            </span>
          </div>
          <p className="text-[13px] font-medium leading-relaxed text-gitlore-text/90">{data.principle}</p>
          {data.docsLinks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 border-t border-gitlore-border pt-2">
              {data.docsLinks.map((u) => (
                <a
                  key={u}
                  href={u.startsWith("http") ? u : `https://${u}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-medium text-gitlore-accent underline-offset-2 transition-colors hover:text-gitlore-accent-hover hover:underline"
                >
                  Documentation link →
                </a>
              ))}
            </div>
          )}
        </section>

        {data.source && (
          <div className="rounded-sm border border-gitlore-border bg-[var(--elevated)] px-3.5 py-2.5">
            <a
              href={data.source.commentUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] text-gitlore-text-secondary transition-colors hover:text-gitlore-accent"
            >
              Based on: PR #{prNumber ?? "?"} review by @{data.source.commentBy}
            </a>
          </div>
        )}

        {/* Pixel-aligned with narrative “Listen to this story” */}
        <button
          type="button"
          disabled={narrateBusy}
          onClick={() => void handleNarrate()}
          className="group inline-flex w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
          style={{
            background: "linear-gradient(135deg, rgba(201,168,76,0.1), rgba(201,168,76,0.05))",
            border: "1px solid rgba(201,168,76,0.3)",
            color: "#C9A84C",
          }}
          onMouseEnter={(e) => {
            if (narrateBusy) return;
            e.currentTarget.style.background =
              "linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.1))";
            e.currentTarget.style.borderColor = "rgba(201,168,76,0.5)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              "linear-gradient(135deg, rgba(201,168,76,0.1), rgba(201,168,76,0.05))";
            e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)";
          }}
        >
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M12 6.253v11.494M18.364 5.636a9 9 0 010 12.728M8.464 15.536a5 5 0 010-7.072M5.636 18.364a9 9 0 010-12.728" />
          </svg>
          Hear the explanation
        </button>
      </div>
    </div>
  );
}
