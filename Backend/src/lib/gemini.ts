import { GoogleGenAI, FinishReason } from "@google/genai";
import { z } from "zod";

/** Shared Gemini API client (Gemini Developer API). Prefer this over the deprecated `@google/generative-ai` package. */
let _googleGenAI: GoogleGenAI | null = null;
export function getGoogleGenAI(): GoogleGenAI {
  if (!_googleGenAI) {
    _googleGenAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY?.trim() || "",
    });
  }
  return _googleGenAI;
}

/**
 * Text generation (PR knowledge extraction, narratives, review explanations).
 * Chat uses GEMINI_CHAT_MODEL if set, otherwise this default.
 * Default: gemini-2.5-flash-lite (cost-efficient; free tier with its own quotas).
 * Quotas are per Google Cloud / AI Studio project — a new API key in the same project does not reset limits.
 * gemini-2.0-flash is deprecated — override with GEMINI_GENERATION_MODEL if needed.
 */
export const GEMINI_GENERATION_MODEL =
  process.env.GEMINI_GENERATION_MODEL?.trim() || "gemini-2.5-flash-lite";

/** Prefer gemini-2.5-flash for PR comment explanations when set. */
export const GEMINI_EXPLAIN_MODEL =
  process.env.GEMINI_EXPLAIN_MODEL?.trim() || "gemini-2.5-flash";

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

/** Node's console.error → util.inspect can throw on some Google SDK error shapes. */
function safeErrText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    try {
      return String((err as { message: unknown }).message);
    } catch {
      return "[unreadable .message]";
    }
  }
  try {
    return String(err);
  } catch {
    return "[unknown error]";
  }
}

