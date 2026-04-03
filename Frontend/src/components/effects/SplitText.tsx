import { useRef, useEffect, type ElementType } from "react";
import { observeOnce, type InViewOptions } from "./in-view";

export interface SplitTextProps extends InViewOptions {
  children: string;
  className?: string;
  delay?: number;
  as?: "h1" | "h2" | "h3" | "p" | "span";
}

export function SplitText({
  children,
  className = "",
  delay = 0,
  as: Tag = "span",
  threshold = 0.1,
  rootMargin = "0px",
}: SplitTextProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--split-delay", `${delay}ms`);
    el.querySelectorAll<HTMLElement>(".split-word").forEach((word, i) => {
      word.style.setProperty("--i", `${i}`);
    });
    return observeOnce(el, "split-visible", { threshold, rootMargin });
  }, [children, delay, threshold, rootMargin]);

  const words = children.split(" ");
  const Comp = Tag as ElementType;

  return (
    <Comp ref={ref} className={`split-text ${className}`.trim()}>
      {words.map((word, i) => (
        <span key={i} className="split-word">
          {word}
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </Comp>
  );
}
