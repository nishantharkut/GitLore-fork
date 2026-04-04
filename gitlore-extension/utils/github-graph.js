/**
 * Build a lightweight file-tree knowledge graph from the GitHub Git Trees API (no backend).
 * @module github-graph
 */

/**
 * @param {string} owner
 * @param {string} name
 * @param {string} branch
 * @param {string} token GitHub OAuth token
 * @returns {Promise<{ nodes: object[], edges: object[], filePaths: string[], readmeSnippet: string }>}
 */
export async function buildRepoTreeGraph(owner, name, branch, token) {
  const hdr = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const br = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(branch)}`,
    { headers: hdr }
  );
  if (!br.ok) {
    const t = await br.text();
    throw new Error(t || `Branch "${branch}" not found (${br.status})`);
  }
  const bj = await br.json();
  const commitSha = bj.commit.sha;

  const comm = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits/${commitSha}`,
    { headers: hdr }
  );
  if (!comm.ok) throw new Error(`Could not read commit (${comm.status})`);
  const cj = await comm.json();
  const treeSha = cj.tree.sha;

  const treeRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${treeSha}?recursive=1`,
    { headers: hdr }
  );
  if (!treeRes.ok) throw new Error(`Could not load tree (${treeRes.status})`);
  const { tree } = await treeRes.json();
  const blobs = Array.isArray(tree)
    ? tree.filter((t) => t.type === "blob" && typeof t.path === "string")
    : [];

  const skip = /\.(png|jpg|jpeg|gif|webp|ico|svg|woff2?|ttf|eot|mp4|zip|gz|pdf)$/i;
  const files = blobs
    .map((b) => b.path)
    .filter((p) => p && !skip.test(p))
    .slice(0, 500);

  const { nodes, edges } = pathsToGraph(files, name);

  let readmeSnippet = "";
  try {
    const rm = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme`,
      { headers: { ...hdr, Accept: "application/vnd.github.raw" } }
    );
    if (rm.ok) {
      const raw = await rm.text();
      readmeSnippet = raw.slice(0, 12000);
    }
  } catch {
    /* no readme */
  }

  return { nodes, edges, filePaths: files, readmeSnippet };
}

/**
 * @param {string[]} filePaths
 * @param {string} repoLabel
 */
function pathsToGraph(filePaths, repoLabel) {
  /** @type {Map<string, string>} path -> node id */
  const dirIds = new Map();
  const rootId = "dir:";
  dirIds.set("", rootId);

  const sortedDirs = new Set();
  for (const path of filePaths) {
    const parts = path.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      sortedDirs.add(acc);
    }
  }
  const dirsOrdered = [...sortedDirs].sort(
    (a, b) => a.split("/").length - b.split("/").length
  );

  /** @type {{ id: string, label: string, type: string }[]} */
  const nodes = [];
  /** @type {{ source: string, target: string }[]} */
  const edges = [];

  nodes.push({ id: rootId, label: repoLabel, type: "module" });

  for (const dirPath of dirsOrdered) {
    const dirId = `dir:${dirPath}`;
    const label = dirPath.includes("/") ? dirPath.slice(dirPath.lastIndexOf("/") + 1) : dirPath;
    nodes.push({ id: dirId, label, type: "module" });
    const parentPath = dirPath.includes("/") ? dirPath.slice(0, dirPath.lastIndexOf("/")) : "";
    const parentId = dirIds.get(parentPath);
    if (!parentId) continue;
    edges.push({ source: parentId, target: dirId });
    dirIds.set(dirPath, dirId);
  }

  for (const path of filePaths) {
    const fileId = `file:${path}`;
    const base = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const parentId = dirIds.get(base) || rootId;
    const label = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    nodes.push({ id: fileId, label, type: "file" });
    edges.push({ source: parentId, target: fileId });
  }

  return { nodes, edges };
}
