/**
 * Review comment auto-fix: multi-signal classification + tiered fix generation (ArmorIQ-style transparency).
 */
import type { Db } from "mongodb";
import type { PullReviewCommentRest } from "./githubRest";
import {
  GithubRestError,
  getRepoFileBlobAtRef,
  getPullRequestRest,
  listPullRequestReviewCommentsRest,
  createGitRef,
  updateGitRef,
  updateRepoFileContents,
  createPullRequestRest,
} from "./githubRest";
import { findPattern } from "./mongo";
import { matchAntiPattern, generateMinimalFix } from "./gemini";

export type AutoFixClassification = "AUTO_FIXABLE" | "SUGGEST_FIX" | "MANUAL_REVIEW" | "COMPLEX";

export type AutoFixSignals = {
  text_pattern: { category: string; score: number };
  suggestion_block: { found: boolean; score: number; preview?: string };
  diff_scope: { estimated_lines: number; score: number };
  reviewer_type: { is_bot: boolean; score: number };
  pattern_match: { pattern: string | null; score: number };
};

export type AutoFixFixPayload = {
  tier: 1 | 2 | 3;
  tier_label: "extracted" | "rule-based" | "ai-generated";
  original_code: string;
  fixed_code: string;
  description: string;
  validation: { passed: boolean; warnings: string[] };
};

export type ClassifiedComment = {
  comment_id: number;
  path: string;
  line: number;
  author: string;
  body: string;
  classification: AutoFixClassification;
  score: number;
  signals: AutoFixSignals;
  fix: AutoFixFixPayload | null;
};

const W_A = 0.25;
const W_B = 0.3;
const W_C = 0.2;
const W_D = 0.1;
const W_E = 0.15;

function extractCommentKeywords(comment: string): string[] {
  const lower = comment.toLowerCase().trim();
  const out = new Set<string>();
  if (lower.includes("n+1")) {
    out.add("n+1");
    out.add("n plus one");
  }
  const tokens = lower.split(/[^a-z0-9+]+/).filter(Boolean);
  for (const t of tokens) out.add(t);
  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return [...out];
}

function sliceLines(text: string, line1: number, line2: number): string {
  const lines = text.split("\n");
  const start = Math.max(0, line1 - 1);
  const end = Math.min(lines.length, line2);
  return lines.slice(start, end).join("\n");
}

function replaceLineRange(full: string, startLine: number, endLine: number, newBlock: string): string {
  const lines = full.split("\n");
  const s = Math.max(0, startLine - 1);
  const e = Math.min(lines.length, endLine);
  const newLines = newBlock.split("\n");
  return [...lines.slice(0, s), ...newLines, ...lines.slice(e)].join("\n");
}

/** Lines in the merged tail that differ from prefix alignment (rough change size). */
function estimateChangedLineCount(before: string, after: string): number {
  const b = before.split("\n");
  const a = after.split("\n");
  let l = 0;
  const maxL = Math.min(b.length, a.length);
  while (l < maxL && b[l] === a[l]) l++;
  let rb = b.length - 1;
  let ra = a.length - 1;
  while (rb >= l && ra >= l && b[rb] === a[ra]) {
    rb--;
    ra--;
  }
  return Math.max(rb - l + 1, ra - l + 1, 0);
}

function bracketBalanceOk(snippet: string): boolean {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (const c of snippet) {
    if ("([{".includes(c)) stack.push(c);
    else if (")]}".includes(c)) {
      const open = stack.pop();
      if (!open || pairs[open] !== c) return false;
    }
  }
  return stack.length === 0;
}

