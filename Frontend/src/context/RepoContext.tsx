import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";

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
  setTarget: (t: Partial<RepoTarget>) => void;
  /** Replace entire target (e.g. pick from GitHub search). */
  selectRepository: (owner: string, name: string, defaultBranch: string) => void;
};

const RepoContext = createContext<RepoCtx | null>(null);

export function RepoProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const initial = loadStored();
  const [target, setTargetState] = useState<RepoTarget>(initial);
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
    }
    prevUserRef.current = user;
  }, [user, authLoading]);

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
  }, []);

  const repoFull = target.owner && target.name ? `${target.owner}/${target.name}` : "";
  const repoReady = !!(target.owner && target.name);

  const value = useMemo(
    () => ({ target, repoFull, repoReady, setTarget, selectRepository }),
    [target, repoFull, repoReady, setTarget, selectRepository]
  );

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoCtx {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepo must be used within RepoProvider");
  return ctx;
}
