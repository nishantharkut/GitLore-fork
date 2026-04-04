import type { Db } from "mongodb";
import { listRepoPathsLimited, getRepoFileContent } from "./githubRest";

export const PATTERN_SCAN_VERSION = 1;
const CACHE_MS = 60 * 60 * 1000;
const MAX_SCAN_FILES = 50;
const MAX_FILE_BYTES = 50 * 1024;

function normalizeRepoFull(owner: string, name: string) {
  return `${owner}/${name}`.toLowerCase().replace(/^\/+|\/+$/g, "");
}

/** Cache partition: explicit branch ref or default-branch scans. */
function branchCacheKey(branchHint: string) {
  const t = branchHint.trim().toLowerCase();
  return t || "__default__";
}

function skipPath(p: string): boolean {
  const x = p.replace(/\\/g, "/").toLowerCase();
  if (!x) return true;
  const bad = [
    "node_modules/",
    "vendor/",
    "dist/",
    "build/",
    ".git/",
    "coverage/",
    "__pycache__/",
    "/target/",
    ".next/",
    ".turbo/",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    ".min.js",
    ".bundle.js",
    ".map",
  ];
  return bad.some((b) => x.includes(b));
}

type Sev = "critical" | "high" | "medium" | "low";
type Cat = "security" | "performance" | "reliability" | "maintainability";

type Rule = {
  id: string;
  name: string;
  severity: Sev;
  category: Cat;
  matchFile: (path: string) => boolean;
  /** Return snippet to show, or null */
  matchLine: (line: string) => string | null;
};

function snippetAround(line: string, needle: string, maxLen = 72): string {
  const i = line.indexOf(needle);
  const start = i >= 0 ? Math.max(0, i - 12) : 0;
  return line.slice(start, start + maxLen).trim();
}