export function validateFixPayload(
  filePath: string,
  commentPath: string,
  fullOriginal: string,
  fullFixed: string
): { passed: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (commentPath !== filePath && commentPath.replace(/^\//, "") !== filePath.replace(/^\//, "")) {
    warnings.push("Path mismatch (internal)");
    return { passed: false, warnings };
  }
  const changed = estimateChangedLineCount(fullOriginal, fullFixed);
  if (changed > 15) warnings.push(`Change spans ~${changed} lines (max 15)`);
  /* Full-file naive scan; if the original also fails, braces in strings/templates likely tripped
   * the heuristic — warn but do not fail. If original balanced and fixed does not, fail. */
  const origBal = bracketBalanceOk(fullOriginal);
  const fixedBal = bracketBalanceOk(fullFixed);
  let bracketOk = fixedBal;
  if (!fixedBal && !origBal) {
    bracketOk = true;
    warnings.push("Bracket balance heuristic inconclusive (original also fails naive check)");
  } else if (!fixedBal) {
    warnings.push("Bracket/brace balance check failed");
  }
  const passed = changed <= 15 && bracketOk;
  return { passed, warnings };
}

function parseSuggestionBlock(body: string): string | null {
  const m = body.match(/```suggestion\s*\n([\s\S]*?)```/i);
  if (m?.[1] != null) return m[1].replace(/\r\n/g, "\n").trimEnd();
  const cr = body.match(/####\s*Suggested change:\s*\n```(?:\w+)?\s*\n([\s\S]*?)```/i);
  if (cr?.[1] != null) return cr[1].replace(/\r\n/g, "\n").trimEnd();
  return null;
}

function signalA(body: string): { category: string; score: number } {
  const b = body.toLowerCase();
  const rules: Array<{ cat: string; test: (s: string) => boolean; score: number }> = [
    { cat: "SECURITY", test: (s) => /\bxss\b|injection|csrf|vulnerability|\bauth\b|credential/.test(s), score: 0 },
    { cat: "ARCHITECTURE", test: (s) => /\brefactor\b|redesign|split this|\bextract\b|too complex/.test(s), score: 0 },
    {
      cat: "QUESTION",
      test: (s) =>
        /\bwhy\b[^a-z]{0,6}\?/.test(s) ||
        s.includes("could you explain") ||
        s.includes("what about") ||
        (s.includes("?") && s.length < 120),
      score: 0,
    },
    { cat: "NITPICK", test: (s) => /^nit:|^nitpick|\bnit -\b|^style:|^minor:/m.test(s), score: 0.9 },
    { cat: "TYPO", test: (s) => /\btypo\b|spelling|misspell|wrong name/.test(s), score: 0.95 },
    {
      cat: "CLEANUP",
      test: (s) =>
        s.includes("console.log") ||
        s.includes("console.warn") ||
        s.includes("debugger") ||
        /\btodo\b|\bfixme\b|\bhack\b/.test(s),
      score: 0.9,
    },
    {
      cat: "UNUSED",
      test: (s) => /\bunused\b|dead code|remove this|not used|unnecessary/.test(s),
      score: 0.85,
    },
    {
      cat: "FORMATTING",
      test: (s) => /semicolon|trailing comma|whitespace|indentation|spacing/.test(s),
      score: 0.9,
    },
    {
      cat: "NAMING",
      test: (s) => /\brename\b|naming convention|camelcase|snake_case/.test(s),
      score: 0.7,
    },
    { cat: "IMPORT", test: (s) => /unused import|missing import|wrong import/.test(s), score: 0.8 },
    { cat: "TYPE", test: (s) => /type annotation|missing type|\bany type\b/.test(s), score: 0.6 },
  ];
  for (const r of rules) {
    if (r.test(b)) return { category: r.cat, score: r.score };
  }
  return { category: "NONE", score: 0.35 };
}

function countMinusLinesInHunk(hunk: string | null): number {
  if (!hunk) return 1;
  return hunk.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length || 1;
}

function signalC(estimatedLines: number): { estimated_lines: number; score: number } {
  let score = 0.1;
  if (estimatedLines <= 3) score = 1.0;
  else if (estimatedLines <= 8) score = 0.7;
  else if (estimatedLines <= 15) score = 0.4;
  return { estimated_lines: estimatedLines, score };
}

const BOT_SUBSTR = ["[bot]", "coderabbitai", "sourcery-ai", "sonarcloud", "codeclimate", "deepsource-autofix"];

function isLikelyBot(login: string | null): boolean {
  if (!login) return false;
  const l = login.toLowerCase();
  return BOT_SUBSTR.some((b) => l.includes(b.replace("[bot]", "")) || l.endsWith("[bot]"));
}

function signalD(login: string | null, hasSuggestion: boolean): { is_bot: boolean; score: number } {
  const bot = isLikelyBot(login);
  let score = 0.5;
  if (bot && hasSuggestion) score = 1.0;
  else if (bot) score = 0.7;
  else if (hasSuggestion) score = 0.9;
  return { is_bot: bot, score };
}

function languageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
  };
  return map[ext] || ext || "unknown";
}

