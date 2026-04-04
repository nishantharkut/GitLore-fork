import { useEffect, useId, useRef, useState } from "react";
import type { ThemeMode } from "@/context/ThemeContext";

type Props = {
  chart: string;
  theme: ThemeMode;
};

/**
 * Renders a Mermaid diagram from assistant markdown (```mermaid ... ```).
 * Loaded dynamically so the main bundle stays smaller until a diagram appears.
 */
export function ChatMermaidBlock({ chart, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId().replace(/:/g, "");
  const seq = useRef(0);
  const [fallback, setFallback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === "dark" ? "dark" : "default",
          securityLevel: "strict",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        });
        const renderId = `${baseId}-${++seq.current}`;
        const { svg } = await mermaid.render(renderId, chart.trim());
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        setFallback(null);
      } catch (e) {
        if (!cancelled) setFallback(e instanceof Error ? e.message : "Diagram error");
      }
    })();
    return () => {
      cancelled = true;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [chart, theme]);

  if (fallback) {
    return (
      <div className="mb-2 rounded-sm border border-amber-500/40 bg-amber-500/10 p-2 text-[12px] text-gitlore-text-secondary">
        <p className="mb-1 font-medium text-gitlore-text">Could not render diagram ({fallback})</p>
        <pre className="max-h-40 overflow-auto font-code text-[11px] text-gitlore-text">{chart}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-2 flex justify-center overflow-x-auto rounded-sm border border-gitlore-border bg-gitlore-code/40 p-3 [&_svg]:max-h-[min(420px,50vh)] [&_svg]:max-w-none"
      role="img"
      aria-label="Diagram"
    />
  );
}
