import { getDB } from "../../lib/mongo";
import {
  githubRestJson,
  githubRestJsonMethod,
  githubRestDelete,
  listPullRequestFilesRest,
  GithubRestError,
} from "../../lib/githubRest";
import { searchKnowledgeForPrTitle } from "./kgSearch";
import {
  buildPrIntelligenceCommentMarkdown,
  GITLORE_PR_INTEL_MARKER,
  type RelatedOpenPrRow,
} from "./buildComment";

export type GithubPRWebhookBody = {
  action: string;
  pull_request: { number: number; title?: string };
  repository: {
    full_name: string;
    name: string;
    owner: { login: string };
  };
};

type OpenPrBrief = { number: number; title: string };

export async function processPRWebhook(payload: GithubPRWebhookBody): Promise<void> {
  try {
    const repoFull = payload.repository.full_name.toLowerCase();
    const owner = payload.repository.owner.login;
    const repoName = payload.repository.name;
    const prNumber = payload.pull_request.number;
    const prTitle = payload.pull_request.title ?? "";

    const db = getDB();
    const reg = await db.collection("webhook_registrations").findOne({ repo: repoFull });
    let token = reg?.githubToken as string | undefined;

    if (!token) {
      const serviceUser =
        process.env.SUPERPLANE_SERVICE_USERNAME?.trim() || "gitlore-service";
      const u = await db.collection("users").findOne({ username: serviceUser });
      token = (u?.access_token as string | undefined) ?? undefined;
    }

    if (!token) {
      console.error("[webhook] No GitHub token for repo", repoFull);
      return;
    }

    let currentFiles: string[];
    try {
      const files = await listPullRequestFilesRest(token, owner, repoName, prNumber);
      currentFiles = files.map((f) => f.filename);
    } catch (e) {
      if (e instanceof GithubRestError && e.status === 403) {
        console.warn("[webhook] GitHub 403 listing PR files — rate limit or auth");
      }
      throw e;
    }
    const currentSet = new Set(currentFiles);

    let openPRs: OpenPrBrief[] = [];
    try {
      openPRs = await githubRestJson<OpenPrBrief[]>(
        token,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/pulls?state=open&per_page=20`
      );
    } catch (e) {
      console.warn("[webhook] list open PRs failed:", e);
    }

    const others = openPRs.filter((p) => p.number !== prNumber).slice(0, 10);
    const related: RelatedOpenPrRow[] = [];

    for (let i = 0; i < others.length; i += 5) {
      const batch = others.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async (pr) => {
          try {
            const ofs = await listPullRequestFilesRest(token, owner, repoName, pr.number);
            const names = ofs.map((f) => f.filename);
            const overlap = names.filter((f) => currentSet.has(f));
            if (overlap.length === 0) return null;
            return {
              number: pr.number,
              title: pr.title || "",
              overlappingFiles: overlap,
              overlapCount: overlap.length,
            } satisfies RelatedOpenPrRow;
          } catch {
            return null;
          }
        })
      );
      for (const r of results) if (r) related.push(r);
    }

    let kgRows: Array<{ score: number; one_liner: string }> = [];
    try {
      kgRows = await searchKnowledgeForPrTitle(db, repoFull, prTitle);
    } catch (e) {
      console.warn("[webhook] KG search skipped:", e);
    }

    const md = buildPrIntelligenceCommentMarkdown(repoFull, related, kgRows);

    let comments: Array<{ id: number; body: string }> = [];
    try {
      comments = await githubRestJson<Array<{ id: number; body: string }>>(
        token,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/issues/${prNumber}/comments?per_page=100`
      );
    } catch (e) {
      console.warn("[webhook] list comments failed:", e);
    }

    for (const com of comments) {
      if (typeof com.body === "string" && com.body.includes(GITLORE_PR_INTEL_MARKER)) {
        try {
          await githubRestDelete(
            token,
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/issues/comments/${com.id}`
          );
        } catch (e) {
          console.warn("[webhook] delete comment", com.id, e);
        }
      }
    }

    await githubRestJsonMethod<{ id: number }>(
      token,
      "POST",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/issues/${prNumber}/comments`,
      { body: md }
    );

    console.log(`[webhook] Posted comment on PR #${prNumber} (${repoFull})`);
  } catch (err) {
    console.error("[webhook] PR processing failed:", err);
  }
}
