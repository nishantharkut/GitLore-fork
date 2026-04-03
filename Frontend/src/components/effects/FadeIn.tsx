import { useRef, useEffect, type ReactNode } from "react";
import { observeOnce, type InViewOptions } from "./in-view";

export interface FadeInProps extends InViewOptions {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
}

export function FadeIn({
  children,
  className = "",
  delay = 0,
  direction = "up",
  threshold = 0.05,
  rootMargin = "0px",
}: FadeInProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fadeX = direction === "left" ? "-20px" : direction === "right" ? "20px" : "0px";
    const fadeY = direction === "up" ? "20px" : direction === "down" ? "-20px" : "0px";
    el.style.setProperty("--fade-delay", `${delay}ms`);
    el.style.setProperty("--fade-x", fadeX);
    el.style.setProperty("--fade-y", fadeY);
    return observeOnce(el, "fade-visible", { threshold, rootMargin });
  }, [delay, direction, threshold, rootMargin]);

  return (
    <div ref={ref} className={`fade-in ${className}`.trim()}>
      {children}
    </div>
  );
}
