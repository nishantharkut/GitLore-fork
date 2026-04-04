import { useEffect, useRef } from "react";
import { animate as animeAnimate } from "animejs";
import { GitBranch, MessageSquare } from "lucide-react";

export type ActiveFeature = "archaeology" | "review";

type Props = {
  activeFeature: ActiveFeature;
  onToggle: (feature: ActiveFeature) => void;
};

export function FeatureToggle({ activeFeature, onToggle }: Props) {
  const isReview = activeFeature === "review";
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const skipFirst = useRef(true);

  useEffect(() => {
    const el = indicatorRef.current;
    const parent = wrapRef.current;
    if (!el || !parent) return;
    const w = parent.offsetWidth;
    const slide = w / 2;
    if (skipFirst.current) {
      el.style.transform = `translateX(${isReview ? slide : 0}px)`;
      skipFirst.current = false;
      return;
    }
    animeAnimate(el, {
      translateX: isReview ? slide : 0,
      duration: 250,
      ease: "inOutQuart",
    });
  }, [isReview]);

  return (
    <div
      ref={wrapRef}
      className="feature-toggle relative inline-flex overflow-hidden rounded-sm border border-gitlore-border/80 bg-gitlore-code/50"
      role="group"
      aria-label="Feature mode"
    >
      {/* Flush rectangle: only the track’s overflow-hidden + rounded-sm rounds the outer corners; inner seam stays square */}
      <span
        ref={indicatorRef}
        className="feature-toggle-indicator pointer-events-none absolute left-0 top-0.5 bottom-0.5 w-1/2 rounded-none"
        style={{
          backgroundColor: isReview ? "var(--code-accent)" : "var(--accent)",
        }}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => onToggle("archaeology")}
        className={`relative z-10 flex min-w-[7.5rem] flex-1 items-center justify-center gap-1 px-2.5 py-1 text-[11px] font-semibold transition-colors md:min-w-[8.5rem] md:px-3 md:text-xs ${
          !isReview ? "text-white" : "text-gitlore-text-secondary hover:text-gitlore-text"
        }`}
      >
        <GitBranch className="h-3 w-3 shrink-0 md:h-3.5 md:w-3.5" aria-hidden />
        Live Repo
      </button>
      <button
        type="button"
        onClick={() => onToggle("review")}
        className={`relative z-10 flex min-w-[7.5rem] flex-1 items-center justify-center gap-1 px-2.5 py-1 text-[11px] font-semibold transition-colors md:min-w-[8.5rem] md:px-3 md:text-xs ${
          isReview ? "text-white" : "text-gitlore-text-secondary hover:text-gitlore-text"
        }`}
      >
        <MessageSquare className="h-3 w-3 shrink-0 md:h-3.5 md:w-3.5" aria-hidden />
        Review Comments
      </button>
    </div>
  );
}
