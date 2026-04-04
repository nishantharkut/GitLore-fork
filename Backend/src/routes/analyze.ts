import { Hono } from "hono";
import { z } from "zod";
import { getDB } from "../lib/mongo";
import { getUserToken, getCurrentUser } from "../middleware/auth";
import { createGithubClient, getBlameForLine, getIssue, getPullRequest } from "../lib/github";
import {
  GEMINI_CLIENT_FRIENDLY_MESSAGE,
  generateNarrative,
  getEmbedding,
  isLikelyGeminiRelatedError,
} from "../lib/gemini";

export const analyzeRouter = new Hono();

// Schema for analyze request
const analyzeRequestSchema = z.object({
  repo: z.string().describe("Repository in format owner/name"),
  file_path: z.string().describe("Path to the file"),
  line_number: z.number().describe("Line number to analyze"),
  branch: z.string().default("main").describe("Git branch"),
});

type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

/**
 * POST /api/analyze
 * Generate a narrative explaining why a line of code exists
 */
analyzeRouter.post("/analyze", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    // Parse and validate request
    const body = await c.req.json();
    const request = analyzeRequestSchema.parse(body);

    const repoNorm = request.repo.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    const [owner, repo] = repoNorm.split("/");
    if (!owner || !repo) {
      return c.json({ error: "Invalid repo format (use owner/name)" }, 400);
    }

    const cacheKey = `sha:${owner}:${repo}:${request.file_path}:${request.line_number}`;

    // Check cache
    const db = getDB();
    const cached = await db.collection("commit_cache").findOne({ _id: cacheKey } as any);

    if (cached) {
      return c.json(cached.narrative);
    }

    // Get GitHub client
    const githubClient = createGithubClient(user.access_token);

    // Get blame information
    const blameInfo = await getBlameForLine(
      githubClient as any,
      owner,
      repo,
      request.branch,
      request.file_path,
      request.line_number
    );

    if (!blameInfo) {
      return c.json(
        {
          error: "not_found",
          message: "Could not retrieve blame information for this line",
        },
        404
      );
    }

    // Extract commit and PR information
    const commit = blameInfo.commit;
    const prs = commit.associatedPullRequests?.nodes || [];
    const pr = prs[0];

    let narrative: any;
    let dataSignals: string[] = ["git_blame"];

    // Gather context data
    let issuesData: any[] = [];
    let reviewComments: Array<{ author: string; text: string }> = [];
    let prData: any = null;
    let confidence = "low";
    let confidenceReason = "Limited data available";

    // If we have a PR, fetch full details
    if (pr) {
      dataSignals.push("pull_request");
      prData = await getPullRequest(githubClient as any, owner, repo, pr.number);

      // Collect review comments
      if (prData?.reviews?.nodes) {
        reviewComments = prData.reviews.nodes.map((review: any) => ({
          author: review.author?.login || "unknown",
          text: review.body,
        }));
        if (reviewComments.length > 0) {
          dataSignals.push("review_comments");
        }
      }

      // Extract and fetch linked issues
      const issueNumbers = extractIssueNumbers(
        pr.body || "" + prData?.body || ""
      );
      if (issueNumbers.length > 0) {
        dataSignals.push("linked_issues");
        for (const issueNum of issueNumbers) {
          const issue = await getIssue(
            githubClient as any,
            owner,
            repo,
            issueNum
          );
          if (issue) {
            issuesData.push(issue);
          }
        }
      }

      if (dataSignals.length >= 3) {
        confidence = "high";
        confidenceReason = `${issuesData.length} issue(s) + 1 PR + ${reviewComments.length} review comment(s)`;
      } else {
        confidence = "medium";
        confidenceReason = `PR data available with ${reviewComments.length} review comments`;
      }
    } else {
      dataSignals.push("commit_message_only");
      confidenceReason = "Commit message only - no PR or issue data found";
    }

    // Generate narrative
    narrative = await generateNarrative(
      commit.message,
      pr?.title || "",
      pr?.body || prData?.body || "",
      reviewComments,
      issuesData
    );

    // Override confidence based on actual data signals
    narrative.confidence = confidence;
    narrative.confidence_reason = confidenceReason;
    narrative.sources = {
      pr_url: pr
        ? `https://github.com/${owner}/${repo}/pull/${pr.number}`
        : undefined,
      issue_urls: issuesData.map(
        (issue) =>
          `https://github.com/${owner}/${repo}/issues/${issue.number}`
      ),
      review_comment_count: reviewComments.length,
      data_signals: dataSignals,
    };

    // Add timeline information
    const timeline: any[] = [];

    // Add commit to timeline
    timeline.push({
      type: "commit",
      sha: commit.oid,
      message: commit.message,
      author: commit.author?.user?.login || commit.author?.name,
      date: commit.committedDate,
    });

    // Add issues to timeline
    for (const issue of issuesData) {
      timeline.push({
        type: "issue",
        title: issue.title,
        date: issue.createdAt,
      });
    }

    // Add PR to timeline
    if (pr) {
      timeline.push({
        type: "pr",
        number: pr.number,
        title: pr.title,
        url: pr.url,
        date: pr.mergedAt || "open",
      });
    }

    narrative.timeline = timeline;

    // Narrative is the valuable payload; embedding + Mongo cache are best-effort.
    // If they fail (quota, DB timeout), still return the analysis so the UI does not show a false failure.
    try {
      const embedding = await getEmbedding(narrative.one_liner, "document");
      await db.collection("commit_cache").updateOne(
        { _id: cacheKey } as any,
        {
          $set: {
            repo: repoNorm,
            file_path: request.file_path,
            line_number: request.line_number,
            sha: commit.oid,
            message: commit.message,
            author:
              commit.author?.user?.login ||
              commit.author?.name ||
              null,
            narrative,
            embedding: embedding ?? null,
            created_at: new Date(),
            ttl: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
          },
        },
        { upsert: true }
      );
    } catch (cacheErr) {
      console.error("Analyze: narrative ready but embedding/cache failed:", cacheErr);
    }

    return c.json(narrative);
  } catch (error) {
    console.error("Analyze error:", error);

    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation error",
          details: error.errors,
        },
        400
      );
    }

    const raw = error instanceof Error ? error.message : String(error);
    const message = isLikelyGeminiRelatedError(raw)
      ? GEMINI_CLIENT_FRIENDLY_MESSAGE
      : process.env.NODE_ENV === "development"
        ? raw.slice(0, 400)
        : /mongo|Mongo|database|connect|commit_cache/i.test(raw)
          ? "Database error while saving analysis. Check MongoDB and logs."
          : /github|GitHub|rate limit|403|401|Not Found/i.test(raw)
            ? "GitHub API error (rate limit, scope, or repo access). Check logs."
            : "Unexpected error — try again. See server logs for details.";
    return c.json(
      {
        error: "Failed to generate analysis",
        message,
      },
      500
    );
  }
});

/**
 * Helper: Extract issue numbers from text
 */
function extractIssueNumbers(text: string): number[] {
  const pattern =
    /(?:closes|fixes|resolves|close|fix|resolve)\s+#(\d+)/gi;
  const matches = [...text.matchAll(pattern)];
  return [...new Set(matches.map((m) => parseInt(m[1])))];
}
