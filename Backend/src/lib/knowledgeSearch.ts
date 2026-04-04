/**
 * Shared knowledge-node retrieval for chat and ArmorIQ agent tools.
 */
import type { Db } from "mongodb";
import { getEmbedding } from "./gemini";
import { cosineSimilarity } from "./vectorUtils";

const STOP = new Set([
  "the",
  "what",
  "why",
  "how",
  "did",
  "does",
  "was",
  "were",
  "this",
  "that",
  "from",
  "with",
  "and",
  "for",
  "are",
  "you",
  "your",
]);

export function normalizeRepoKey(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase().replace(/^\/+|\/+$/g, "");
}

export type SearchTier = "vector" | "text" | "regex" | "none";

export type ScoredNode = { doc: Record<string, unknown>; score: number };

const QUOTE_MAX = 450;

function truncQuote(s: string, max: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function dedupeByPr(nodes: ScoredNode[]): ScoredNode[] {
  const best = new Map<number, ScoredNode>();
  for (const n of nodes) {
    const pr = n.doc.pr_number as number;
    const cur = best.get(pr);
    if (!cur || n.score > cur.score) best.set(pr, n);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

type LinkedIssueDoc = {
  number: number;
  title?: string;
  url?: string;
  body_excerpt?: string;
};

export function buildContextBlock(n: Record<string, unknown>): string {
  const quotes = (n.key_quotes as Array<{ author: string; text: string }>) || [];
  const alts = (n.alternatives as string[]) || [];
  const files = (n.changed_files as string[]) || [];
  const linked = (n.linked_issues as LinkedIssueDoc[]) || [];
  const linkedLines =
    linked.length > 0
      ? linked
          .map((i) => {
            const ex = i.body_excerpt?.trim()
              ? `\n    Issue context (excerpt): ${truncQuote(i.body_excerpt, 420)}`
              : "";
            return `  - Issue #${i.number}: ${i.title || ""} → ${i.url || ""}${ex}`;
          })
          .join("\n")
      : "  (none in index — re-run Build Knowledge Graph to refresh issue links)";
  const mc = n.merge_commit as { short?: string; url?: string } | null | undefined;
  const mergeLine = mc?.url
    ? `Merge commit: ${mc.short || ""} → ${mc.url}`
    : "(merge commit not stored for this PR — re-run ingest to link commits)";
  const narrative = String(n.full_narrative || "").slice(0, 4000);
  const topics = (n.topics as string[]) || [];
  const topicLine = topics.length ? topics.join(", ") : "(none)";
  const prUrl = String(n.pr_url || "");
  const add = typeof n.additions === "number" ? n.additions : null;
  const del = typeof n.deletions === "number" ? n.deletions : null;
  const sizeLine =
    add != null && del != null ? `Approx. diff size: +${add} / -${del} lines (from GitHub)` : "";
  const quoteBlock =
    quotes.length > 0
      ? quotes
          .map((q) => `  - ${q.author || "unknown"}: "${truncQuote(q.text, QUOTE_MAX)}"`)
          .join("\n")
      : "  (none)";
  return `--- Knowledge Node (PR #${n.pr_number}, type: ${n.type}) ---
PR URL: ${prUrl || "(unknown)"}
Title: ${n.title}
GitHub author (merge): ${n.pr_author || "unknown"}
Topics: ${topicLine}
Summary: ${n.summary}
Problem: ${n.problem}
Decision: ${n.decision}
Linked issues (from GitHub GraphQL):
${linkedLines}
${mergeLine}
Alternatives considered: ${alts.length ? alts.join("; ") : "(none)"}
Key quotes (exact text from reviews/discussion — use verbatim when citing):
${quoteBlock}
Impact: ${n.impact}
Files changed: ${files.join(", ") || "unknown"}
Merged at: ${n.merged_at || "unknown"}
${sizeLine ? `${sizeLine}\n` : ""}Consolidated narrative (excerpt): ${narrative || "(none)"}
---`;
}

export async function tryVectorSearchAtlas(
  db: Db,
  repoFull: string,
  queryVector: number[]
): Promise<ScoredNode[]> {
  const coll = db.collection("knowledge_nodes");
  const pipeline = [
    {
      $vectorSearch: {
        index: "knowledge_vector_index",
        path: "embedding",
        queryVector,
        numCandidates: 100,
        limit: 16,
        filter: { repo: repoFull },
      },
    },
    {
      $set: { vectorScore: { $meta: "vectorSearchScore" } },
    },
    {
      $project: {
        embedding: 0,
        vectorScore: 1,
        repo: 1,
        pr_number: 1,
        pr_url: 1,
        type: 1,
        title: 1,
        summary: 1,
        problem: 1,
        decision: 1,
        alternatives: 1,
        key_quotes: 1,
        impact: 1,
        changed_files: 1,
        merged_at: 1,
        topics: 1,
        full_narrative: 1,
        linked_issues: 1,
        merge_commit: 1,
        pr_author: 1,
        additions: 1,
        deletions: 1,
      },
    },
  ];
  const raw = await coll.aggregate(pipeline as any).toArray();
  return raw
    .map((doc: any) => ({
      doc,
      score: typeof doc.vectorScore === "number" ? doc.vectorScore : 0,
    }))
    .filter((x) => x.score >= 0.45)
    .map(({ doc, score }) => {
      const { vectorScore: _v, ...rest } = doc;
      return { doc: rest, score };
    });
}

export async function tryInMemoryVector(
  db: Db,
  repoFull: string,
  queryVector: number[]
): Promise<ScoredNode[]> {
  const docs = await db
    .collection("knowledge_nodes")
    .find({ repo: repoFull })
    .project({
      embedding: 1,
      repo: 1,
      pr_number: 1,
      pr_url: 1,
      type: 1,
      title: 1,
      summary: 1,
      problem: 1,
      decision: 1,
      alternatives: 1,
      key_quotes: 1,
      impact: 1,
      changed_files: 1,
      merged_at: 1,
      topics: 1,
      full_narrative: 1,
      linked_issues: 1,
      merge_commit: 1,
      pr_author: 1,
      additions: 1,
      deletions: 1,
    })
    .limit(150)
    .toArray();

  const scored: ScoredNode[] = [];
  for (const doc of docs) {
    const emb = doc.embedding as number[] | undefined;
    if (!Array.isArray(emb) || emb.length !== queryVector.length) continue;
    const score = cosineSimilarity(queryVector, emb);
    if (score >= 0.45) {
      const { embedding: _e, ...rest } = doc;
      scored.push({ doc: rest as Record<string, unknown>, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 16);
}

export async function tryTextSearch(db: Db, repoFull: string, question: string): Promise<ScoredNode[]> {
  try {
    const arr = await db
      .collection("knowledge_nodes")
      .find({ repo: repoFull, $text: { $search: question } })
      .project({ score: { $meta: "textScore" }, embedding: 0 })
      .sort({ score: { $meta: "textScore" } })
      .limit(14)
      .toArray();
    return arr
      .map((doc: any) => {
        const { score, ...rest } = doc;
        return {
          doc: rest as Record<string, unknown>,
          score: typeof score === "number" ? score : 0,
        };
      })
      .filter((x) => x.score >= 1.0);
  } catch {
    return [];
  }
}

function keywordsFromQuestion(q: string): string[] {
  const handles = [...q.matchAll(/@([\w-]{2,39})/g)].map((m) => m[1].toLowerCase());
  const words = q
    .split(/\s+/)
    .map((w) => w.replace(/[^\w-]/g, "").toLowerCase())
    .filter((w) => w.length >= 3 && !STOP.has(w));
  const merged = [...handles, ...words];
  return [...new Set(merged)].slice(0, 12);
}

async function tryRegexFallback(
  db: Db,
  repoFull: string,
  question: string
): Promise<ScoredNode[]> {
  const keywords = keywordsFromQuestion(question);
  if (!keywords.length) return [];

  const docs = await db
    .collection("knowledge_nodes")
    .find({ repo: repoFull })
    .project({ embedding: 0 })
    .limit(400)
    .toArray();

  const scored: ScoredNode[] = [];
  const fields = [
    "title",
    "summary",
    "decision",
    "problem",
    "full_narrative",
    "pr_author",
    "impact",
  ] as const;

  const linkedText = (doc: Record<string, unknown>) => {
    const arr = (doc.linked_issues as Array<{ title?: string; number?: number }>) || [];
    return arr.map((i) => `${i.number} ${i.title || ""}`).join(" ");
  };

  const quotesText = (doc: Record<string, unknown>) => {
    const arr = (doc.key_quotes as Array<{ author?: string; text?: string }>) || [];
    return arr.map((q) => `${q.author || ""} ${q.text || ""}`).join(" ");
  };

  const topicsText = (doc: Record<string, unknown>) =>
    ((doc.topics as string[]) || []).join(" ");
  const filesText = (doc: Record<string, unknown>) =>
    ((doc.changed_files as string[]) || []).join(" ");
  const altsText = (doc: Record<string, unknown>) =>
    ((doc.alternatives as string[]) || []).join(" ");

  for (const doc of docs) {
    let matches = 0;
    for (const kw of keywords) {
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const d = doc as Record<string, unknown>;
      if (
        fields.some((f) => re.test(String(d[f] || ""))) ||
        re.test(linkedText(d)) ||
        re.test(quotesText(d)) ||
        re.test(topicsText(d)) ||
        re.test(filesText(d)) ||
        re.test(altsText(d))
      ) {
        matches++;
      }
    }
    if (matches > 0) {
      const score = matches / keywords.length;
      scored.push({ doc: doc as Record<string, unknown>, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 14);
}

export async function runKnowledgeSearch(
  db: Db,
  repoFull: string,
  question: string
): Promise<{
  tier: SearchTier;
  scored: ScoredNode[];
  embeddingFailed: boolean;
  queryVector: number[] | null;
}> {
  let tier: SearchTier = "none";
  let scored: ScoredNode[] = [];
  let embeddingFailed = false;

  let queryVector: number[] | null = null;
  try {
    queryVector = await getEmbedding(question, "query");
  } catch {
    embeddingFailed = true;
  }
  if (!queryVector) embeddingFailed = true;

  if (queryVector && !embeddingFailed) {
    try {
      scored = await tryVectorSearchAtlas(db, repoFull, queryVector);
      if (scored.length) tier = "vector";
    } catch {
      /* Atlas vector index missing */
    }
    if (!scored.length) {
      scored = await tryInMemoryVector(db, repoFull, queryVector);
      if (scored.length) tier = "vector";
    }
  }

  if (!scored.length) {
    scored = await tryTextSearch(db, repoFull, question);
    if (scored.length) tier = "text";
  }

  if (!scored.length) {
    scored = await tryRegexFallback(db, repoFull, question);
    if (scored.length) tier = "regex";
  }

  return { tier, scored, embeddingFailed, queryVector };
}

/**
 * Pull in additional PRs that share closing issues, ingest themes, or authors with the best matches.
 */
export async function expandRelatedNodes(
  db: Db,
  repoFull: string,
  seeds: ScoredNode[],
  maxExtra: number
): Promise<ScoredNode[]> {
  if (!seeds.length || maxExtra <= 0) return [];

  const prNums = new Set<number>();
  const issueNums = new Set<number>();
  const topicSet = new Set<string>();
  const authors = new Set<string>();

  for (const s of seeds) {
    prNums.add(s.doc.pr_number as number);
    const li = (s.doc.linked_issues as LinkedIssueDoc[]) || [];
    for (const i of li) {
      if (Number.isFinite(i.number)) issueNums.add(i.number);
    }
    for (const t of (s.doc.topics as string[]) || []) {
      const x = t.trim();
      if (x) topicSet.add(x);
    }
    const a = String(s.doc.pr_author || "").trim();
    if (a && a.toLowerCase() !== "unknown") authors.add(a);
  }

  const orClauses: Record<string, unknown>[] = [];
  if (issueNums.size) orClauses.push({ "linked_issues.number": { $in: [...issueNums] } });
  if (topicSet.size) orClauses.push({ topics: { $in: [...topicSet] } });
  if (authors.size) orClauses.push({ pr_author: { $in: [...authors] } });
  if (!orClauses.length) return [];

  const candidates = await db
    .collection("knowledge_nodes")
    .find({
      repo: repoFull,
      pr_number: { $nin: [...prNums] },
      $or: orClauses,
    })
    .project({ embedding: 0 })
    .limit(140)
    .toArray();

  const seedTopicLower = [...topicSet].map((t) => t.toLowerCase());
  const scoredExtra: ScoredNode[] = [];

  for (const doc of candidates) {
    const d = doc as Record<string, unknown>;
    let bonus = 0;
    const li = (d.linked_issues as LinkedIssueDoc[]) || [];
    const liNums = new Set(li.map((x) => x.number));
    for (const n of issueNums) {
      if (liNums.has(n)) bonus += 2.5;
    }
    const tops = ((d.topics as string[]) || []).map((t) => t.toLowerCase());
    for (const st of seedTopicLower) {
      if (tops.some((t) => t === st || t.includes(st) || st.includes(t))) bonus += 1.2;
    }
    if (authors.has(String(d.pr_author || "").trim())) bonus += 0.85;
    if (bonus <= 0) continue;
    const synthetic = 0.28 + Math.min(bonus * 0.07, 0.55);
    scoredExtra.push({ doc: d, score: synthetic });
  }

  return dedupeByPr(scoredExtra).slice(0, maxExtra);
}
