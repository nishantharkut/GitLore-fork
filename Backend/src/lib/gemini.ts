import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Text generation (PR knowledge extraction, narratives, review explanations).
 * Chat uses GEMINI_CHAT_MODEL if set, otherwise this default.
 * Default: gemini-2.5-flash-lite (cost-efficient; free tier with its own quotas).
 * Quotas are per Google Cloud / AI Studio project — a new API key in the same project does not reset limits.
 * gemini-2.0-flash is deprecated — override with GEMINI_GENERATION_MODEL if needed.
 */
export const GEMINI_GENERATION_MODEL =
  process.env.GEMINI_GENERATION_MODEL?.trim() || "gemini-2.5-flash-lite";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True for HTTP 429 / RESOURCE_EXHAUSTED-style Gemini errors. */
export function isGeminiRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /429|rate\s*limit|resource_exhausted|too many requests|quota exceeded/i.test(
      msg
    )
  ) {
    return true;
  }
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: number })?.code;
  return status === 429 || code === 429;
}

/** Expired, revoked, or malformed API key (retries will not help). */
export function isGeminiApiKeyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/API_KEY_INVALID|API key expired|invalid api key|API key not valid/i.test(msg)) {
    return true;
  }
  if (/\[400\b[^\]]*Bad Request\]/i.test(msg) && /api key/i.test(msg)) {
    return true;
  }
  const status = (err as { status?: number })?.status;
  return status === 400 && /api key|API_KEY/i.test(msg);
}

/** Parse `Please retry in 14.9s` from Gemini error text when present. */
export function geminiSuggestedRetryMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/retry in ([\d.]+)\s*s\b/i);
  if (!m) return null;
  const sec = parseFloat(m[1]);
  if (!Number.isFinite(sec) || sec < 0) return null;
  return Math.min(Math.ceil(sec * 1000) + 500, 120_000);
}

export type Gemini429RetryOptions = {
  /** Extra attempts after the first failure (default 3 → 4 total calls). */
  maxRetries?: number;
};

/**
 * Retries generateContent-style calls when the API returns 429. Uses server
 * suggested delay when present (see terminal: "Please retry in 14.9s").
 */
export async function withGemini429Retry<T>(
  fn: () => Promise<T>,
  opts?: Gemini429RetryOptions
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isGeminiRateLimitError(e) || attempt >= maxRetries) throw e;
      const suggested = geminiSuggestedRetryMs(e);
      const delay =
        suggested ?? Math.min(12_000 + attempt * 8_000, 90_000);
      console.warn(
        `[Gemini] Rate limited (${attempt + 1}/${maxRetries + 1}), waiting ${Math.round(delay / 1000)}s…`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

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
  const model = genAI.getGenerativeModel({ model: GEMINI_GENERATION_MODEL });

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
    const result = await withGemini429Retry(() =>
      model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      })
    );

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
  const model = genAI.getGenerativeModel({ model: GEMINI_GENERATION_MODEL });

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
    const result = await withGemini429Retry(() =>
      model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      })
    );

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

/**
 * Comma-separated in GEMINI_EMBEDDING_MODELS.
 * Default order: models that work with Generative Language API v1 + @google/generative-ai embedContent
 * (gemini-embedding-001 often 404s on v1 — see https://ai.google.dev/gemini-api/docs/embeddings).
 */
function embeddingModelCandidates(): string[] {
  const raw = process.env.GEMINI_EMBEDDING_MODELS?.trim();
  if (raw) {
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) return list;
  }
  return ["text-embedding-004", "embedding-001", "gemini-embedding-001"];
}

export type EmbeddingRole = "query" | "document";

/**
 * Real embeddings only (no hash fallback). Returns null if no API key or all models fail —
 * callers must fall back to $text / regex (see KNOWLEDGE_GRAPH_FOLLOWUP.md §4).
 */
export async function getEmbedding(
  text: string,
  role: EmbeddingRole = "query"
): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;

  const chunk = text.slice(0, 8000);
  const taskType =
    role === "query" ? TaskType.RETRIEVAL_QUERY : TaskType.RETRIEVAL_DOCUMENT;

  for (const modelName of embeddingModelCandidates()) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const attempts: Array<() => Promise<{ embedding?: { values?: number[] } }>> = [
        () => model.embedContent(chunk),
        () =>
          model.embedContent({
            content: { role: "user", parts: [{ text: chunk }] },
          }),
        () =>
          model.embedContent({
            content: { role: "user", parts: [{ text: chunk }] },
            taskType,
          }),
      ];
      for (const run of attempts) {
        try {
          const res = await run();
          const values = res?.embedding?.values;
          if (Array.isArray(values) && values.length > 0) return values;
        } catch (e) {
          if (isGeminiRateLimitError(e)) throw e;
        }
      }
    } catch (err) {
      if (isGeminiRateLimitError(err)) throw err;
      console.warn(`getEmbedding model ${modelName} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

/**
 * Translate a short English TTS script to Hindi (Devanagari) for multilingual TTS.
 * Used by /api/voice/tts when locale=hi.
 */
export async function translateEnglishToHindiForSpeech(english: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const model = genAI.getGenerativeModel({ model: GEMINI_GENERATION_MODEL });
  const prompt = `You translate English into natural Hindi suitable for text-to-speech.

Rules:
- Output ONLY Hindi in Devanagari script. No English, no quotes, no preamble, no bullet points.
- Keep technical terms (file paths, PR numbers, repo names) in Latin script when clearer.
- Stay concise; do not add facts not in the source.

English to translate:

${english}`;

  const result = await withGemini429Retry(() =>
    model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    })
  );

  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Empty Hindi translation from model");
  return text.length > 5000 ? `${text.slice(0, 4999)}…` : text;
}

/**
 * Spoken Q&A for ElevenLabs voice agent (client tool → this via API).
 * Context must be the full GitLore narrative summary; answer is plain English for TTS.
 */
export async function voiceStoryAnswer(contextText: string, userQuestion: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const ctx = contextText.slice(0, 12_000);
  const q = userQuestion.trim().slice(0, 2000);

  const model = genAI.getGenerativeModel({ model: GEMINI_GENERATION_MODEL });
  const prompt = `You are answering a developer who is asking by voice about a single line of code in a GitHub repository.

The following text is the ONLY source of truth (from GitLore: blame, PRs, discussion, decision, impact). Do not invent commits, people, PR numbers, or events that are not clearly supported by this text.

--- STORY CONTEXT ---
${ctx}
--- END CONTEXT ---

The user asked (spoken): "${q.replace(/"/g, "'")}"

Reply in plain English suitable to be read aloud by a voice assistant:
- Start directly with the answer; no "Sure!" preamble unless it is one short word.
- Use 2 to 6 short sentences unless they clearly ask for more detail.
- If the context does not contain the answer, say that this summary does not include that information and suggest what you can answer from the story instead.
- No markdown, bullet lists, or code fences. You may say short paths or PR numbers inline.
- Be accurate, concrete, and easy to understand.

Your reply:`;

  const result = await withGemini429Retry(() =>
    model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    })
  );

  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Empty voice answer from model");
  return text.length > 4000 ? `${text.slice(0, 3999)}…` : text;
}
