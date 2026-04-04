/**
 * GitLore server (Mongo + ingest + chat) — URL helpers for the extension.
 */

/**
 * @param {string} url
 * @returns {string}
 */
export function normalizeBackendBase(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * @param {string} urlString
 * @returns {{ owner: string, name: string, repoFullName: string } | null}
 */
export function parseGithubRepoFromUrl(urlString) {
  try {
    const u = new URL(urlString);
    const host = u.hostname.toLowerCase();
    if (host !== "github.com" && !host.endsWith(".github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const name = parts[1].replace(/\.git$/, "");
    if (
      ["settings", "orgs", "apps", "topics", "sponsors", "explore"].includes(owner) ||
      name.includes(":")
    ) {
      return null;
    }
    return { owner, name, repoFullName: `${owner}/${name}` };
  } catch {
    return null;
  }
}
