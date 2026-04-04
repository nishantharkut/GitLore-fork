const BAR_WIDTHS = [100, 92, 88, 95, 78, 84, 91, 73, 86, 97, 82, 79, 93, 87, 81] as const;

export const Skeleton = ({ className = "", style }: { className?: string; style?: React.CSSProperties }) => (
  <div className={`animate-pulse rounded-sm bg-gitlore-border/40 ${className}`} style={style} />
);

/** Accessible spinner for inline and full-page async states */
export function Spinner({ className = "h-4 w-4", label }: { className?: string; label?: string }) {
  return (
    <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-gitlore-border border-t-gitlore-accent ${className}`} role="status" aria-label={label || "Loading"} />
  );
}

export function CenteredLoader({ message }: { message: string }) {
  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center gap-3 bg-gitlore-bg px-4">
      <Spinner className="h-8 w-8 border-[3px]" label={message} />
      <p className="max-w-sm text-center text-sm text-gitlore-text-secondary">{message}</p>
    </div>
  );
}

export function DiffLoadingBlock({ message = "Loading pull request diff…" }: { message?: string }) {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-gitlore-text-secondary" role="status" aria-live="polite">
      <Spinner className="h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}

export const PageSkeleton = () => (
  <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg p-4 md:p-8">
    <div className="mx-auto max-w-[1200px] space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  </div>
);

/** Matches /overview two-column layout + graph card */
export const OverviewSkeleton = () => (
  <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg">
    <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-12">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-5 md:gap-8">
        <div className="space-y-6 md:col-span-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-4 w-full" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-4 w-40" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
          <Skeleton className="h-3 w-full max-w-xs" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="md:col-span-3">
          <Skeleton className="mb-2 h-3 w-28" />
          <Skeleton className="mb-6 h-6 w-56" />
          <Skeleton className="h-[min(420px,55vh)] w-full rounded-sm border border-gitlore-border/50" />
        </div>
      </div>
    </div>
  </div>
);

/** Matches /patterns repo cards + catalog grid */
export const PatternsSkeleton = () => (
  <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg">
    <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-12">
      <Skeleton className="mb-2 h-8 w-64" />
      <Skeleton className="mb-6 h-4 w-full max-w-2xl" />
      <Skeleton className="mb-4 h-3 w-48" />
      <Skeleton className="mb-4 h-10 w-full max-w-md" />
      <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="mb-4 h-3 w-56" />
      <Skeleton className="mb-6 h-10 w-full max-w-md" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    </div>
  </div>
);

export const AppSkeleton = () => (
  <div className="flex h-[calc(100vh-56px)] bg-gitlore-bg">
    <div className="hidden w-[18%] border-r border-gitlore-border bg-gitlore-surface p-3 md:block">
      <Skeleton className="mb-3 h-4 w-20" />
      <Skeleton className="mb-4 h-9 w-full" />
      <Skeleton className="mb-2 h-4 w-16" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="mb-1.5 h-5 w-full" />
      ))}
    </div>
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex gap-2 border-b border-gitlore-border bg-gitlore-surface px-4 py-2">
        <Skeleton className="h-6 w-14" />
        <Skeleton className="h-6 w-14" />
      </div>
      <div className="flex-1 space-y-1 p-4">
        {BAR_WIDTHS.map((pct, i) => (
          <Skeleton key={i} className="h-5" style={{ width: `${pct}%` }} />
        ))}
      </div>
    </div>
  </div>
);

/** Shown while the CodeMirror chunk loads (inside editor panel) */
export function CodeEditorSkeleton({ mobile }: { mobile?: boolean }) {
  return (
    <div
      className="flex h-full min-h-[18rem] min-w-0 flex-1 flex-col bg-[#0A0A0D] md:min-h-0"
      role="status"
      aria-label="Loading code editor"
    >
      <div className={`flex flex-1 ${mobile ? "flex-col" : "flex-row"}`}>
        {!mobile && (
          <div className="flex w-[40px] shrink-0 flex-col gap-1 border-r border-gitlore-border/30 py-2 pr-1">
            {Array.from({ length: 14 }).map((_, i) => (
              <Skeleton key={i} className="mx-auto h-3 w-5 rounded-none bg-gitlore-border/25" />
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2 p-3">
          {BAR_WIDTHS.slice(0, mobile ? 10 : 12).map((pct, i) => (
            <Skeleton key={i} className="h-4 bg-gitlore-border/25" style={{ width: `${pct}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const LandingSkeleton = () => (
  <div className="min-h-screen bg-gitlore-bg">
    <div className="flex h-[52px] items-center justify-between border-b border-gitlore-border px-5">
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-8 w-28" />
    </div>
    <div className="mx-auto max-w-[1100px] px-6 pt-24">
      <Skeleton className="mx-auto h-3 w-40 md:mx-0" />
      <Skeleton className="mt-6 h-14 w-3/4 md:h-20" />
      <Skeleton className="mt-2 h-14 w-1/2 md:h-20" />
      <Skeleton className="mt-6 h-5 w-full max-w-[520px]" />
      <Skeleton className="mt-1 h-5 w-80" />
      <div className="mt-8 flex gap-3">
        <Skeleton className="h-11 w-44" />
        <Skeleton className="h-11 w-40" />
      </div>
    </div>
  </div>
);

/** Below-the-fold landing sections while lazy chunk loads */
export const LandingBelowFoldSkeleton = () => (
  <div className="bg-[var(--bg)]" aria-hidden>
    <div className="mx-auto max-w-[1100px] space-y-16 px-6 py-16">
      <div className="flex flex-wrap justify-center gap-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-32 bg-gitlore-border/30" />
        ))}
      </div>
      <Skeleton className="mx-auto h-48 w-full max-w-3xl" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  </div>
);

export default Skeleton;

/** Three placeholder cards for Patterns “This repository” section */
export function RepoPatternCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy aria-label="Loading repository patterns">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-sm" />
      ))}
    </div>
  );
}
