import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, CheckCircle, AlertCircle } from "lucide-react";
import { useRepo } from "@/context/RepoContext";
import { prIntelLocalStorageKey, setupRepoWebhook } from "@/lib/gitloreApi";

type Phase = "idle" | "enabling" | "enabled" | "error";

export function PrIntelligenceButton() {
  const { target, repoReady } = useRepo();
  const key = repoReady ? prIntelLocalStorageKey(target.owner, target.name) : "";
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!repoReady || !key) {
      setPhase("idle");
      setMessage(null);
      return;
    }
    try {
      if (localStorage.getItem(key) === "enabled") {
        setPhase("enabled");
        setMessage(null);
      } else {
        setPhase("idle");
        setMessage(null);
      }
    } catch {
      setPhase("idle");
    }
  }, [repoReady, key]);

  const enable = useCallback(async () => {
    if (!repoReady) return;
    setPhase("enabling");
    setMessage(null);
    try {
      const res = await setupRepoWebhook(target.owner, target.name);
      if (res.status === "already_registered" || res.status === "webhook_registered") {
        try {
          localStorage.setItem(prIntelLocalStorageKey(target.owner, target.name), "enabled");
        } catch {
          /* ignore */
        }
        setPhase("enabled");
      }
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) {
        setMessage("Repo admin access required. Ask the repo owner to enable this.");
      } else {
        setMessage(err.message || "Something went wrong");
      }
      setPhase("error");
    }
  }, [repoReady, target.owner, target.name]);

  if (!repoReady) return null;

  if (phase === "enabled") {
    return (
      <div className="flex items-center gap-3 rounded-sm border border-gitlore-success/30 bg-gitlore-success/10 px-4 py-3">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gitlore-success/40 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gitlore-success" />
        </span>
        <CheckCircle className="h-5 w-5 shrink-0 text-gitlore-success" />
        <div className="min-w-0 flex-1 text-sm text-gitlore-text">
          <div className="font-medium">PR Intelligence active</div>
          <div className="text-xs text-gitlore-text-secondary">
            New and reopened PRs get an automatic GitLore comment on GitHub.
          </div>
        </div>
      </div>
    );
  }

  if (phase === "enabling") {
    return (
      <div className="flex items-center gap-3 rounded-sm border border-gitlore-border bg-gitlore-code px-4 py-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gitlore-accent" />
        <span className="text-sm text-gitlore-text">Enabling…</span>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-sm border border-gitlore-error/30 bg-gitlore-error/10 px-4 py-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-gitlore-error" />
          <div className="min-w-0 flex-1 text-sm text-gitlore-text">
            <div className="font-medium">Could not enable PR Intelligence</div>
            <div className="text-xs text-gitlore-text-secondary">{message}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setPhase("idle");
            setMessage(null);
          }}
          className="w-full rounded-sm border border-gitlore-border px-3 py-2 text-xs font-medium text-gitlore-accent hover:bg-gitlore-accent/10"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void enable()}
      className="flex w-full items-center justify-center gap-2 rounded-sm border border-gitlore-border bg-gitlore-surface px-4 py-3 text-sm font-medium text-gitlore-text transition-colors hover:border-gitlore-accent/50 hover:bg-gitlore-accent/5"
    >
      <ShieldCheck className="h-4 w-4 shrink-0 text-gitlore-accent" />
      Enable PR Intelligence
    </button>
  );
}
