import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { postKgFileRelated, type KgFileRelatedItem } from "@/lib/gitloreApi";

type CacheEntry = { items: KgFileRelatedItem[]; fetchedAt: number };

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function cacheKey(owner: string, name: string, filePath: string) {
  return `${owner}/${name}::${filePath}`;
}

type Props = {
  owner: string;
  name: string;
  filePath: string | null | undefined;
  enabled: boolean;
};

/**
 * Zero-click KG context on /app: related merged PRs for the open file (PROMPTS_KG_ENHANCEMENTS Prompt 1).
 */
export function KnowledgeSuggestions({ owner, name, filePath, enabled }: Props) {
  const navigate = useNavigate();
  const [items, setItems] = useState<KgFileRelatedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !filePath?.trim()) {
      setItems(null);
      setLoading(false);
      return;
    }

    const key = cacheKey(owner, name, filePath);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
      setItems(hit.items.length ? hit.items : null);
      lastFetchKey.current = key;
      return;
    }

    let cancelled = false;
    setLoading(true);
    lastFetchKey.current = key;
    void postKgFileRelated(owner, name, filePath)
      .then((rows) => {
        if (cancelled) return;
        cache.set(key, { items: rows, fetchedAt: Date.now() });
        setItems(rows.length ? rows : null);
      })
      .catch(() => {
        if (!cancelled) setItems(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [owner, name, filePath, enabled]);

  if (!enabled || !filePath?.trim()) return null;
  if (!loading && (!items || items.length === 0)) return null;

  const goChat = (question: string) => {
    navigate("/overview", { state: { chatQuery: question } });
  };

  return (
    <div className="border-b border-gitlore-border/70 bg-gitlore-code/20 px-3 py-2.5 md:px-4">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gitlore-text-secondary">
        <Sparkles className="h-3.5 w-3.5 text-amber-500/90" aria-hidden />
        Related decisions (knowledge graph)
      </div>
      {loading && (
        <div className="space-y-2">
          <div className="h-10 animate-pulse rounded-md bg-gitlore-border/25" />
          <div className="h-10 animate-pulse rounded-md bg-gitlore-border/20" />
        </div>
      )}
      {!loading && items && (
        <ul className="space-y-2">
          {items.map((it) => {
            const pct = Math.min(100, Math.round(it.score * 100));
            const q = `Summarize PR #${it.pr_number} ("${it.title.replace(/"/g, "'")}") and how it relates to file ${filePath}.`;
            return (
              <li key={it.pr_number}>
                <button
                  type="button"
                  onClick={() => goChat(q)}
                  className="w-full rounded-md border border-gitlore-border/50 bg-gitlore-code/30 px-3 py-2 text-left transition-colors hover:border-gitlore-accent/50 hover:bg-gitlore-code/50"
                >
                  <div className="flex flex-wrap items-center gap-2 gap-y-1">
                    <span className="rounded px-1.5 font-code text-[10px] text-amber-500">PR #{it.pr_number}</span>
                    <span className="text-[10px] text-gitlore-text-secondary">
                      {it.match_kind === "file" ? "touched file" : it.match_kind === "semantic" ? "semantic" : "file + match"}
                    </span>
                    <span className="ml-auto text-[10px] text-gitlore-text-secondary">{pct}%</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-gitlore-text">{it.summary || it.title}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-gitlore-text-secondary/80">
        Opens Overview chat with a prefilled question. Build the knowledge graph on Overview if this list is empty.
      </p>
    </div>
  );
}

/** Call after a successful ingest to refresh zero-click hints. */
export function invalidateKnowledgeSuggestionsCache() {
  cache.clear();
}
