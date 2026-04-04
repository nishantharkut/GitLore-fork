import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SearchBar } from "@/components/Navbar";
import { Spinner } from "@/components/Skeleton";
import { useRepo } from "@/context/RepoContext";
import { useToast } from "@/context/ToastContext";
import { fetchMyRepos, type GithubRepoSummary } from "@/lib/gitloreApi";

const PAGE_SIZE = 12;
const FETCH_LIMIT = 100;

function fmtUpdated(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const RepoSelect = () => {
  const navigate = useNavigate();
  const { selectRepository } = useRepo();
  const { toast } = useToast();
  const [repos, setRepos] = useState<GithubRepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void fetchMyRepos(FETCH_LIMIT)
      .then((list) => {
        if (!cancelled) setRepos(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setRepos([]);
          setErr(e instanceof Error ? e.message : "Could not load your repositories");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(repos.length / PAGE_SIZE));
  const pageRepos = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return repos.slice(start, start + PAGE_SIZE);
  }, [repos, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [repos]);

  const onPick = (r: GithubRepoSummary) => {
    selectRepository(r.owner, r.name, r.defaultBranch);
    toast({ message: `Repository selected: ${r.fullName}`, type: "success" });
    navigate("/overview");
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gitlore-bg px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-heading text-2xl font-bold text-gitlore-text md:text-3xl">Select a repository to explore</h1>
        <p className="mt-2 max-w-xl text-sm text-gitlore-text-secondary">
          Choose one of your GitHub repositories below, or search for any repo you have access to.
        </p>

        <div className="mt-8 max-w-xl">
          <SearchBar />
        </div>

        {err && <p className="mt-6 text-sm text-gitlore-error">{err}</p>}

        {loading && (
          <p className="mt-8 flex items-center gap-2 text-sm text-gitlore-text-secondary" role="status">
            <Spinner className="h-4 w-4" label="Loading repositories" />
            Loading your repositories…
          </p>
        )}

        {!loading && !err && repos.length === 0 && (
          <p className="mt-8 text-sm text-gitlore-text-secondary">
            No repositories returned. Try the search above or check GitHub permissions for this app.
          </p>
        )}

        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {pageRepos.map((r) => {
            const desc = r.description?.trim();
            const shortDesc = desc && desc.length > 120 ? `${desc.slice(0, 118)}…` : desc;
            return (
              <li key={r.fullName}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  className="flex h-full w-full flex-col rounded-sm border border-gitlore-border bg-gitlore-surface p-4 text-left transition-colors hover:border-gitlore-accent/40 hover:bg-gitlore-surface-hover"
                >
                  <span className="font-code text-sm font-medium text-gitlore-accent">{r.fullName}</span>
                  {shortDesc ? (
                    <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-gitlore-text-secondary">{shortDesc}</span>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-code text-[10px] uppercase text-gitlore-text-secondary">
                    <span>{r.private ? "private" : "public"}</span>
                    <span>·</span>
                    <span>{r.defaultBranch}</span>
                    {r.language ? (
                      <>
                        <span>·</span>
                        <span className="normal-case text-gitlore-text">{r.language}</span>
                      </>
                    ) : null}
                    {r.stars != null ? (
                      <>
                        <span>·</span>
                        <span>★ {r.stars}</span>
                      </>
                    ) : null}
                    <span>·</span>
                    <span className="normal-case">Updated {fmtUpdated(r.pushedAt)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {!loading && !err && repos.length > PAGE_SIZE ? (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gitlore-border pt-6">
            <p className="text-xs text-gitlore-text-secondary">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, repos.length)} of {repos.length} repositories
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-sm border border-gitlore-border px-3 py-1.5 text-sm text-gitlore-text transition-colors hover:bg-gitlore-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Previous
              </button>
              <span className="min-w-[5rem] text-center font-code text-xs text-gitlore-text-secondary">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 rounded-sm border border-gitlore-border px-3 py-1.5 text-sm text-gitlore-text transition-colors hover:bg-gitlore-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default RepoSelect;
