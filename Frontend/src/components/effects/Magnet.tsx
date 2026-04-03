import { useRef, useCallback, type ReactNode, type MouseEvent } from "react";

interface MagnetProps {
  children: ReactNode;
  className?: string;
  strength?: number;
}

export function Magnet({ children, className = "", strength = 0.3 }: MagnetProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = useCallback(
    (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      el.style.transform = `translate(${(e.clientX - cx) * strength}px, ${(e.clientY - cy) * strength}px)`;
    },
    [strength],
  );

  const handleLeave = useCallback(() => {
    if (ref.current) ref.current.style.transform = "translate(0, 0)";
  }, []);

  return (
    <div ref={ref} className={`magnet-wrap ${className}`} onMouseMove={handleMove} onMouseLeave={handleLeave}>
      {children}
    </div>
  );
}
