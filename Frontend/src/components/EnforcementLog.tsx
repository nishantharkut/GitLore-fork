import { useCallback, useEffect, useRef, useState } from "react";
import { Shield, FlaskConical, Loader2 } from "lucide-react";
import { useRepo } from "@/context/RepoContext";
import {
  fetchEnforcementLogs,
  postEnforcementTest,
  type EnforcementLogEntry,
} from "@/lib/gitloreApi";

const TEST_TOOLS = [
  "search_knowledge_graph",
  "fetch_file_content",
  "fetch_pr_details",
  "modify_code",
  "access_credentials",
  "access_private_repo",
  "ingest_repo",
];

function riskBadgeClass(level: string): string {
  const l = level.toLowerCase();
  if (l === "critical") return "bg-red-600/25 text-red-200 border-red-500/40";
  if (l === "high") return "bg-orange-500/20 text-orange-200 border-orange-500/35";
  if (l === "medium") return "bg-amber-500/20 text-amber-200 border-amber-500/35";
  return "bg-gitlore-surface-hover text-gitlore-text-secondary border-gitlore-border";
}

type Props = { refreshKey?: number };

export function EnforcementLog({ refreshKey = 0 }: Props) {
  const { target, repoReady } = useRepo();
  const [logs, setLogs] = useState<EnforcementLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);
  const [testTool, setTestTool] = useState(TEST_TOOLS[0]);
  const [testParams, setTestParams] = useState("{}");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!repoReady) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchEnforcementLogs(target.owner, target.name, 20);
      if (seq !== loadSeqRef.current) return;
      setLogs(res.logs || []);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setErr(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [repoReady, target.owner, target.name]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!repoReady) return;
    const id = window.setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load, repoReady]);

  const runTest = async () => {
    if (!repoReady) return;
    let params: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(testParams.trim() || "{}");
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        setTestResult("Params must be a JSON object, e.g. {} or {\"path\":\"README.md\"} — not an array or null.");
        return;
      }
      params = parsed as Record<string, unknown>;
    } catch {
      setTestResult("Invalid JSON in params.");
      return;
    }
    setTestBusy(true);
    setTestResult(null);
    try {
      const repo = `${target.owner}/${target.name}`;
      const r = await postEnforcementTest({ tool: testTool, params, repo });
      setTestResult(
        `${r.allowed ? "ALLOWED" : "BLOCKED"} — ${r.policy_rule} (${r.risk_level})\n${r.reason}`
      );
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTestBusy(false);
    }
  };

  if (!repoReady) return null;

  return (
    <div className="rounded-sm border border-gitlore-border bg-gitlore-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gitlore-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-gitlore-accent" aria-hidden />
          <div>
            <h3 className="text-sm font-medium text-gitlore-text">ArmorClaw enforcement</h3>
            <p className="text-[11px] text-gitlore-text-secondary">
              Plan-time and per-tool decisions logged for this repo (ArmorIQ track).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowTest((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-sm border border-gitlore-border px-2.5 py-1 text-xs text-gitlore-accent transition-colors hover:bg-gitlore-surface-hover"
        >
          <FlaskConical className="h-3.5 w-3.5" />
          Test action
        </button>
      </div>

      {showTest ? (
        <div className="space-y-2 border-b border-gitlore-border bg-[var(--elevated)] px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <label className="text-[11px] text-gitlore-text-secondary">
              Tool
              <select
                value={testTool}
                onChange={(e) => setTestTool(e.target.value)}
                className="ml-1 rounded-sm border border-gitlore-border bg-gitlore-surface px-2 py-1 font-code text-[11px] text-gitlore-text"
              >
                {TEST_TOOLS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea
            value={testParams}
            onChange={(e) => setTestParams(e.target.value)}
            placeholder='JSON params e.g. {"path":".env"} or {"pr_number":1}'
            rows={3}
            className="w-full rounded-sm border border-gitlore-border bg-gitlore-surface p-2 font-code text-[11px] text-gitlore-text"
          />
          <button
            type="button"
            disabled={testBusy}
            onClick={() => void runTest()}
            className="inline-flex items-center gap-2 rounded-sm bg-gitlore-accent/15 px-3 py-1.5 text-xs font-medium text-gitlore-accent disabled:opacity-50"
          >
            {testBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Run policy check
          </button>
          {testResult ? (
            <pre className="whitespace-pre-wrap rounded-sm border border-gitlore-border bg-gitlore-code p-2 text-[11px] text-gitlore-text">
              {testResult}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="max-h-[280px] overflow-y-auto p-2">
        {loading && logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-gitlore-text-secondary">Loading…</p>
        ) : err ? (
          <p className="py-4 text-center text-sm text-gitlore-error">{err}</p>
        ) : logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-gitlore-text-secondary">
            No enforcement activity yet. Ask a question in the chat to see ArmorClaw in action.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {logs.map((row, i) => (
              <li
                key={`${row.timestamp}-${row.tool}-${i}`}
                className="rounded-sm border border-gitlore-border bg-[var(--elevated)] px-2.5 py-2 text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-code text-gitlore-text-secondary">{row.timestamp?.slice(11, 19)}</span>
                  <span
                    className={`rounded-sm border px-1.5 py-0.5 font-semibold uppercase ${
                      row.action === "allow"
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                        : "border-red-500/40 bg-red-500/15 text-red-300"
                    }`}
                  >
                    {row.action}
                  </span>
                  <span className="font-code text-gitlore-text">{row.tool}</span>
                  <span className={`rounded-sm border px-1.5 py-0.5 ${riskBadgeClass(row.risk_level)}`}>
                    {row.risk_level}
                  </span>
                </div>
                <p className="mt-1 text-gitlore-text-secondary">{row.reason}</p>
                <p className="mt-0.5 font-code text-[10px] text-gitlore-text-secondary/80">
                  rule: {row.policy_rule}
                  {row.phase ? ` · phase: ${row.phase}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
