import { useState, useEffect, useRef } from "react";
import { Brain, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useRepo } from "@/context/RepoContext";
import { useToast } from "@/context/ToastContext";
import { postJSON, getJSON } from "@/lib/gitloreApi";

export function IngestButton({ onComplete }: { onComplete?: () => void }) {
  const { target, repoReady } = useRepo();
  const { toast } = useToast();
  const prevStatus = useRef<"idle" | "running" | "done" | "error">("idle");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [processed, setProcessed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(0);
  const [nodeCount, setNodeCount] = useState(0);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (prevStatus.current === "running" && status === "done") {
      toast({
        message: `Knowledge Graph built — ${nodeCount} decision${nodeCount === 1 ? "" : "s"} found`,
        type: "success",
      });
    }
    prevStatus.current = status;
  }, [status, nodeCount, toast]);

  // Check if already ingested on mount
  useEffect(() => {
    if (!repoReady) return;
    setStaleNotice(null);
    const checkStatus = async () => {
      try {
        const res = await getJSON(`/api/repo/${target.owner}/${target.name}/ingest/status`);
        if (res.status === "done") {
          setStatus("done");
          setNodeCount(res.nodeCount || 0);
          setProcessed(res.processed || 0);
          setTotal(res.total || 0);
        } else if (res.status === "stale") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("idle");
          setProcessed(res.processed || 0);
          setTotal(res.total || 0);
          setNodeCount(res.nodeCount || 0);
          setStaleNotice(
            typeof res.hint === "string" ? res.hint : "Previous ingest stopped responding. Click below to run again."
          );
        } else if (res.status === "running") {
          setStatus("running");
          setProcessed(res.processed || 0);
          setTotal(res.total || 0);
          startPolling();
        }
      } catch (err) {
        console.warn("Could not check ingest status:", err);
      }
    };
    checkStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [repoReady, target.owner, target.name]);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await getJSON(`/api/repo/${target.owner}/${target.name}/ingest/status`);
        setProcessed(res.processed || 0);
        setFailed(res.failed || 0);
        setTotal(res.total || 0);
        setNodeCount(res.nodeCount || 0);
        if (res.status === "stale") {
          setStatus("idle");
          if (pollRef.current) clearInterval(pollRef.current);
          setStaleNotice(
            typeof res.hint === "string" ? res.hint : "Previous ingest stopped responding. Click below to run again."
          );
        } else if (res.status === "done" || res.status === "error") {
          setStatus(res.status);
          if (pollRef.current) clearInterval(pollRef.current);
          if (res.status === "done") onComplete?.();
        }
      } catch (err) {
        console.warn("Polling error:", err);
      }
    }, 2000);
  };

  const handleIngest = async () => {
    if (!repoReady || status === "running") return;
    setStaleNotice(null);
    setStatus("running");
    setProcessed(0);
    setFailed(0);
    setTotal(0);
    try {
      const res = (await postJSON(`/api/repo/${target.owner}/${target.name}/ingest`, {
        limit: 30,
      })) as { status?: string };
      if (res.status === "already_running" || res.status === "started") {
        startPolling();
      }
    } catch (err) {
      setStatus("error");
      toast({ message: "Ingest failed — check API key", type: "error" });
      console.error("Ingest error:", err);
    }
  };

  if (status === "done") {
    return (
      <div className="flex items-center gap-3 rounded-sm border border-gitlore-success/30 bg-gitlore-success/10 px-4 py-3">
        <CheckCircle className="h-5 w-5 text-gitlore-success" />
        <div className="flex-1 text-sm text-gitlore-text">
          <div className="font-medium">Knowledge graph built</div>
          <div className="text-xs text-gitlore-text-secondary">
            {nodeCount} decision{nodeCount === 1 ? "" : "s"} indexed from {total} merged PR
            {total === 1 ? "" : "s"}
            {failed > 0 ? (
              <span className="text-gitlore-warning"> · {failed} PR{failed === 1 ? "" : "s"} skipped (errors)</span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="shrink-0 text-xs text-gitlore-text-secondary hover:text-gitlore-text"
        >
          Restart
        </button>
      </div>
    );
  }

  if (status === "running") {
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    return (
      <div className="space-y-2 rounded-sm border border-gitlore-border bg-gitlore-code p-3">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-gitlore-accent" />
          <div className="flex-1">
            <div className="text-sm text-gitlore-text">Ingesting PRs...</div>
            <div className="mt-1 text-xs text-gitlore-text-secondary">
              {processed} / {total} ({percent}%)
            </div>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gitlore-surface">
          <div
            className="h-full bg-gitlore-accent transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-3 rounded-sm border border-gitlore-error/30 bg-gitlore-error/10 px-4 py-3">
        <AlertCircle className="h-5 w-5 text-gitlore-error" />
        <div className="flex-1 text-sm text-gitlore-text">
          <div className="font-medium">Ingestion failed</div>
          <div className="text-xs text-gitlore-text-secondary">
            Check your connection and try again
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setProcessed(0);
            setFailed(0);
            setTotal(0);
          }}
          className="shrink-0 rounded-sm bg-gitlore-error px-2 py-1 text-xs text-white hover:bg-gitlore-error-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {staleNotice ? (
        <p className="rounded-sm border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-gitlore-text-secondary">
          {staleNotice}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleIngest}
        disabled={!repoReady}
        className="flex w-full items-center justify-center gap-2 rounded-sm border border-gitlore-accent bg-gitlore-accent/10 px-4 py-3 text-sm font-medium text-gitlore-accent transition-colors hover:bg-gitlore-accent/20 disabled:opacity-50"
      >
        <Brain className="h-4 w-4" />
        Build Knowledge Graph
      </button>
    </div>
  );
}
