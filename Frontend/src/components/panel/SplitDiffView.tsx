import { useEffect, useRef } from "react";
import { animate as animeAnimate } from "animejs";

type Props = {
  buggyCode: string;
  fixedCode: string;
};

/** Split diff: theme semantic removed/added surfaces (matches --error-dim / --success-dim). */
export function SplitDiffView({ buggyCode, fixedCode }: Props) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const leftLines = leftRef.current?.querySelectorAll(".diff-line") ?? [];
    const rightLines = rightRef.current?.querySelectorAll(".diff-line") ?? [];
    const all = [...leftLines, ...rightLines];
    if (!all.length) return;
    const anims = all.map((el, i) =>
      animeAnimate(el as HTMLElement, {
        opacity: [0, 1],
        translateX: [-10, 0],
        duration: 300,
        delay: i * 50,
        ease: "outQuart",
      })
    );
    return () => {
      for (const a of anims) a.revert?.();
    };
  }, [buggyCode, fixedCode]);

  const leftLines = buggyCode.split("\n");
  const rightLines = fixedCode.split("\n");

  return (
    <div className="rounded-sm border border-gitlore-border bg-[var(--elevated)] p-3.5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-3">
        <div ref={leftRef} className="min-w-0">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span style={{ fontSize: 8, color: "var(--error)" }} aria-hidden>
              ▶
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gitlore-text-secondary">
              Buggy code
            </span>
          </div>
          <pre className="diff-line-container overflow-x-auto whitespace-pre rounded-sm border border-gitlore-border bg-[var(--error-dim)] p-3 font-code text-[11px] leading-5 text-gitlore-text md:text-xs">
            {leftLines.map((line, i) => (
              <div key={`l-${i}`} className="diff-line">
                {line}
              </div>
            ))}
          </pre>
        </div>
        <div ref={rightRef} className="min-w-0">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span style={{ fontSize: 8, color: "var(--success)" }} aria-hidden>
              ▶
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gitlore-text-secondary">
              Suggested fix
            </span>
          </div>
          <pre className="diff-line-container overflow-x-auto whitespace-pre rounded-sm border border-gitlore-border bg-[var(--success-dim)] p-3 font-code text-[11px] leading-5 text-gitlore-text md:text-xs">
            {rightLines.map((line, i) => (
              <div key={`r-${i}`} className="diff-line">
                {line}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}
