import { useEffect, useRef } from "react";
import gsap from "gsap";
import { X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

export type ToastViewportItem = { id: string; message: string; type: ToastKind; duration?: number };

const border: Record<string, string> = {
  success: "border-l-green-500",
  error: "border-l-red-500",
  info: "border-l-amber-500",
};

function ToastRow({ item, onDismiss }: { item: ToastViewportItem; onDismiss: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    gsap.fromTo(el, { x: 48, opacity: 0 }, { x: 0, opacity: 1, duration: 0.28, ease: "power2.out" });
  }, []);

  const close = () => {
    const el = rootRef.current;
    if (!el) {
      onDismiss();
      return;
    }
    gsap.to(el, {
      opacity: 0,
      x: 24,
      duration: 0.2,
      ease: "power2.in",
      onComplete: onDismiss,
    });
  };

  return (
    <div
      ref={rootRef}
      role="status"
      className={`flex max-w-sm items-start gap-2 border border-gitlore-border border-l-4 ${border[item.type]} rounded-lg bg-gitlore-surface px-4 py-3 shadow-lg`}
    >
      <p className="min-w-0 flex-1 font-body text-sm text-gitlore-text">{item.message}</p>
      <button type="button" onClick={close} className="shrink-0 rounded p-0.5 text-gitlore-text-secondary hover:text-gitlore-text" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastViewport({ items, onDismiss }: { items: ToastViewportItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <ToastRow item={item} onDismiss={() => onDismiss(item.id)} />
        </div>
      ))}
    </div>
  );
}
