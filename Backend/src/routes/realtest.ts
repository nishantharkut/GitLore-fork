import { Hono } from "hono";
import {
  explainComment,
  generateNarrative,
  matchAntiPattern,
} from "../lib/gemini";

export const realTestRouter = new Hono();

/**
 * POST /test/real-explain
 * Test with REAL Gemini API - actual explanation generation
 */
realTestRouter.post("/real-explain", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as any;

    // Default test data if not provided
    const comment = body.comment || "memory leak";
    const diffHunk =
      body.diff_hunk ||
      `@@ -10,6 +10,12 @@
+  useEffect(() => {
+    fetch(\`/api/users/\${userId}\`)
+      .then(res => res.json())
+      .then(data => setData(data));
+  }, [userId]);`;
    const filePath = body.file_path || "src/components/UserProfile.tsx";
    const context = body.context || "";

    // Generate real explanation using Gemini
    const explanation = await explainComment(
      comment,
      diffHunk,
      filePath,
      context
    );

    // Also try pattern matching
    const patternMatch = matchAntiPattern(diffHunk, "typescript");

    return c.json({
      success: true,
      timestamp: new Date().toISOString(),
      input: {
        comment,
        file_path: filePath,
        diff_hunk: diffHunk.substring(0, 100) + "...",
      },
      pattern_detected: patternMatch?.pattern || null,
      gemini_explanation: explanation,
      full_diff: diffHunk,
    });
  } catch (error) {
    console.error("Real explain error:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * POST /test/real-analyze
 * Test with REAL Gemini API - actual narrative generation
 */
realTestRouter.post("/real-analyze", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as any;

    // Default test data simulating a real commit/PR
    const commitMessage =
      body.commit_message ||
      "fix: add rate limiting middleware to prevent DDoS attacks";
    const prTitle =
      body.pr_title || "Add rate limiting middleware to prevent DDoS attacks";
    const prBody =
      body.pr_body ||
      `Closes #820

After the DDoS incident on March 10, we experienced 503 errors for 12% of requests over 6 hours.

This PR implements rate limiting using an in-memory token bucket approach.

## Changes
- Added RateLimiter class with 100 requests/minute limit
- Integrated with Express middleware
- Added monitoring and metrics

## Testing
- Unit tests: 100% coverage
- Load tested with 10k concurrent connections
- Does not impact normal traffic

## Tech Debt
This uses an in-memory store (simple but not distributed). We should migrate to Redis when DevOps has capacity for cluster provisioning.`;

    const reviewComments = body.review_comments || [
      {
        author: "senior-dev-1",
        text: "Why not Redis? We need distributed support for the multi-region deploy.",
      },
      {
        author: "devops-lead",
        text: "DevOps can't provision a new Redis instance by Friday. We need this live before the weekend attack window.",
      },
      {
        author: "senior-dev-2",
        text: "The tech debt note is great - let's do a spike on Redis after this merger.",
      },
    ];

    const issues = body.issues || [
      {
        title: "Production: 503 errors during peak hours",
        body: "During the DDoS attack yesterday, our API returned 503 errors for 12% of all requests over 6 hours. We need DDoS protection.",
      },
    ];

    // Generate real narrative using Gemini
    const narrative = await generateNarrative(
      commitMessage,
      prTitle,
      prBody,
      reviewComments,
      issues
    );

    return c.json({
      success: true,
      timestamp: new Date().toISOString(),
      input: {
        commit_message: commitMessage.substring(0, 60) + "...",
        pr_title: prTitle,
        review_comments_count: reviewComments.length,
        issues_count: issues.length,
      },
      gemini_narrative: narrative,
      raw_data: {
        commit_message: commitMessage,
        pr_title: prTitle,
        pr_body: prBody.substring(0, 200) + "...",
        review_comments: reviewComments,
        issues: issues,
      },
    });
  } catch (error) {
    console.error("Real analyze error:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * POST /test/real-multi-pattern
 * Test multiple code patterns to show Gemini's explanation capability
 */
realTestRouter.post("/real-multi-pattern", async (c) => {
  try {
    const codePatterns = [
      {
        name: "N+1 Query Problem",
        comment: "N+1 query detected",
        diff: `@@ -45,5 +45,10 @@
+  const users = await User.findAll();
+  users.forEach(user => {
+    const orders = await Order.findByUserId(user.id);
+    console.log(user.name, orders.length);
+  });`,
        file: "src/services/userService.ts",
      },
      {
        name: "XSS Vulnerability",
        comment: "XSS vulnerability - unsanitized HTML",
        diff: `@@ -20,3 +20,5 @@
+  const html = userInput;
+  document.getElementById("output").innerHTML = html;`,
        file: "src/components/UserProfile.tsx",
      },
      {
        name: "Race Condition",
        comment: "Race condition in async update",
        diff: `@@ -10,5 +10,8 @@
+  let data = await fetchData();
+  await updateDatabase(data);
+  await updateCache(data);
+  console.log(data);`,
        file: "src/handlers/cacheHandler.ts",
      },
    ];

    const results = [];

    for (const pattern of codePatterns) {
      try {
        const explanation = await explainComment(
          pattern.comment,
          pattern.diff,
          pattern.file,
          `Pattern type: ${pattern.name}`
        );

        results.push({
          pattern_name: pattern.name,
          success: true,
          explanation,
        });
      } catch (err) {
        results.push({
          pattern_name: pattern.name,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return c.json({
      success: true,
      timestamp: new Date().toISOString(),
      total_patterns: results.length,
      results: results,
    });
  } catch (error) {
    console.error("Multi-pattern error:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});
