import { createGithubClient } from "./github";
import { getDB } from "./mongo";
import {
  getEmbedding,
  GEMINI_GENERATION_MODEL,
  withGemini429Retry,
} from "./gemini";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export const knowledgeNodeSchema = z.object({
  type: z.enum([
    "feature",
    "bugfix",
    "refactor",
    "architecture",
    "security",
    "performance",
    "documentation",
    "other",
  ]),
  title: z.string(),
  summary: z.string(),
  problem: z.string(),
  decision: z.string(),
  alternatives: z.array(z.string()),
  key_quotes: z.array(
    z.object({
      author: z.string(),
      text: z.string(),
    })
  ),
  impact: z.string(),
  topics: z.array(z.string()),
});

export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>;

/** If `running` but Mongo `updated_at` is older than this, treat as zombie (server restart / crash). */
export const INGEST_STALE_RUNNING_MS = 20 * 60 * 1000;

/** PRs processed in parallel during ingest (each PR = generateContent + embed). Default 1 avoids free-tier RPM spikes. */
function ingestGeminiConcurrency(): number {
  const n = Number(process.env.GEMINI_INGEST_CONCURRENCY);
  if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), 5);
  return 1;
}

/** Pause between ingest batches (ms). Default spaces out Gemini calls for low quotas. */
function ingestGeminiDelayMs(): number {
  const n = Number(process.env.GEMINI_INGEST_DELAY_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), 120_000);
  return 3500;
}

export function isStaleIngestRunning(doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc || doc.status !== "running") return false;
  const u = doc.updated_at;
  const t = u instanceof Date ? u.getTime() : u ? new Date(String(u)).getTime() : 0;
  if (!t) return false;
  return Date.now() - t > INGEST_STALE_RUNNING_MS;
}