const RULES: Rule[] = [
  {
    id: "sql-injection",
    name: "SQL injection risk (string-built query)",
    severity: "critical",
    category: "security",
    matchFile: (p) => /\.(py|js|ts|tsx|jsx|java)$/i.test(p),
    matchLine: (line) => {
      if (!/(SELECT|INSERT|UPDATE|DELETE|DROP)\b/i.test(line)) return null;
      if (/f["']|%\(|\.format\s*\(|["']\s*\+/.test(line)) {
        const m = line.match(/f["']|%\(|\.format\s*\(|["']\s*\+/)?.[0];
        return m ? snippetAround(line, m) : line.slice(0, 72);
      }
      return null;
    },
  },
  {
    id: "hardcoded-secret",
    name: "Hardcoded secret / credential",
    severity: "critical",
    category: "security",
    matchFile: (p) => /\.(py|js|ts|tsx|jsx|java|go|env)$/i.test(p) || p.endsWith(".env"),
    matchLine: (line) => {
      const re =
        /(?:api[_-]?key|apikey|secret|password|token)\s*[=:]\s*["'][^"'\s]{8,}["']/i;
      const m = line.match(re);
      return m ? snippetAround(line, m[0]) : null;
    },
  },
  {
    id: "innerhtml-xss",
    name: "DOM XSS risk (innerHTML)",
    severity: "critical",
    category: "security",
    matchFile: (p) => /\.(js|ts|tsx|jsx)$/i.test(p),
    matchLine: (line) => (/\.innerHTML\s*=/.test(line) ? snippetAround(line, "innerHTML") : null),
  },
  {
    id: "command-injection",
    name: "Command execution (os.system / shell)",
    severity: "critical",
    category: "security",
    matchFile: (p) => p.endsWith(".py"),
    matchLine: (line) => {
      if (!/(os\.system|subprocess\.call)\s*\(/i.test(line)) return null;
      return snippetAround(line, "os.") || line.slice(0, 72);
    },
  },
  {
    id: "eval-usage",
    name: "eval() usage",
    severity: "high",
    category: "security",
    matchFile: (p) => /\.(py|js|ts|tsx|jsx)$/i.test(p),
    matchLine: (line) => (/\beval\s*\(/.test(line) ? snippetAround(line, "eval") : null),
  },
  {
    id: "console-log",
    name: "console.log (debug noise)",
    severity: "low",
    category: "maintainability",
    matchFile: (p) => /\.(js|ts|tsx|jsx)$/i.test(p),
    matchLine: (line) => (/console\.log\s*\(/.test(line) ? snippetAround(line, "console") : null),
  },
  {
    id: "todo-fixme",
    name: "TODO / FIXME / HACK marker",
    severity: "low",
    category: "maintainability",
    matchFile: (p) =>
      /\.(py|js|ts|tsx|jsx|go|java|rs|rb|php|md|yaml|yml|vue|svelte)$/i.test(p),
    matchLine: (line) =>
      /(?:TODO|FIXME|HACK|XXX)\b/.test(line) ? line.slice(0, 72).trim() : null,
  },
  {
    id: "bare-except",
    name: "Bare except (Python)",
    severity: "medium",
    category: "reliability",
    matchFile: (p) => p.endsWith(".py"),
    matchLine: (line) => (/^\s*except\s*:\s*$/.test(line) || /\bexcept\s*:\s*#/.test(line) ? line.trim() : null),
  },
  {
    id: "magic-numbers",
    name: "Magic number in condition",
    severity: "low",
    category: "maintainability",
    matchFile: (p) => /\.(js|ts|tsx|jsx|py)$/i.test(p),
    matchLine: (line) =>
      /(?:if|return|elif|while)\s*\([^)]*\d{3,}\b/.test(line) ||
      /(?:===|!==|==|!=|>|<)\s*\d{3,}\b/.test(line)
        ? line.slice(0, 72).trim()
        : null,
  },
];

export type PatternScanMatch = { file: string; line: number; snippet: string };

export type PatternScanResultRow = {
  patternId: string;
  name: string;
  severity: Sev;
  category: Cat;
  matchCount: number;
  matches: PatternScanMatch[];
};

export type PatternScanApiResponse = {
  scannedAt: string;
  fileCount: number;
  cached: boolean;
  branch: string;
  patterns: PatternScanResultRow[];
};

async function runScan(
  token: string,
  owner: string,
  repo: string,
  refHint: string
): Promise<{ branch: string; fileCount: number; patterns: PatternScanResultRow[] }> {
  const { paths, defaultBranch, truncated } = await listRepoPathsLimited(
    token,
    owner,
    repo,
    refHint || "",
    8000
  );
  const branch = refHint.trim() || defaultBranch;

  const pool = paths
    .filter((p) => !skipPath(p))
    .filter((p) => RULES.some((r) => r.matchFile(p)));

  const selected = (truncated ? pool : pool).slice(0, MAX_SCAN_FILES);

  const hitsMap = new Map<string, PatternScanMatch[]>();
  for (const r of RULES) hitsMap.set(r.id, []);

  let fileCount = 0;
  for (const filePath of selected) {
    const { text, isBinary, size } = await getRepoFileContent(token, owner, repo, filePath, branch);
    fileCount++;
    if (isBinary || text == null || size > MAX_FILE_BYTES) continue;

    const lines = text.split("\n");
    const rulesHere = RULES.filter((r) => r.matchFile(filePath));
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      for (const rule of rulesHere) {
        const hit = rule.matchLine(line);
        if (hit) {
          const list = hitsMap.get(rule.id)!;
          if (list.length < 50) {
            list.push({ file: filePath, line: li + 1, snippet: hit.slice(0, 120) });
          }
        }
      }
    }
  }

  const sevOrder: Record<Sev, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const catOrder: Record<Cat, number> = {
    security: 0,
    performance: 1,
    reliability: 2,
    maintainability: 3,
  };

  const patterns: PatternScanResultRow[] = [];
  for (const rule of RULES) {
    const matches = hitsMap.get(rule.id)!;
    if (matches.length === 0) continue;
    patterns.push({
      patternId: rule.id,
      name: rule.name,
      severity: rule.severity,
      category: rule.category,
      matchCount: matches.length,
      matches: matches.slice(0, 40),
    });
  }

  patterns.sort((a, b) => {
    const s = sevOrder[a.severity] - sevOrder[b.severity];
    if (s !== 0) return s;
    const c = catOrder[a.category] - catOrder[b.category];
    if (c !== 0) return c;
    return a.name.localeCompare(b.name);
  });

  return { branch, fileCount, patterns };
}

export async function getOrScanRepoPatterns(
  db: Db,
  token: string,
  owner: string,
  repo: string,
  branchHint: string,
  forceRefresh = false
): Promise<PatternScanApiResponse> {
  const repoFull = normalizeRepoFull(owner, repo);
  const bKey = branchCacheKey(branchHint);
  const coll = db.collection("pattern_scans");

  const cached = forceRefresh
    ? null
    : await coll.findOne({
        repo: repoFull,
        scan_version: PATTERN_SCAN_VERSION,
        branch_query: bKey,
      });

  if (
    !forceRefresh &&
    cached &&
    cached.scanned_at instanceof Date &&
    Date.now() - cached.scanned_at.getTime() < CACHE_MS
  ) {
    return {
      scannedAt: cached.scanned_at.toISOString(),
      fileCount: typeof cached.file_count === "number" ? cached.file_count : 0,
      cached: true,
      branch: String(cached.branch || ""),
      patterns: Array.isArray(cached.patterns) ? cached.patterns : [],
    };
  }

  const { branch, fileCount, patterns } = await runScan(token, owner, repo, branchHint);
  const scannedAt = new Date();

  await coll.updateOne(
    { repo: repoFull, scan_version: PATTERN_SCAN_VERSION, branch_query: bKey },
    {
      $set: {
        repo: repoFull,
        scan_version: PATTERN_SCAN_VERSION,
        branch_query: bKey,
        scanned_at: scannedAt,
        branch,
        file_count: fileCount,
        patterns,
      },
    },
    { upsert: true }
  );

  return {
    scannedAt: scannedAt.toISOString(),
    fileCount,
    cached: false,
    branch,
    patterns,
  };
}
