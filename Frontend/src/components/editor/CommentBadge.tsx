import { useEffect, useRef } from "react";
import { animate as animeAnimate } from "animejs";

export type CommentBadgeData = {
  id: string;
  line: number;
  body: string;
  author: string;
  url: string;
  diff_hunk: string;
};

function categoryStyle(text: string): string {
  const t = text.toLowerCase();
  if (/xss|injection|sql|csrf/.test(t)) {
    return "border border-gitlore-border/80 border-l-[3px] border-l-gitlore-error bg-[var(--error-dim)] text-gitlore-text";
  }
  if (/n\+1|n plus one|cache|performance|slow/.test(t)) {
    return "border border-gitlore-border/80 border-l-[3px] border-l-gitlore-warning bg-[var(--warning-dim)] text-gitlore-text";
  }
  if (/leak|cleanup|memory|unmount|effect/.test(t)) {
    return "border border-gitlore-border/80 border-l-[3px] border-l-gitlore-warning bg-[var(--warning-dim)] text-gitlore-text";
  }
  if (/god object|architecture|layer|coupling/.test(t)) {
    return "border border-gitlore-border/80 border-l-[3px] border-l-[var(--code-accent)] bg-[var(--code-accent-dim)] text-gitlore-text";
  }
  return "border border-gitlore-border/80 border-l-[3px] border-l-gitlore-accent/40 bg-gitlore-surface-hover text-gitlore-text";
}

function truncate(s: string, n: number): string {
  const x = s.replace(/\s+/g, " ").trim();
  return x.length <= n ? x : `${x.slice(0, n - 1)}…`;
}

type Props = {
  comment: CommentBadgeData;
  onClick: (c: CommentBadgeData) => void;
};

export function CommentBadge({ comment, onClick }: Props) {
  const terse = comment.body.trim().length > 0 && comment.body.trim().length < 15;
  const badgeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = badgeRef.current;
    if (!el || !terse) return;
    el.classList.add("comment-badge-terse");
    const anim = animeAnimate(el, {
      scale: [1, 1.05],
      opacity: [0.8, 1],
      duration: 1200,
      loop: true,
      direction: "alternate",
      ease: "inOutSine",
    });
    return () => {
      anim.revert();
      el.classList.remove("comment-badge-terse");
    };
  }, [terse, comment.id]);

  const cat = categoryStyle(comment.body);

  return (
    <button
      ref={badgeRef}
      type="button"
      onClick={() => onClick(comment)}
      className={`comment-badge group my-1 flex max-w-full items-center gap-2 rounded-sm py-1.5 pl-2 pr-3 text-left text-[11px] shadow-sm transition-colors md:text-xs ${cat}`}
    >
      <img
        src={`https://github.com/${comment.author}.png?size=32`}
        alt=""
        className="h-4 w-4 shrink-0 rounded-full border border-gitlore-border/50 bg-gitlore-code"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{truncate(comment.body, 40)}</span>
      <span className="shrink-0 text-gitlore-text-secondary opacity-0 transition-opacity group-hover:opacity-100">
        → Explain
      </span>
    </button>
  );
}

/** Run line glow after badge click (targets gutter line wrapper via data attribute). */
export function glowLineForComment(line: number): void {
  const sel = `[data-gitlore-line="${line}"]`;
  const el = document.querySelector(sel);
  if (!el) return;
  animeAnimate(el as HTMLElement, {
    backgroundColor: [
      "transparent",
      "rgba(201,168,76,0.12)",
      "transparent",
    ],
    duration: 800,
    ease: "outQuart",
  });
}