function logGeminiFailure(label: string, err: unknown): void {
  console.error(`${label}: ${safeErrText(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
}

/**
 * First balanced top-level `{ ... }`, respecting JSON string literals so `{`/`}` inside
 * strings do not break matching (the old brace-count approach corrupted many model replies).
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Turn raw newlines inside JSON string values into `\n` so JSON.parse succeeds. */
function escapeNewlinesInsideJsonStrings(jsonStr: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const c = jsonStr[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        out += c;
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        out += c;
        continue;
      }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && jsonStr[i + 1] === "\n") i += 1;
        out += "\\n";
        continue;
      }
      out += c;
      continue;
    }
    if (c === '"') inString = true;
    out += c;
  }
  return out;
}

function prepareGeminiJsonText(responseText: string): string {
  let s = responseText.trim();
  const fence = s.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (fence) s = fence[1].trim();

  const extracted = extractFirstJsonObject(s);
  if (extracted) s = extracted;
  else {
    const jsonStart = s.indexOf("{");
    if (jsonStart !== -1) s = s.slice(jsonStart);
  }

  return escapeNewlinesInsideJsonStrings(s);
}

function parseModelJson<T>(responseText: string, schema: z.ZodType<T>): T {
  const jsonStr = prepareGeminiJsonText(responseText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    const t = safeErrText(e);
    const truncated =
      /unterminated string|unexpected end of json/i.test(t) ||
      extractFirstJsonObject(jsonStr) === null;
    const hint = truncated
      ? " Model output may be truncated (timeout, maxOutputTokens, or slow response)."
      : "";
    throw new Error(`Invalid JSON from model:${hint} ${t}`);
  }
  return schema.parse(parsed);
}

const structuredJsonGenerationConfig = {
  maxOutputTokens: 8192,
  temperature: 0.25,
};

/** v1beta + responseMimeType yields valid JSON from Gemini (avoids truncated prose-style replies). */
const explainJsonGenerationConfig = {
  maxOutputTokens: 16_384,
  temperature: 0.12,
  responseMimeType: "application/json",
} as const;

function clipForPrompt(label: string, text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[${label} truncated at ${maxChars} characters]`;
}

// Schema for explanation responses
export const explanationSchema = z.object({
  pattern_name: z.string(),
  whats_wrong: z.string(),
  why_it_matters: z.string(),
  fix: z.string(),
  principle: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  confidence_reason: z.string(),
  docs_links: z.array(z.string()).optional(),
});

export type Explanation = z.infer<typeof explanationSchema>;

export type ExplainCommentInput = {
  comment: string;
  diffHunk: string;
  filePath: string;
  language: string;
  surroundingContext: string;
  patternTemplate: string | null;
};

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

const EXPLAIN_SYSTEM = `You are a code review mentor. Given a terse review comment and surrounding code context, explain exactly what is wrong in THIS specific code (not generically), why it matters in production, and provide the corrected code. Reference actual variable names and function names from the code shown.

JSON rules (critical): You must output valid JSON only. Do not put raw double-quote characters inside any string value — use single quotes for quoted snippets or escape as \\". Keep each text field under 1200 characters; prefer concise paragraphs. Use \\n inside strings for line breaks in code samples. Never be generic.`;

/**
 * Generate explanation for a code review comment (Gemini 2.5 Flash structured JSON).
 */
export async function explainComment(input: ExplainCommentInput): Promise<Explanation> {
  const ai = getGoogleGenAI();

  const patternBlock = input.patternTemplate
    ? `\nMatched pattern template:\n${clipForPrompt("pattern", input.patternTemplate, 6000)}\n`
    : "";

  const diffHunk = clipForPrompt("Diff hunk", input.diffHunk, 14_000);
  const surrounding = input.surroundingContext
    ? clipForPrompt("Surrounding context", input.surroundingContext, 14_000)
    : "(unavailable)";

  const prompt = `${EXPLAIN_SYSTEM}

Respond with a single JSON object (no markdown fences) using exactly these keys:
pattern_name, whats_wrong, why_it_matters, fix, principle, confidence (one of: high, medium, low), confidence_reason, docs_links (array of URL strings, may be empty).

Terse review comment: ${JSON.stringify(input.comment)}
File path: ${input.filePath}
Language (inferred): ${input.language}

Diff hunk (added lines start with +, removed with -):
${diffHunk}

Surrounding file context (±30 lines around the comment line):
${surrounding}
${patternBlock}`;

  const emptyExplanation = (): Explanation => ({
    pattern_name: "Unknown Pattern",
    whats_wrong:
      "Unable to analyze this comment at this time. Please provide more context.",
    why_it_matters: "Cannot determine impact without sufficient context.",
    fix: "N/A",
    principle: "Code Review",
    confidence: "low",
    confidence_reason: "Insufficient context provided",
    docs_links: [],
  });

  const runGenerate = (text: string) =>
    withGemini429Retry(() =>
      ai.models.generateContent({
        model: GEMINI_EXPLAIN_MODEL,
        contents: text,
        config: {
          ...explainJsonGenerationConfig,
        },
      })
    );

  try {
    let result = await runGenerate(prompt);
    let responseText = result.text ?? "";

    if (!responseText) {
      return emptyExplanation();
    }

    const finishReason = result.candidates?.[0]?.finishReason;
    const needsCompactRetry = finishReason === FinishReason.MAX_TOKENS;

    const tryParse = (t: string) => parseModelJson(t, explanationSchema);

    if (!needsCompactRetry) {
      try {
        return tryParse(responseText);
      } catch (e) {
        console.warn(
          `[explain] JSON parse failed, retrying compact: ${safeErrText(e)}`
        );
      }
    } else {
      console.warn("[explain] MAX_TOKENS — retrying with compact prompt");
    }

    const compactPrompt = `${EXPLAIN_SYSTEM}

Your previous structured reply was too long or invalid JSON. Reply with ONE compact JSON object only (same keys as before). Each string value max 500 characters. Escape every " inside strings as \\". No markdown.

Review comment: ${JSON.stringify(input.comment)}
File: ${input.filePath}
Language: ${input.language}
Diff excerpt:
${clipForPrompt("diff", input.diffHunk, 3500)}`;

    result = await runGenerate(compactPrompt);
    responseText = result.text ?? "";
    if (!responseText) {
      throw new Error("Empty response after compact explain retry");
    }
    return tryParse(responseText);
  } catch (error) {
    logGeminiFailure("Error generating explanation", error);
    throw new Error(
      `Failed to generate explanation from Gemini: ${safeErrText(error)}`
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
  const ai = getGoogleGenAI();

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
      ai.models.generateContent({
        model: GEMINI_GENERATION_MODEL,
        contents: prompt,
        config: structuredJsonGenerationConfig,
      })
    );

    const responseText = result.text;

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

    return parseModelJson(responseText, narrativeSchema);
  } catch (error) {
    logGeminiFailure("Error generating narrative", error);
    throw new Error(
      `Failed to generate narrative from Gemini: ${safeErrText(error)}`
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
 * Default order for @google/genai embedContent (see https://ai.google.dev/gemini-api/docs/embeddings).
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
  const taskType = role === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
  const ai = getGoogleGenAI();

  for (const modelName of embeddingModelCandidates()) {
    try {
      const config: {
        taskType: string;
        outputDimensionality?: number;
      } = { taskType };
      if (!/embedding-001$/i.test(modelName) && !modelName.includes("embedding-001")) {
        config.outputDimensionality = 768;
      }
      const res = await ai.models.embedContent({
        model: modelName,
        contents: chunk,
        config,
      });
      const values = res.embeddings?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) return values;
    } catch (err) {
      if (isGeminiRateLimitError(err)) throw err;
      console.warn(
        `getEmbedding model ${modelName} failed:`,
        err instanceof Error ? err.message : err
      );
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

  const ai = getGoogleGenAI();
  const prompt = `You translate English into natural Hindi suitable for text-to-speech.

Rules:
- Output ONLY Hindi in Devanagari script. No English, no quotes, no preamble, no bullet points.
- Keep technical terms (file paths, PR numbers, repo names) in Latin script when clearer.
- Stay concise; do not add facts not in the source.

English to translate:

${english}`;

  const result = await withGemini429Retry(() =>
    ai.models.generateContent({
      model: GEMINI_GENERATION_MODEL,
      contents: prompt,
    })
  );

  const text = result.text?.trim();
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

  const ai = getGoogleGenAI();
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
    ai.models.generateContent({
      model: GEMINI_GENERATION_MODEL,
      contents: prompt,
    })
  );

  const text = result.text?.trim();
  if (!text) throw new Error("Empty voice answer from model");
  return text.length > 4000 ? `${text.slice(0, 3999)}…` : text;
}
