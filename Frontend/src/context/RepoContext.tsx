import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchMyRepos } from "@/lib/gitloreApi";

const STORAGE_KEY = "gitlore:target";

export type RepoTarget = {
  owner: string;
  name: string;
  filePath: string;
  branch: string;
};

/** No repository selected until storage or API default fills this in. */
const EMPTY_TARGET: RepoTarget = {
  owner: "",
  name: "",
  filePath: "README.md",
  branch: "",
};

const LEGACY_DEMO = { owner: "octocat", name: "Hello-World" };

function loadStored(): RepoTarget {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_TARGET };
    const p = JSON.parse(raw) as Partial<RepoTarget>;
    if (!p.owner || !p.name) return { ...EMPTY_TARGET };
    if (p.owner === LEGACY_DEMO.owner && p.name === LEGACY_DEMO.name) {
      return { ...EMPTY_TARGET };
    }
    return {
      owner: p.owner,
      name: p.name,
      filePath: typeof p.filePath === "string" && p.filePath ? p.filePath : "README.md",
      branch: typeof p.branch === "string" ? p.branch : "",
    };
  } catch {
    return { ...EMPTY_TARGET };
  }
}

type RepoCtx = {
  target: RepoTarget;
  repoFull: string;
  repoReady: boolean;
  /** True while resolving default repo after sign-in (no stored repo yet). */
  repoResolving: boolean;
  setTarget: (t: Partial<RepoTarget>) => void;
  /** Replace entire target (e.g. pick from GitHub search). */
  selectRepository: (owner: string, name: string, defaultBranch: string) => void;
};

const RepoContext = createContext<RepoCtx | null>(null);

export function RepoProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const initial = loadStored();
  const [target, setTargetState] = useState<RepoTarget>(initial);
  const [bootstrapDone, setBootstrapDone] = useState(() => !!(initial.owner && initial.name));
  const prevUserRef = useRef<typeof user>();

  useEffect(() => {
    try {
      if (target.owner && target.name) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [target]);

  useEffect(() => {
    if (authLoading) return;
    if (prevUserRef.current && !user) {
      setTargetState({ ...EMPTY_TARGET });
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      setBootstrapDone(false);
    }
    prevUserRef.current = user;
  }, [user, authLoading]);

  useEffect(() => {
    if (!user || authLoading) return;
    if (target.owner && target.name) {
      setBootstrapDone(true);
      return;
    }
    let cancelled = false;
    setBootstrapDone(false);
    void (async () => {
      try {
        const list = await fetchMyRepos(1);
        if (cancelled || !list.length) return;
        const r = list[0];
        setTargetState({
          owner: r.owner,
          name: r.name,
          branch: r.defaultBranch,
          filePath: "README.md",
        });
      } catch {
        /* user may have no token scope or API error — leave target empty */
      } finally {
        if (!cancelled) setBootstrapDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, target.owner, target.name]);

  const setTarget = useCallback((patch: Partial<RepoTarget>) => {
    setTargetState((prev) => ({ ...prev, ...patch }));
  }, []);

  const selectRepository = useCallback((owner: string, name: string, defaultBranch: string) => {
    setTargetState({
      owner,
      name,
      branch: defaultBranch || "main",
      filePath: "README.md",
    });
    setBootstrapDone(true);
  }, []);

  const repoFull = target.owner && target.name ? `${target.owner}/${target.name}` : "";
  const repoReady = !!(target.owner && target.name);
  const repoResolving = !!(user && !authLoading && !bootstrapDone);

  const value = useMemo(
    () => ({ target, repoFull, repoReady, repoResolving, setTarget, selectRepository }),
    [target, repoFull, repoReady, repoResolving, setTarget, selectRepository]
  );

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoCtx {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepo must be used within RepoProvider");
  return ctx;
}