async function signalE(
  db: Db,
  diffHunk: string | null,
  body: string,
  filePath: string
): Promise<{ pattern: string | null; score: number }> {
  const kw = extractCommentKeywords(body);
  const mongoDoc = await findPattern(kw);
  if (mongoDoc && typeof (mongoDoc as { pattern_name?: string }).pattern_name === "string") {
    return { pattern: (mongoDoc as { pattern_name: string }).pattern_name, score: 1.0 };
  }
  const lang = languageFromPath(filePath);
  let m = diffHunk ? matchAntiPattern(diffHunk, lang) : null;
  if (!m) {
    const codeLines = (diffHunk || "")
      .split("\n")
      .filter((line) => line.startsWith("+") || line.startsWith("-"))
      .map((line) => line.slice(1))
      .join("\n");
    if (codeLines) m = matchAntiPattern(codeLines, lang);
  }
  if (m) return { pattern: m.pattern, score: 0.5 };
  return { pattern: null, score: 0 };
}

function scoreToClassification(score: number): AutoFixClassification {
  if (score > 0.8) return "AUTO_FIXABLE";
  if (score >= 0.5) return "SUGGEST_FIX";
  if (score >= 0.25) return "MANUAL_REVIEW";
  return "COMPLEX";
}

function tier1ApplySuggestion(
  full: string,
  line: number,
  suggestion: string,
  diffHunk: string | null
): { original: string; fixed: string } | null {
  if (line < 1) return null;
  const nRemove = Math.max(1, Math.min(countMinusLinesInHunk(diffHunk), 20));
  const sugLines = suggestion.split("\n");
  const endLine = line;
  const startLine = Math.max(1, endLine - nRemove + 1);
  const original = sliceLines(full, startLine, endLine);
  const fixed = replaceLineRange(full, startLine, endLine, suggestion);
  return { original, fixed };
}

