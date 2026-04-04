import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Schema for explanation responses
export const explanationSchema = z.object({
  pattern_name: z.string(),
  whats_wrong: z.string(),
  why_it_matters: z.string(),
  fix: z.string(),
  principle: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  confidence_reason: z.string().optional(),
});

export type Explanation = z.infer<typeof explanationSchema>;

// Schema for narrative responses
export const narrativeSchema = z.object({
  one_liner: z.string(),
  context: z.string(),
  debate: z.string(),
  debate_quotes: z.array(
    z.object({
      author: z.string(),
      text: z.string(),
      url: z.string().optional(),
      source_type: z
        .enum(["pr_review", "pr_comment", "issue_comment", "commit_message"])
        .optional(),
    })
  ),
  decision: z.string(),
  impact: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  confidence_reason: z.string(),
  sources: z.object({
    pr_url: z.string().optional(),
    issue_urls: z.array(z.string()).optional(),
    review_comment_count: z.number().optional(),
    data_signals: z.array(
      z.enum([
        "git_blame",
        "pull_request",
        "review_comments",
        "linked_issues",
        "commit_message_only",
        "pattern_match",
      ])
    ),
  }),
});

export type Narrative = z.infer<typeof narrativeSchema>;

/**
 * Generate explanation for a code review comment
 */
