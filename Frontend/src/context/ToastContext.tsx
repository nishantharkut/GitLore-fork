import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ToastViewport, type ToastViewportItem } from "@/components/shared/Toast";

export type ToastType = "success" | "error" | "info";

export type ToastInput = { message: string; type: ToastType; duration?: number };

type ToastItem = ToastViewportItem;

const ToastContext = createContext<{ toast: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((t: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const duration = t.duration ?? 4000;
    setItems((prev) => {
      const next = [...prev, { ...t, id }];
      while (next.length > 3) next.shift();
      return next;
    });
    window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastViewport items={items} onDismiss={(id) => setItems((p) => p.filter((x) => x.id !== id))} />
    </ToastContext.Provider>
  );
}
