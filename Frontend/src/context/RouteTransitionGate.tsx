import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigation } from "react-router-dom";

const RouteTransitionVisibleContext = createContext(false);

export function useRouteTransitionVisible() {
  return useContext(RouteTransitionVisibleContext);
}

/** Gate visible OR router still loading — keeps chrome in sync (no one-frame gap). */
export function useShowRouteTransitionChrome() {
  const navigation = useNavigation();
  const gateVisible = useRouteTransitionVisible();
  return gateVisible || navigation.state === "loading";
}

/**
 * Keeps route chrome (overlay + top bar) visible until the *destination* route has
 * committed and the browser has painted — not only until the router loader Promise resolves.
 */
/** Minimum time the transition chrome stays visible so fast navigations don’t flash subliminally. */
const MIN_OVERLAY_MS = 240;

export function RouteTransitionGateProvider({ children }: { children: ReactNode }) {
  const navigation = useNavigation();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const hideControllerRef = useRef<AbortController | null>(null);
  const overlayShownAtRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (navigation.state !== "loading") {
      return;
    }
    hideControllerRef.current?.abort();
    hideControllerRef.current = null;
    overlayShownAtRef.current = performance.now();
    setVisible(true);
  }, [navigation.state]);

  useLayoutEffect(() => {
    if (navigation.state !== "idle" || !visible) {
      return;
    }

    hideControllerRef.current?.abort();
    const ac = new AbortController();
    hideControllerRef.current = ac;
    const { signal } = ac;

    const run = async () => {
      try {
        await waitThreeFrames(signal);
        await waitForIdle(signal, 600);
        if (signal.aborted) return;
        const shownAt = overlayShownAtRef.current ?? 0;
        const elapsed = performance.now() - shownAt;
        if (elapsed < MIN_OVERLAY_MS) {
          await new Promise<void>((r) => setTimeout(r, MIN_OVERLAY_MS - elapsed));
        }
        if (signal.aborted) return;
        setVisible(false);
      } catch {
        /* aborted */
      }
    };

    void run();

    return () => {
      ac.abort();
    };
  }, [navigation.state, location.pathname, location.search, location.hash, location.key, visible]);

  return (
    <RouteTransitionVisibleContext.Provider value={visible}>{children}</RouteTransitionVisibleContext.Provider>
  );
}

function waitThreeFrames(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("aborted"));
    if (signal.aborted) return fail();
    signal.addEventListener("abort", fail, { once: true });
    let n = 0;
    const step = () => {
      if (signal.aborted) return;
      n++;
      if (n < 3) {
        requestAnimationFrame(step);
      } else {
        signal.removeEventListener("abort", fail);
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

function waitForIdle(signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const fail = () => reject(new Error("aborted"));
    signal.addEventListener("abort", fail, { once: true });

    const done = () => {
      signal.removeEventListener("abort", fail);
      resolve();
    };

    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(done, { timeout: timeoutMs });
      signal.addEventListener("abort", () => cancelIdleCallback(id), { once: true });
    } else {
      const t = window.setTimeout(done, Math.min(timeoutMs, 120));
      signal.addEventListener("abort", () => clearTimeout(t), { once: true });
    }
  });
}