function tier2RuleBased(
  full: string,
  line: number,
  category: string,
  bodyLower: string
): { original: string; fixed: string; description: string } | null {
  if (line < 1) return null;
  const lines = full.split("\n");
  const idx = line - 1;
  const windowStart = Math.max(0, idx - 3);
  const windowEnd = Math.min(lines.length, idx + 4);

  if (category === "CLEANUP" && /console\.(log|warn|error)/.test(bodyLower)) {
    for (let i = windowStart; i < windowEnd; i++) {
      if (/console\.(log|warn|error)\s*\(/.test(lines[i])) {
        const original = lines[i];
        const next = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
        return { original, fixed: next, description: "Removed console.* call (rule)" };
      }
    }
  }
  if (category === "CLEANUP" && bodyLower.includes("debugger")) {
    for (let i = windowStart; i < windowEnd; i++) {
      if (/^\s*debugger\s*;?\s*$/.test(lines[i])) {
        const original = lines[i];
        const next = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
        return { original, fixed: next, description: "Removed debugger (rule)" };
      }
    }
  }
  if (category === "FORMATTING" && bodyLower.includes("semicolon")) {
    const cur = lines[idx] ?? "";
    if (!cur.trim()) return null;
    const original = cur;
    const trimmed = cur.trimEnd();
    const nextLine = trimmed.endsWith(";") ? trimmed.slice(0, -1) : `${trimmed};`;
    const pad = cur.match(/^\s*/)?.[0] ?? "";
    const rest = nextLine.trimStart();
    lines[idx] = pad + rest;
    return { original, fixed: lines.join("\n"), description: "Toggled semicolon (rule)" };
  }
  return null;
}

async function tryTier3(
  comment: PullReviewCommentRest,
  fullFile: string,
  line: number,
  filePath: string
): Promise<{ original: string; fixed: string; description: string } | null> {
  const pad = 15;
  const start = Math.max(1, line - pad);
  const end = Math.min(fullFile.split("\n").length, line + pad);
  const region = sliceLines(fullFile, start, end);
  const res = await generateMinimalFix({
    comment: comment.body,
    filePath,
    language: languageFromPath(filePath),
    regionStartLine: start,
    regionEndLine: end,
    regionSource: region,
  });
  if (!res.ok) return null;
  const fixedFull = replaceLineRange(fullFile, start, end, res.newRegion);
  return { original: region, fixed: fixedFull, description: "Gemini minimal fix (Tier 3)" };
}

export async function classifyAndGenerateFix(
  db: Db,
  comment: PullReviewCommentRest,
  fullFileText: string | null,
  filePath: string
): Promise<ClassifiedComment> {
  const line = comment.line ?? 0;
  const body = comment.body || "";
  const sigA = signalA(body);
  const suggestion = parseSuggestionBlock(body);
  const sigB = {
    found: Boolean(suggestion),
    score: suggestion ? 1.0 : 0.2,
    preview: suggestion ? suggestion.slice(0, 200) : undefined,
  };
  const estLines = suggestion
    ? Math.max(suggestion.split("\n").length, countMinusLinesInHunk(comment.diff_hunk))
    : Math.min(5, countMinusLinesInHunk(comment.diff_hunk));
  const sigC = signalC(estLines);
  const sigD = signalD(comment.user?.login ?? null, Boolean(suggestion));
  const sigE = await signalE(db, comment.diff_hunk, body, filePath);

  let aScore = sigA.score;
  if (["SECURITY", "ARCHITECTURE", "QUESTION"].includes(sigA.category)) aScore = 0;

  const combined =
    aScore * W_A + sigB.score * W_B + sigC.score * W_C + sigD.score * W_D + sigE.score * W_E;

  let classification = scoreToClassification(combined);
  if (["SECURITY", "ARCHITECTURE", "QUESTION"].includes(sigA.category)) {
    classification = "COMPLEX";
  }

  const signals: AutoFixSignals = {
    text_pattern: { category: sigA.category, score: sigA.score },
    suggestion_block: { found: sigB.found, score: sigB.score, preview: sigB.preview },
    diff_scope: { estimated_lines: sigC.estimated_lines, score: sigC.score },
    reviewer_type: sigD,
    pattern_match: sigE,
  };

  let fix: AutoFixFixPayload | null = null;

  if (classification !== "COMPLEX" && fullFileText && line >= 1) {
    let tier: 1 | 2 | 3 = 2;
    let tier_label: AutoFixFixPayload["tier_label"] = "rule-based";
    let original_code = "";
    let fixed_code = "";
    let description = "";

    if (suggestion) {
      const t1 = tier1ApplySuggestion(fullFileText, line, suggestion, comment.diff_hunk);
      if (t1) {
        tier = 1;
        tier_label = "extracted";
        original_code = t1.original;
        fixed_code = t1.fixed;
        description = "Applied GitHub suggestion block";
      }
    }

    if (!original_code && !fixed_code) {
      const t2 = tier2RuleBased(fullFileText, line, sigA.category, body.toLowerCase());
      if (t2) {
        tier = 2;
        tier_label = "rule-based";
        original_code = t2.original;
        fixed_code = t2.fixed;
        description = t2.description;
      }
    }

    if (!original_code && !fixed_code && (classification === "AUTO_FIXABLE" || classification === "SUGGEST_FIX")) {
      const t3 = await tryTier3(comment, fullFileText, line, filePath);
      if (t3) {
        tier = 3;
        tier_label = "ai-generated";
        original_code = t3.original;
        fixed_code = t3.fixed;
        description = t3.description;
      }
    }

    if (original_code || fixed_code) {
      const val = validateFixPayload(filePath, filePath, fullFileText, fixed_code);
      let cls = classification;
      if (!val.passed && cls === "AUTO_FIXABLE") cls = "SUGGEST_FIX";
      classification = cls;
      fix = {
        tier,
        tier_label,
        original_code: original_code || sliceLines(fullFileText, line, line),
        fixed_code,
        description,
        validation: val,
      };
    }
  }

  if (classification === "MANUAL_REVIEW" && !fix) {
    /* keep as manual */
  }

  return {
    comment_id: comment.id,
    path: comment.path,
    line,
    author: comment.user?.login ?? "unknown",
    body,
    classification,
    score: Math.round(combined * 1000) / 1000,
    signals,
    fix,
  };
}

export async function runAutoFixClassify(
  db: Db,
  token: string,
  owner: string,
  name: string,
  pullNumber: number
): Promise<{
  pr_number: number;
  total_comments: number;
  classified: ClassifiedComment[];
  summary: {
    auto_fixable: number;
    suggest_fix: number;
    manual_review: number;
    complex: number;
  };
}> {
  const pr = await getPullRequestRest(token, owner, name, pullNumber);
  const headSha = pr.head.sha;
  const comments = await listPullRequestReviewCommentsRest(token, owner, name, pullNumber);

  const fileCache = new Map<string, string | null>();
  async function loadFile(path: string): Promise<string | null> {
    const key = `${path}:${headSha}`;
    if (fileCache.has(key)) return fileCache.get(key)!;
    try {
      const blob = await getRepoFileBlobAtRef(token, owner, name, path, headSha);
      fileCache.set(key, blob.text);
      return blob.text;
    } catch {
      fileCache.set(key, null);
      return null;
    }
  }

  const classified: ClassifiedComment[] = [];
  for (const c of comments) {
    const text = await loadFile(c.path);
    classified.push(await classifyAndGenerateFix(db, c, text, c.path));
  }

  const summary = {
    auto_fixable: classified.filter((x) => x.classification === "AUTO_FIXABLE").length,
    suggest_fix: classified.filter((x) => x.classification === "SUGGEST_FIX").length,
    manual_review: classified.filter((x) => x.classification === "MANUAL_REVIEW").length,
    complex: classified.filter((x) => x.classification === "COMPLEX").length,
  };

  return {
    pr_number: pullNumber,
    total_comments: comments.length,
    classified,
    summary,
  };
}

function summarizeBody(body: string): string {
  const one = body.split("\n")[0]?.trim() || body;
  return one.length > 72 ? `${one.slice(0, 70)}…` : one;
}

/** Sort fixes so lower line numbers are applied last (line numbers stay valid longer). */
function sortFixesForApply(items: ClassifiedComment[]): ClassifiedComment[] {
  return [...items].sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return b.line - a.line;
  });
}

