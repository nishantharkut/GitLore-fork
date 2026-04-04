import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const t = timeoutsRef.current.get(id);
    if (t != null) {
      clearTimeout(t);
      timeoutsRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    return () => {
      for (const tid of timeoutsRef.current.values()) {
        clearTimeout(tid);
      }
      timeoutsRef.current.clear();
    };
  }, []);

  const toast = useCallback(
    (t: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const duration = t.duration ?? 4000;
      setItems((prev) => {
        const next = [...prev, { ...t, id }];
        while (next.length > 3) {
          const removed = next.shift();
          if (removed) clearTimer(removed.id);
        }
        return next;
      });
      const tid = window.setTimeout(() => {
        timeoutsRef.current.delete(id);
        setItems((prev) => prev.filter((x) => x.id !== id));
      }, duration);
      timeoutsRef.current.set(id, tid);
    },
    [clearTimer]
  );

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setItems((p) => p.filter((x) => x.id !== id));
    },
    [clearTimer]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