function trunc(s: string, max: number): string {
  if (!s || s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

const MERGED_PRS_QUERY = `
  query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(
        first: 50
        states: [MERGED]
        orderBy: { field: UPDATED_AT, direction: DESC }
        after: $cursor
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          number
          title
          body
          mergedAt
          url
          changedFiles
          additions
          deletions
          author { login }
          reviews(first: 10) {
            nodes {
              body
              state
              author { login }
            }
          }
          comments(first: 20) {
            nodes {
              body
              author { login }
            }
          }
          closingIssuesReferences(first: 8) {
            nodes {
              number
              title
              body
              comments(first: 5) {
                nodes {
                  body
                  author { login }
                }
              }
            }
          }
          mergeCommit {
            oid
            abbreviatedOid
            url
          }
          files(first: 20) {
            nodes { path }
          }
        }
      }
    }
  }
`;

export async function fetchMergedPRs(
  token: string,
  owner: string,
  repo: string,
  limit: number = 50
): Promise<any[]> {
  const client = createGithubClient(token);
  const allPRs: any[] = [];
  let cursor: string | null = null;

  while (allPRs.length < limit) {
    try {
      const result: any = await (client as any)(MERGED_PRS_QUERY, {
        owner,
        name: repo,
        cursor,
      });

      if (Array.isArray(result?.errors) && result.errors.length > 0) {
        const msg = result.errors.map((e: { message?: string }) => e.message).join("; ");
        if (/rate limit|RATE_LIMIT|API rate limit exceeded/i.test(msg)) {
          throw new Error(`GitHub GraphQL rate limit: ${msg}`);
        }
      }

      const connection = result.repository?.pullRequests;
      if (!connection?.nodes?.length) break;

      allPRs.push(...connection.nodes);

      if (!connection.pageInfo.hasNextPage) break;
      cursor = connection.pageInfo.endCursor;
    } catch (err) {
      console.error("fetchMergedPRs:", err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  return allPRs.slice(0, limit);
}

function cleanJsonString(jsonStr: string): string {
  let cleaned = "";
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (escapeNext) {
      cleaned += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      cleaned += char;
      escapeNext = true;
      continue;
    }
    if (char === '"' && !escapeNext) {
      inString = !inString;
      cleaned += char;
      continue;
    }
    if (inString && (char === "\n" || char === "\r")) {
      if (char === "\r" && jsonStr[i + 1] === "\n") i++;
      cleaned += "\\n";
    } else {
      cleaned += char;
    }
  }
  return cleaned;
}

export async function extractKnowledge(pr: any): Promise<KnowledgeNode> {
  const model = genAI.getGenerativeModel({ model: GEMINI_GENERATION_MODEL });

  const reviewNodes = (pr.reviews?.nodes || []).filter((r: any) => r.body?.trim()).slice(0, 10);
  const reviews = reviewNodes
    .map((r: any) => `  ${r.author?.login || "unknown"} (${r.state}): ${trunc(r.body, 2000)}`)
    .join("\n");

  const commentNodes = (pr.comments?.nodes || []).filter((c: any) => c.body?.trim()).slice(0, 15);
  const comments = commentNodes
    .map((c: any) => `  ${c.author?.login || "unknown"}: ${trunc(c.body, 1500)}`)
    .join("\n");

  const issues = (pr.closingIssuesReferences?.nodes || [])
    .map((i: any) => {
      const iComments = (i.comments?.nodes || [])
        .map((c: any) => `    ${c.author?.login || "unknown"}: ${trunc(c.body, 800)}`)
        .join("\n");
      return `  Issue #${i.number}: ${i.title}\n  ${trunc(i.body || "", 1500)}\n${iComments}`;
    })
    .join("\n");

  const fileNodes = (pr.files?.nodes || []).slice(0, 20);
  const files = fileNodes.map((f: any) => f.path).join(", ");

  const body = trunc(pr.body || "", 3000);

  const prompt = `You are extracting knowledge from a GitHub Pull Request for a codebase knowledge graph.

PR #${pr.number}: "${pr.title}"
Author: ${pr.author?.login || "unknown"}
Merged: ${pr.mergedAt || "unknown"}
Changed files: ${files || "unknown"}
Lines: +${pr.additions || 0} / -${pr.deletions || 0}

PR Description:
${body || "(empty)"}

${reviews ? `Reviews:\n${reviews}` : "No reviews."}

${comments ? `Discussion:\n${comments}` : "No discussion."}

${issues ? `Linked Issues:\n${issues}` : "No linked issues."}

Respond ONLY with valid JSON:
{
  "type": "feature|bugfix|refactor|architecture|security|performance|documentation|other",
  "title": "One-line title of the design decision or change (max 80 chars)",
  "summary": "2-3 sentences: what was decided and why",
  "problem": "What problem was being solved? (1-2 sentences)",
  "decision": "What was the final decision? (1-2 sentences)",
  "alternatives": ["Rejected alternative 1", "Rejected alternative 2"],
  "key_quotes": [{"author": "username", "text": "Important quote from review/discussion"}],
  "impact": "What was the impact? (1 sentence)",
  "topics": ["topic1", "topic2"]
}

Rules:
- Extract REAL quotes from the reviews/comments. Do not fabricate.
- If no alternatives were discussed, use empty array.
- If no meaningful quotes exist, use empty array.
- Topics should be 2-5 short tags (e.g., "auth", "api-design", "database", "testing").
- Be concise.`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!responseText) {
    throw new Error("Empty Gemini response");
  }

  let jsonStr = responseText.trim();
  const fence = jsonStr.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (fence) jsonStr = fence[1].trim();
  else {
    const jsonStart = jsonStr.indexOf("{");
    if (jsonStart !== -1) {
      let braceCount = 0;
      let endIdx = jsonStart;
      for (let i = jsonStart; i < jsonStr.length; i++) {
        if (jsonStr[i] === "{") braceCount++;
        if (jsonStr[i] === "}") braceCount--;
        if (braceCount === 0) {
          endIdx = i;
          break;
        }
      }
      if (endIdx > jsonStart) jsonStr = jsonStr.substring(jsonStart, endIdx + 1);
    }
  }

  const cleaned = cleanJsonString(jsonStr);
  const parsed = JSON.parse(cleaned);
  return knowledgeNodeSchema.parse(parsed);
}

export interface IngestProgress {
  status: "running" | "done" | "error";
  processed: number;
  failed: number;
  total: number;
  errors: Array<{ pr_number: number; error: string; timestamp: Date }>;
  startedAt: Date;
}

function pushError(
  errors: Array<{ pr_number: number; error: string; timestamp: Date }>,
  pr_number: number,
  message: string
) {
  errors.push({ pr_number, error: message.slice(0, 500), timestamp: new Date() });
  if (errors.length > 10) errors.splice(0, errors.length - 10);
}

export async function ingestRepo(
  token: string,
  owner: string,
  repo: string,
  limit: number = 50,
  onProgress?: (p: IngestProgress) => void
): Promise<IngestProgress> {
  const db = getDB();
  const repoFull = `${owner}/${repo}`.toLowerCase().replace(/^\/+|\/+$/g, "");
  const progress: IngestProgress = {
    status: "running",
    processed: 0,
    failed: 0,
    total: 0,
    errors: [],
    startedAt: new Date(),
  };

  await db.collection("knowledge_progress").updateOne(
    { repo: repoFull },
    {
      $set: {
        repo: repoFull,
        status: progress.status,
        processed: progress.processed,
        failed: progress.failed,
        total: progress.total,
        errors: progress.errors,
        started_at: progress.startedAt,
        updated_at: new Date(),
      },
    },
    { upsert: true }
  );

  try {
    const prs = await fetchMergedPRs(token, owner, repo, limit);
    progress.total = prs.length;
    onProgress?.(progress);

    await db.collection("knowledge_progress").updateOne(
      { repo: repoFull },
      {
        $set: {
          repo: repoFull,
          status: progress.status,
          processed: progress.processed,
          failed: progress.failed,
          total: progress.total,
          errors: progress.errors,
          started_at: progress.startedAt,
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );

    const BATCH_SIZE = ingestGeminiConcurrency();
    const betweenBatchMs = ingestGeminiDelayMs();
    for (let i = 0; i < prs.length; i += BATCH_SIZE) {
      const batch = prs.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (pr) => {
          const knowledge = await withGemini429Retry(() => extractKnowledge(pr));
          const topics = (knowledge.topics || []).join(", ");
          const embeddingText =
            `${knowledge.title}. ${knowledge.summary}. ${knowledge.decision}. Topics: ${topics}`.trim();
          let embedding: number[] | null = null;
          try {
            embedding = await withGemini429Retry(() => getEmbedding(embeddingText, "document"), {
              maxRetries: 2,
            });
          } catch {
            embedding = null;
          }
          const full_narrative = [
            knowledge.title,
            knowledge.summary,
            knowledge.problem,
            knowledge.decision,
            ...(knowledge.topics || []),
          ].join(" \n ");

          const linked_issues = (pr.closingIssuesReferences?.nodes || []).map((i: any) => ({
            number: i.number,
            title: i.title || `Issue #${i.number}`,
            url: `https://github.com/${owner}/${repo}/issues/${i.number}`,
          }));

          const merge_commit = pr.mergeCommit
            ? {
                oid: pr.mergeCommit.oid,
                short: pr.mergeCommit.abbreviatedOid,
                url: pr.mergeCommit.url,
              }
            : null;

          const doc = {
            repo: repoFull,
            pr_number: pr.number,
            pr_url: pr.url,
            pr_author: pr.author?.login || "unknown",
            merged_at: pr.mergedAt,
            changed_files: (pr.files?.nodes || []).map((f: any) => f.path),
            additions: pr.additions || 0,
            deletions: pr.deletions || 0,
            linked_issues,
            merge_commit,
            ...knowledge,
            full_narrative,
            embedding: embedding ?? null,
            created_at: new Date(),
          };

          await db.collection("knowledge_nodes").updateOne(
            { repo: repoFull, pr_number: pr.number },
            { $set: doc },
            { upsert: true }
          );

          return pr.number;
        })
      );

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const prNum = batch[j]?.number ?? 0;
        if (r.status === "fulfilled") {
          progress.processed++;
        } else {
          progress.failed++;
          const msg =
            r.reason instanceof Error
              ? r.reason.message
              : typeof r.reason === "object" && r.reason && "message" in r.reason
                ? String((r.reason as Error).message)
                : String(r.reason);
          pushError(progress.errors, prNum, msg);
        }
      }

      await db.collection("knowledge_progress").updateOne(
        { repo: repoFull },
        {
          $set: {
            status: progress.status,
            processed: progress.processed,
            failed: progress.failed,
            total: progress.total,
            errors: progress.errors,
            updated_at: new Date(),
          },
        }
      );
      onProgress?.(progress);

      if (i + BATCH_SIZE < prs.length && betweenBatchMs > 0) {
        await new Promise((res) => setTimeout(res, betweenBatchMs));
      }
    }

    if (progress.total === 0) {
      progress.status = "done";
    } else if (progress.processed === 0) {
      progress.status = "error";
    } else {
      progress.status = "done";
    }
  } catch (error) {
    progress.status = "error";
    pushError(
      progress.errors,
      0,
      error instanceof Error ? error.message : String(error)
    );
    console.error("ingestRepo:", error);
  }

  await db.collection("knowledge_progress").updateOne(
    { repo: repoFull },
    {
      $set: {
        status: progress.status,
        processed: progress.processed,
        failed: progress.failed,
        total: progress.total,
        errors: progress.errors,
        updated_at: new Date(),
        completed_at: new Date(),
      },
    },
    { upsert: true }
  );

  return progress;
}