export async function explainComment(
  comment: string,
  diffHunk: string,
  filePath: string,
  context: string
): Promise<Explanation> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `Respond ONLY with valid JSON (no other text).

{
  "pattern_name": "Anti-pattern name",
  "whats_wrong": "What's wrong (use \\n for newlines)",
  "why_it_matters": "Why it matters",
  "fix": "Fixed code (use \\n for newlines, \\t for tabs)",
  "principle": "Principle",
  "confidence": "high",
  "confidence_reason": "Reason"
}

Review: "${comment}"
File: ${filePath}

Problem code (use exactly as provided):
${diffHunk}

${context ? `Context: ${context}` : ""}

RESPOND IMMEDIATELY WITH JSON (nothing else):`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const responseText =
      result.response.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      return {
        pattern_name: "Unknown Pattern",
        whats_wrong:
          "Unable to analyze this comment at this time. Please provide more context.",
        why_it_matters: "Cannot determine impact without sufficient context.",
        fix: "N/A",
        principle: "Code Review",
        confidence: "low",
        confidence_reason: "Insufficient context provided",
      };
    }

    // Parse JSON from response - try multiple extraction methods
    let jsonStr = responseText.trim();
    
    // Try markdown code block
    let match = jsonStr.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (match) {
      jsonStr = match[1].trim();
    } else {
      // Try to find JSON object in response
      const jsonStart = jsonStr.indexOf("{");
      if (jsonStart !== -1) {
        // Find the matching closing brace
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
        if (endIdx > jsonStart) {
          jsonStr = jsonStr.substring(jsonStart, endIdx + 1);
        }
      }
    }

    // Clean up: replace literal newlines inside strings with escaped versions
    // This is a bit hacky but handles Gemini's sometimes-unescaped newlines
    let i = 0;
    let cleaned = "";
    let inString = false;
    let escapeNext = false;

    for (i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];
      const prevChar = i > 0 ? jsonStr[i - 1] : "";

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

      if (char === '"' && prevChar !== "\\") {
        inString = !inString;
        cleaned += char;
        continue;
      }

      if (inString && (char === "\n" || char === "\r")) {
        // Inside a string, replace newlines with \n
        if (char === "\r" && jsonStr[i + 1] === "\n") {
          i++; // Skip the \n in \r\n
        }
        cleaned += "\\n";
      } else {
        cleaned += char;
      }
    }

    jsonStr = cleaned;

    const parsed = JSON.parse(jsonStr);
    const validated = explanationSchema.parse(parsed);

    return validated;
  } catch (error) {
    console.error("Error generating explanation:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    throw new Error(
      `Failed to generate explanation from Gemini: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate narrative for a code line based on git history
 */
export async function generateNarrative(
  commitMessage: string,
  prTitle: string,
  prBody: string,
  reviewComments: Array<{ author: string; text: string }>,
  issues: Array<{ title: string; body: string }>
): Promise<Narrative> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const contextData = [
    commitMessage && `Commit: ${commitMessage}`,
    prTitle && `PR Title: ${prTitle}`,
    prBody && `Description: ${prBody}`,
    reviewComments.length > 0 &&
      `Reviews:\n${reviewComments.map((c) => `- ${c.author}: ${c.text}`).join("\n")}`,
    issues.length > 0 &&
      `Issues:\n${issues.map((i) => `- ${i.title}: ${i.body}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = `Respond ONLY with valid JSON (no other text). Reconstruct why this code decision was made.

{
  "one_liner": "One line summary",
  "context": "What problem was being solved?",
  "debate": "What tradeoffs or disagreements?",
  "debate_quotes": [{"author": "name", "text": "quote", "url": "", "source_type": "pr_review"}],
  "decision": "What was chosen and why?",
  "impact": "Result of decision",
  "confidence": "high",
  "confidence_reason": "Why this confidence?",
  "sources": {
    "pr_url": "",
    "issue_urls": [],
    "review_comment_count": 0,
    "data_signals": ["git_blame", "pull_request", "review_comments", "linked_issues"]
  }
}

Data:
${contextData}`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const responseText =
      result.response.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      return {
        one_liner:
          "This code was added to the repository but context is limited.",
        context: "Insufficient information available.",
        debate: "No discussion data available.",
        debate_quotes: [],
        decision: "Unknown",
        impact: "Unknown",
        confidence: "low",
        confidence_reason: "No commit message, PR, or issue data available",
        sources: {
          data_signals: [],
        },
      };
    }

    // Parse JSON from response - try multiple extraction methods
    let jsonStr = responseText.trim();
    
    // Try markdown code block
    let match = jsonStr.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (match) {
      jsonStr = match[1].trim();
    } else {
      // Try to find JSON object in response
      const jsonStart = jsonStr.indexOf("{");
      if (jsonStart !== -1) {
        // Find the matching closing brace
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
        if (endIdx > jsonStart) {
          jsonStr = jsonStr.substring(jsonStart, endIdx + 1);
        }
      }
    }

    // Clean up: replace literal newlines inside strings with escaped versions
    let i = 0;
    let cleaned = "";
    let inString = false;
    let escapeNext = false;

    for (i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];
      const prevChar = i > 0 ? jsonStr[i - 1] : "";

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

      if (char === '"' && prevChar !== "\\") {
        inString = !inString;
        cleaned += char;
        continue;
      }

      if (inString && (char === "\n" || char === "\r")) {
        // Inside a string, replace newlines with \n
        if (char === "\r" && jsonStr[i + 1] === "\n") {
          i++; // Skip the \n in \r\n
        }
        cleaned += "\\n";
      } else {
        cleaned += char;
      }
    }

    jsonStr = cleaned;

    const parsed = JSON.parse(jsonStr);
    const validated = narrativeSchema.parse(parsed);

    return validated;
  } catch (error) {
    console.error("Error generating narrative:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    throw new Error(
      `Failed to generate narrative from Gemini: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Simple pattern matching for common anti-patterns
 */
export function matchAntiPattern(
  code: string,
  language: string
): { pattern: string; confidence: number } | null {
  const patterns: Record<string, RegExp[]> = {
    "memory-leak-react-useeffect": [
      /useEffect\s*\(\s*\(\s*\)\s*=>\s*{[^}]*fetch\([^)]*\)[^}]*\}/,
    ],
    "n-plus-one-query": [
      /for\s*\([^)]*\)\s*{[^}]*query\([^)]*\)[^}]*\}/,
      /forEach\s*\(\s*\([^)]*\)\s*=>\s*{[^}]*\.find\(/,
    ],
    "xss-innerhtml": [/innerHTML\s*=\s*(?!.*sanitize|.*marked|.*DOMPurify)/],
    "sql-injection-string-concat": [
      /query\s*\(\s*[`'"]+[^`'"]*\$\{/,
      /sql\s*=\s*[`'"]*[^`'"]*\+\s*user/,
    ],
    "event-listener-leak": [
      /addEventListener\([^,]*,[^)]*\)(?![\s\S]*removeEventListener)/,
    ],
  };

  for (const [patternName, regexes] of Object.entries(patterns)) {
    for (const regex of regexes) {
      if (regex.test(code)) {
        return { pattern: patternName, confidence: 0.7 };
      }
    }
  }

  return null;
}

function hashEmbedding(text: string): number[] {
  const hash = text.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const vector: number[] = [];
  for (let i = 0; i < 768; i++) {
    vector.push(Math.sin((hash + i) * 0.1) * 0.5 + 0.5);
  }
  return vector;
}

/**
 * Embeddings for knowledge retrieval (query + stored nodes). Uses Gemini when GEMINI_API_KEY is set.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return hashEmbedding(text);

  const chunk = text.slice(0, 8000);
  const candidates = ["text-embedding-004", "embedding-001"];
  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const m = model as unknown as {
        embedContent?: (
          input: string | { content: { parts: { text: string }[] } }
        ) => Promise<{ embedding?: { values?: number[] } }>;
      };
      if (typeof m.embedContent !== "function") continue;

      let res: { embedding?: { values?: number[] } } | undefined;
      try {
        res = await m.embedContent({ content: { parts: [{ text: chunk }] } });
      } catch {
        res = await m.embedContent(chunk);
      }
      const values = res?.embedding?.values;
      if (Array.isArray(values) && values.length > 0) return values;
    } catch {
      /* try next model */
    }
  }
  return hashEmbedding(text);
}
