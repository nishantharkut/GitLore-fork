import type { Db } from "mongodb";
import { getEmbedding, isGeminiRateLimitError } from "../../lib/gemini";
import { hybridDecisionSearch, normalizeRepoKey } from "../../lib/mongoAdvanced";
import { cosineSimilarity } from "../../lib/vectorUtils";

const SCORE_MIN = 0.4;

export type KgSearchRow = { score: number; one_liner: string };

async function cosineFallbackKg(
  db: Db,
  repoKey: string,
  queryEmbedding: number[]
): Promise<KgSearchRow[]> {
  const docs = await db
    .collection("commit_cache")
    .find({ repo: repoKey, embedding: { $exists: true, $type: "array" } })
    .limit(350)
    .toArray();

  const scored: KgSearchRow[] = [];
  for (const doc of docs) {
    const emb = doc.embedding as number[] | undefined;
    if (!Array.isArray(emb) || emb.length !== queryEmbedding.length) continue;
    const score = cosineSimilarity(queryEmbedding, emb);
    const narrative = doc.narrative as { one_liner?: string } | undefined;
    const one_liner =
      (typeof narrative?.one_liner === "string" && narrative.one_liner.trim()) ||
      (typeof doc.message === "string" && doc.message.trim()) ||
      "";
    if (!one_liner) continue;
    scored.push({ score, one_liner });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}

export async function searchKnowledgeForPrTitle(
  db: Db,
  repoFull: string,
  prTitle: string
): Promise<KgSearchRow[]> {
  const repoKey = normalizeRepoKey(repoFull);
  let embedding: number[] | null = null;
  try {
    embedding = await getEmbedding(prTitle || "pull request", "query");
  } catch (e) {
    if (isGeminiRateLimitError(e)) {
      console.warn("[webhook] Gemini rate limit during embedding — skipping KG search");
      return [];
    }
    console.warn("[webhook] getEmbedding failed:", e);
    return [];
  }
  if (!embedding?.length) return [];

  try {
    const rows = await hybridDecisionSearch(embedding, prTitle, repoKey, 5);
    const out: KgSearchRow[] = rows
      .map((doc) => {
        const score = typeof doc.score === "number" ? doc.score : 0;
        const narrative = doc.narrative as { one_liner?: string } | undefined;
        const one_liner =
          (typeof narrative?.one_liner === "string" && narrative.one_liner.trim()) ||
          (typeof doc.message === "string" && doc.message.trim()) ||
          "";
        return { score, one_liner };
      })
      .filter((x) => x.score > SCORE_MIN && x.one_liner);
    if (out.length > 0) return out.slice(0, 5);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const atlasHybrid =
      /\$rankFusion|rankFusion|AtlasError|code:\s*8000/i.test(msg) ||
      (typeof (e as { codeName?: string })?.codeName === "string" &&
        (e as { codeName: string }).codeName === "AtlasError");
    if (atlasHybrid) {
      console.warn(
        "[webhook] Atlas $rankFusion hybrid search not available on this cluster — using cosine KG fallback."
      );
    } else {
      console.warn("[webhook] hybridDecisionSearch failed, using cosine fallback:", msg);
    }
  }

  const fallback = await cosineFallbackKg(db, repoKey, embedding);
  return fallback.filter((x) => x.score > SCORE_MIN).slice(0, 5);
}
