/**
 * Builds a structured graph (nodes + edges) from ingested knowledge_nodes for the Overview SVG.
 * Coordinates are in a fixed viewBox for predictable scaling.
 */

export type LayoutNodeKind =
  | "repository"
  | "topic"
  | "pull_request"
  | "issue"
  | "contributor"
  | "merge_commit";

export type LayoutEdgeKind =
  | "repo_pr"
  | "pr_topic"
  | "pr_issue"
  | "contrib_pr"
  | "pr_merge"
  /** Same closing issue referenced by multiple PRs */
  | "pr_pr_issue"
  /** Adjacent in merge-time order (newest-first list) */
  | "pr_pr_time";

export type LayoutNode = {
  id: string;
  kind: LayoutNodeKind;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  r?: number;
  color: string;
  href?: string;
  prType?: string;
};

export type LayoutEdge = {
  from: string;
  to: string;
  kind: LayoutEdgeKind;
};

const TYPE_COLOR: Record<string, string> = {
  feature: "#60a5fa",
  bugfix: "#f87171",
  refactor: "#34d399",
  architecture: "#a78bfa",
  security: "#fb923c",
  performance: "#fbbf24",
  documentation: "#9ca3af",
  other: "#6b7280",
};

type LinkedIssue = { number: number; title?: string; url?: string };
type MergeCommit = { oid?: string; short?: string; url?: string };

