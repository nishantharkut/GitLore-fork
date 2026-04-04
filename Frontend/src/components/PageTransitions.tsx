import { useShowRouteTransitionChrome } from "@/context/RouteTransitionGate";

/**
 * Full-viewport dim + cross loader (see `.gitlore-vw-loader` in index.css).
 */
export function RouteTransitionCenterLoader() {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--bg)]/95 backdrop-blur-md"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading page"
    >
      <div className="flex flex-col items-center gap-5 rounded-lg border border-gitlore-border/60 bg-gitlore-surface/90 px-10 py-9 shadow-2xl shadow-black/40">
        <div className="gitlore-vw-loader scale-125 md:scale-[1.35]" aria-hidden />
        <p className="text-sm font-medium tracking-wide text-gitlore-accent">Loading…</p>
      </div>
    </div>
  );
}

/** Center loader while route transition chrome is active. */
export function NavigationLoadingOverlay() {
  const show = useShowRouteTransitionChrome();
  if (!show) {
    return null;
  }
  return <RouteTransitionCenterLoader />;
}

/** Suspense while a lazy chunk still resolves (same visual as route transition). */
export function RoutePendingFallback() {
  return <RouteTransitionCenterLoader />;
}

/** Top progress bar — same visibility rule as overlay. */
export function NavigationProgress() {
  const show = useShowRouteTransitionChrome();

  return (
    <div
      className={`pointer-events-none fixed left-0 right-0 top-0 z-[300] overflow-hidden shadow-[0_3px_16px_rgba(201,168,76,0.45)] transition-opacity duration-200 ${
        show ? "h-1.5 opacity-100" : "h-0 opacity-0"
      }`}
      aria-hidden={!show}
    >
      <div className={`gitlore-nav-progress-bar h-full ${show ? "gitlore-nav-progress-bar--active" : ""}`} />
    </div>
  );
}
