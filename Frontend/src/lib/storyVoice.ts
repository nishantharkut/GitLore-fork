import type { InsightNarrative } from "@/lib/gitloreApi";

/** Short plain-text summary for the modal (read, not spoken). */
export function narrativeSummaryText(n: InsightNarrative, line: number | null, repoFull: string, filePath: string): string {
  const parts = [
    `Repository: ${repoFull}`,
    filePath ? `File: ${filePath}` : "",
    line != null ? `Line: ${line}` : "",
    "",
    n.oneLiner,
    "",
    n.context ? `Context: ${n.context}` : "",
    n.debate ? `Discussion: ${n.debate}` : "",
    n.decision ? `Decision: ${n.decision}` : "",
    n.impact ? `Impact: ${n.impact}` : "",
  ];
  return parts.filter(Boolean).join("\n").trim();
}

/** Full narration for TTS — natural English, length-capped. */
export function narrativeSpeechText(n: InsightNarrative): string {
  const chunks: string[] = [];
  chunks.push(n.oneLiner);
  if (n.context) chunks.push(`Context: ${n.context}`);
  if (n.debate) chunks.push(`Team discussion: ${n.debate}`);
  if (n.debateQuotes.length) {
    const q = n.debateQuotes
      .slice(0, 3)
      .map((x) => `${x.author} said: ${x.text}`)
      .join(" ");
    chunks.push(`Quotes: ${q}`);
  }
  if (n.decision) chunks.push(`The decision: ${n.decision}`);
  if (n.impact) chunks.push(`Impact: ${n.impact}`);
  let text = chunks.join("\n\n");
  const max = 4800;
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text;
}

function truncForSpeech(s: string, maxLen: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastPeriod = cut.lastIndexOf(". ");
  if (lastPeriod > maxLen * 0.45) return `${cut.slice(0, lastPeriod + 1).trim()}…`;
  return `${cut.trimEnd()}…`;
}

/**
 * Short script for listen mode — much shorter than the full narrative so playback stays digestible.
 * (Full detail stays in the Summary panel and voice agent.)
 */
export function narrativeSpeechBrief(n: InsightNarrative): string {
  const bits: string[] = [n.oneLiner];
  if (n.context) bits.push(truncForSpeech(n.context, 320));
  if (n.debate) bits.push(`Discussion: ${truncForSpeech(n.debate, 240)}`);
  else if (n.debateQuotes[0]?.text) {
    bits.push(`Comment: ${truncForSpeech(n.debateQuotes[0].text, 200)}`);
  }
  if (n.decision) bits.push(`Decision: ${truncForSpeech(n.decision, 220)}`);
  if (n.impact) bits.push(`Impact: ${truncForSpeech(n.impact, 200)}`);
  let out = bits.join(" ");
  if (out.length > 1200) out = `${out.slice(0, 1199)}…`;
  return out;
}

/** System-style prompt injected into the ElevenLabs agent for this session. */
export function narrativeAgentPrompt(n: InsightNarrative, meta: { repoFull: string; filePath: string; line: number | null }): string {
  const brief = narrativeSummaryText(n, meta.line, meta.repoFull, meta.filePath);
  return `You are a helpful senior engineer voice assistant. The user is looking at code in GitHub.

Here is the summarized story from Git blame, pull requests, and issues (ground truth for this session):

---
${brief}
---

Rules:
- Answer only about this story and this code context unless the user changes topic clearly.
- Be concise for voice; prefer short sentences.
- If you do not know, say so.
- The user may speak English or Hindi; respond in the same language they use.`;
}