export async function runAutoFixApply(
  db: Db,
  token: string,
  owner: string,
  name: string,
  pullNumber: number,
  commentIds: number[],
  branchName?: string
): Promise<{
  status: string;
  branch: string;
  draft_pr: { number: number; url: string; title: string };
  applied: Array<{ comment_id: number; commit_sha: string; file: string; tier: number }>;
  failed: Array<{ comment_id: number; reason: string }>;
}> {
  const pr = await getPullRequestRest(token, owner, name, pullNumber);
  const headSha = pr.head.sha;
  const baseBranch = pr.head.ref;
  const branch = (branchName?.trim() || `gitlore/auto-fix/${pullNumber}`).replace(/^refs\/heads\//, "");

  const classifiedFull = await runAutoFixClassify(db, token, owner, name, pullNumber);
  const selected = classifiedFull.classified.filter((c) => commentIds.includes(c.comment_id));
  const failed: Array<{ comment_id: number; reason: string }> = [];

  for (const id of commentIds) {
    const c = selected.find((x) => x.comment_id === id);
    if (!c) failed.push({ comment_id: id, reason: "Comment not found on PR" });
    else if (!c.fix) failed.push({ comment_id: id, reason: "No fix generated" });
    else if (!c.fix.validation.passed) failed.push({ comment_id: id, reason: c.fix.validation.warnings.join("; ") || "Validation failed" });
  }

  const withFix = selected.filter((c) => c.fix && c.fix.fixed_code && c.fix.validation.passed);
  if (withFix.length === 0) {
    throw new Error(
      failed.length ? failed.map((f) => `${f.comment_id}: ${f.reason}`).join(" | ") : "No valid fixes to apply"
    );
  }

  try {
    await createGitRef(token, owner, name, branch, headSha);
  } catch (e) {
    const exists =
      (e instanceof GithubRestError && e.status === 422) ||
      /already exists|reference already exists/i.test(e instanceof Error ? e.message : String(e));
    if (!exists) throw e;
    /* Branch from a prior run: reset tip to current PR head so blobs at headSha match commits. */
    await updateGitRef(token, owner, name, branch, headSha, true);
  }

  const applied: Array<{ comment_id: number; commit_sha: string; file: string; tier: number }> = [];
  const sorted = sortFixesForApply(withFix);
  /** Read file content at PR head first, then at branch tip after each commit. */
  let fileRef = headSha;

  const allComments = await listPullRequestReviewCommentsRest(token, owner, name, pullNumber);

  for (const item of sorted) {
    const raw = allComments.find((x) => x.id === item.comment_id);
    if (!raw) {
      failed.push({ comment_id: item.comment_id, reason: "Review comment removed from PR" });
      continue;
    }
    const blob = await getRepoFileBlobAtRef(token, owner, name, raw.path, fileRef);
    if (!blob.text || !blob.sha) {
      failed.push({ comment_id: item.comment_id, reason: "Could not read file at current ref" });
      continue;
    }
    const row = await classifyAndGenerateFix(db, raw, blob.text, raw.path);
    if (!row.fix?.fixed_code || !row.fix.validation.passed) {
      failed.push({
        comment_id: item.comment_id,
        reason: row.fix?.validation.warnings.join("; ") || "Re-validation failed on target branch",
      });
      continue;
    }
    const msg = `fix: ${summarizeBody(raw.body)} on ${raw.path}:L${row.line} [tier-${row.fix.tier}-${row.fix.tier_label}]`;
    const res = await updateRepoFileContents(
      token,
      owner,
      name,
      raw.path,
      branch,
      msg,
      row.fix.fixed_code,
      blob.sha
    );
    const commitSha = (res as { commit?: { sha?: string } })?.commit?.sha ?? "";
    applied.push({ comment_id: item.comment_id, commit_sha: commitSha, file: raw.path, tier: row.fix.tier });
    fileRef = branch;
  }

  if (applied.length === 0) {
    throw new Error(failed.map((f) => `${f.comment_id}: ${f.reason}`).join(" | ") || "No commits applied");
  }

  const title = `GitLore Auto-Fix: ${applied.length} review comment(s) for PR #${pullNumber}`;
  const bodyMd = `## Auto-resolved review comments\n\n| # | File | Line | Tier | Comment |\n|---|------|------|------|---------|\n${applied
    .map((a, i) => {
      const row = allComments.find((w) => w.id === a.comment_id);
      const summ = row ? summarizeBody(row.body) : "";
      const line = row?.line ?? "";
      return `| ${i + 1} | ${a.file} | ${line} | T${a.tier} | ${summ.replace(/\|/g, "\\|")} |`;
    })
    .join("\n")}\n\n---\n_Generated by GitLore ReviewLens Auto-Fix (draft — review before merge)._`;

  const draft = await createPullRequestRest(token, owner, name, {
    title,
    body: bodyMd,
    head: branch,
    base: baseBranch,
    draft: true,
  });

  return {
    status: "success",
    branch,
    draft_pr: { number: draft.number, url: draft.html_url, title: draft.title },
    applied,
    failed,
  };
}