function normalizePrType(raw: unknown): string {
  const s = String(raw || "other")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const aliases: Record<string, string> = {
    bug_fix: "bugfix",
    bug: "bugfix",
    docs: "documentation",
    doc: "documentation",
    perf: "performance",
    arch: "architecture",
  };
  const k = aliases[s] || s;
  return Object.prototype.hasOwnProperty.call(TYPE_COLOR, k) ? k : "other";
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function topicSlug(t: string): string {
  return String(t)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function buildKnowledgeLayout(
  repoFull: string,
  owner: string,
  name: string,
  prDocs: Array<Record<string, unknown>>,
  maxPrs = 36
): { viewBox: { w: number; h: number }; nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const W = 1680;
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  if (!prDocs.length) {
    return { viewBox: { w: W, h: 720 }, nodes: [], edges: [] };
  }

  const sorted = [...prDocs].sort((a, b) => {
    const ta = a.merged_at ? new Date(String(a.merged_at)).getTime() : 0;
    const tb = b.merged_at ? new Date(String(b.merged_at)).getTime() : 0;
    return tb - ta;
  });
  const slice = sorted.slice(0, maxPrs);
  const n = slice.length;

  const repoId = "node-repo";
  const repoUrl = `https://github.com/${owner}/${name}`;

  const prAreaLeft = 56;
  const prAreaRight = W - 56;
  const prAreaWidth = prAreaRight - prAreaLeft;

  const cols = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(n * 1.35))));
  const cellW = prAreaWidth / cols;
  const cellH = 102;
  const prR = 24;

  const issueRowH = 56;
  const bottomPad = 72;

  const contributorLogins = new Set<string>();
  for (const pr of slice) {
    const a = String(pr.pr_author || "").trim();
    if (a && a !== "unknown") contributorLogins.add(a);
  }
  const contribListSorted = [...contributorLogins].sort((a, b) => a.localeCompare(b)).slice(0, 18);

  nodes.push({
    id: repoId,
    kind: "repository",
    label: repoFull,
    sublabel: "Repository",
    x: W / 2,
    y: 64,
    r: 40,
    color: "#C9A84C",
    href: repoUrl,
  });

  /** Themes from Gemini ingest (`topics` on each PR) — same signals the chat vector layer uses. */
  const topicCounts = new Map<string, string>();
  for (const pr of slice) {
    const topics = (pr.topics as string[] | undefined) || [];
    for (const raw of topics) {
      const key = String(raw || "")
        .trim()
        .toLowerCase()
        .slice(0, 48);
      if (!key) continue;
      if (!topicCounts.has(key)) topicCounts.set(key, String(raw).trim().slice(0, 48));
    }
  }
  const rankedTopics = [...topicCounts.entries()]
    .sort((a, b) => {
      const ca = slice.filter((p) =>
        ((p.topics as string[] | undefined) || []).some((t) => String(t).trim().toLowerCase() === a[0])
      ).length;
      const cb = slice.filter((p) =>
        ((p.topics as string[] | undefined) || []).some((t) => String(t).trim().toLowerCase() === b[0])
      ).length;
      return cb - ca || a[0].localeCompare(b[0]);
    })
    .slice(0, 14);

  const topicBandY = 124;
  const topicNodeIds = new Map<string, string>();
  if (rankedTopics.length) {
    const tw = W - 160;
    const step = tw / Math.max(rankedTopics.length, 1);
    for (let ti = 0; ti < rankedTopics.length; ti++) {
      const [normKey, displayLabel] = rankedTopics[ti];
      const slug = topicSlug(normKey) || `t${ti}`;
      const tid = `node-topic-${ti}-${slug}`;
      topicNodeIds.set(normKey, tid);
      const x = 80 + (ti + 0.5) * step;
      nodes.push({
        id: tid,
        kind: "topic",
        label: displayLabel.length > 22 ? `${displayLabel.slice(0, 20)}…` : displayLabel,
        sublabel: "Theme from ingested PRs",
        x: Math.min(W - 56, Math.max(56, x)),
        y: topicBandY,
        r: 14,
        color: "#a855f7",
        href: undefined,
      });
    }
  }

  const prStartY = rankedTopics.length ? 188 : 168;
  const rows = Math.ceil(n / cols);
  const prBandBottom = prStartY + rows * cellH + 32;
  const issueBandTop = prBandBottom + 40;

  const prIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const pr = slice[i];
    const num = Number(pr.pr_number);
    const prId = `node-pr-${num}`;
    prIds.push(prId);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = prAreaLeft + col * cellW + cellW / 2;
    const y = prStartY + row * cellH + cellH / 2;
    const ptype = normalizePrType(pr.type);
    const color = TYPE_COLOR[ptype] || TYPE_COLOR.other;
    const titleFull = String(pr.title || "").trim();
    nodes.push({
      id: prId,
      kind: "pull_request",
      label: `#${num}`,
      sublabel: titleFull ? titleFull.slice(0, 120) : undefined,
      x,
      y,
      r: prR,
      color,
      href: String(pr.pr_url || `${repoUrl}/pull/${num}`),
      prType: ptype,
    });
    edges.push({ from: repoId, to: prId, kind: "repo_pr" });

    const prTopics = ((pr.topics as string[] | undefined) || []).map((t) => String(t).trim().toLowerCase());
    for (const tk of prTopics) {
      const tid = topicNodeIds.get(tk);
      if (tid) edges.push({ from: prId, to: tid, kind: "pr_topic" });
    }

    const mc = pr.merge_commit as MergeCommit | undefined;
    if (mc?.url || mc?.oid) {
      const mid = `node-merge-${num}`;
      const mx = x + 58;
      const my = y + 36;
      nodes.push({
        id: mid,
        kind: "merge_commit",
        label: mc.short || (mc.oid ? String(mc.oid).slice(0, 7) : "merge"),
        sublabel: "Merge commit",
        x: mx,
        y: my,
        r: 12,
        color: "#64748b",
        href: mc.url,
      });
      edges.push({ from: prId, to: mid, kind: "pr_merge" });
    }
  }

  const issueMap = new Map<number, { title?: string; url?: string; prIds: string[] }>();
  for (const pr of slice) {
    const num = Number(pr.pr_number);
    const prId = `node-pr-${num}`;
    const linked = (pr.linked_issues as LinkedIssue[] | undefined) || [];
    for (const iss of linked) {
      const inum = Number(iss.number);
      if (!Number.isFinite(inum)) continue;
      const url = iss.url || `${repoUrl}/issues/${inum}`;
      const cur = issueMap.get(inum);
      if (cur) {
        if (!cur.prIds.includes(prId)) cur.prIds.push(prId);
      } else {
        issueMap.set(inum, { title: iss.title, url, prIds: [prId] });
      }
    }
  }

  const pairsWithSharedIssue = new Set<string>();
  for (const [, meta] of issueMap) {
    const ids = meta.prIds;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        pairsWithSharedIssue.add(pairKey(ids[i], ids[j]));
        edges.push({ from: ids[i], to: ids[j], kind: "pr_pr_issue" });
      }
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const a = prIds[i];
    const b = prIds[i + 1];
    if (!pairsWithSharedIssue.has(pairKey(a, b))) {
      edges.push({ from: a, to: b, kind: "pr_pr_time" });
    }
  }

  const issuesArr = [...issueMap.entries()].slice(0, 24);
  const issuesPerRow = 8;
  for (let issueIdx = 0; issueIdx < issuesArr.length; issueIdx++) {
    const [inum, meta] = issuesArr[issueIdx];
    const prNodes = meta.prIds
      .map((id) => nodes.find((nn) => nn.id === id))
      .filter(Boolean) as LayoutNode[];
    if (!prNodes.length) continue;
    const irow = Math.floor(issueIdx / issuesPerRow);
    const icol = issueIdx % issuesPerRow;
    const itemsThisRow = Math.min(issuesPerRow, issuesArr.length - irow * issuesPerRow);
    const ix = 120 + (icol + 0.5) * ((W - 240) / Math.max(itemsThisRow, 1));
    const iy = issueBandTop + irow * issueRowH;
    const iid = `node-issue-${inum}`;
    nodes.push({
      id: iid,
      kind: "issue",
      label: `#${inum}`,
      sublabel: (meta.title || "").slice(0, 36) || undefined,
      x: Math.max(72, Math.min(W - 72, ix)),
      y: iy,
      r: 18,
      color: "#22c55e",
      href: meta.url,
    });
    for (const prId of meta.prIds) {
      edges.push({ from: prId, to: iid, kind: "pr_issue" });
    }
  }

  const issueRows = issuesArr.length ? Math.ceil(issuesArr.length / issuesPerRow) : 0;
  const contributorBandTop = issueBandTop + issueRows * issueRowH + 48;
  const contribPerRow = 9;
  const contribRowH = 50;

  for (let i = 0; i < contribListSorted.length; i++) {
    const login = contribListSorted[i];
    const id = `node-contrib-${login}`;
    const row = Math.floor(i / contribPerRow);
    const col = i % contribPerRow;
    const itemsThisRow = Math.min(contribPerRow, contribListSorted.length - row * contribPerRow);
    const x = 72 + (col + 0.5) * ((W - 144) / Math.max(itemsThisRow, 1));
    const y = contributorBandTop + row * contribRowH;
    nodes.push({
      id,
      kind: "contributor",
      label: `@${login}`,
      sublabel: "Contributor",
      x,
      y,
      r: 20,
      color: "#818cf8",
      href: `https://github.com/${login}`,
    });
  }

  for (const pr of slice) {
    const num = Number(pr.pr_number);
    const prId = `node-pr-${num}`;
    const author = String(pr.pr_author || "").trim();
    if (author && author !== "unknown") {
      const cid = `node-contrib-${author}`;
      if (nodes.some((nn) => nn.id === cid)) {
        edges.push({ from: cid, to: prId, kind: "contrib_pr" });
      }
    }
  }

  const contribRows = contribListSorted.length ? Math.ceil(contribListSorted.length / contribPerRow) : 0;
  const H = Math.max(
    820,
    contributorBandTop + contribRows * contribRowH + bottomPad
  );

  return { viewBox: { w: W, h: H }, nodes, edges };
}
