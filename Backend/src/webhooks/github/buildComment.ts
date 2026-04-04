export const GITLORE_PR_INTEL_MARKER = "<!-- gitlore-pr-intelligence -->";

export type RelatedOpenPrRow = {
  number: number;
  title: string;
  overlappingFiles: string[];
  overlapCount: number;
};

export type KgCommentRow = { score: number; one_liner: string };

function safeMdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 220);
}

function scoreToPercent(score: number): number {
  if (score <= 1 && score >= 0) return Math.floor(score * 100);
  return Math.min(100, Math.floor(score));
}

export function buildPrIntelligenceCommentMarkdown(
  repoFull: string,
  related: RelatedOpenPrRow[],
  kg: KgCommentRow[]
): string {
  const lines: string[] = [];
  lines.push(GITLORE_PR_INTEL_MARKER);
  lines.push("## GitLore PR Intelligence");
  lines.push("");

  if (related.length > 0) {
    lines.push("### Related Open PRs");
    lines.push("");
    lines.push("These open PRs touch some of the same files:");
    lines.push("");
    lines.push("| PR | Shared Files | Files | Title |");
    lines.push("|---|---|---|---|");
    const base = `https://github.com/${repoFull}`;
    for (const row of related) {
      const prLink = `[#${row.number}](${base}/pull/${row.number})`;
      const files = row.overlappingFiles
        .slice(0, 3)
        .map((f) => `\`${safeMdCell(f)}\``)
        .join(", ");
      lines.push(
        `| ${prLink} | ${row.overlapCount} | ${files} | ${safeMdCell(row.title)} |`
      );
    }
    lines.push("");
  }

  if (kg.length > 0) {
    lines.push("### Past Decisions (Knowledge Graph)");
    lines.push("");
    lines.push("Related decisions from your team's PR history:");
    lines.push("");
    lines.push("| Match | Decision |");
    lines.push("|---|---|");
    for (const k of kg) {
      const pct = scoreToPercent(k.score);
      lines.push(`| ${pct}% | ${safeMdCell(k.one_liner)} |`);
    }
    lines.push("");
  }

  if (related.length === 0 && kg.length === 0) {
    lines.push("No duplicate PRs or related past decisions found.");
    lines.push("");
  }

  lines.push("---");
  lines.push("*Automated by [GitLore](https://github.com/Codealpha07/GitLore)*");
  return lines.join("\n");
}
