export type FileNode = {
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
  path?: string;
};

/** Build a nested tree from flat repo paths like `src/app/main.ts`. */
export function pathsToFileTree(paths: string[]): FileNode[] {
  const root: FileNode = { name: "", type: "folder", children: [] };

  for (const full of paths) {
    const parts = full.split("/").filter(Boolean);
    if (!parts.length) continue;
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!cur.children) cur.children = [];
      let next = cur.children.find((c) => c.name === part);
      if (!next) {
        next = {
          name: part,
          type: isLast ? "file" : "folder",
          ...(isLast ? { path: parts.join("/") } : { children: [] }),
        };
        cur.children.push(next);
      } else if (isLast && next.type === "folder") {
        next.type = "file";
        next.path = parts.join("/");
        delete next.children;
      }
      if (!isLast) {
        if (next.type === "file") {
          next.type = "folder";
          delete next.path;
          next.children = next.children || [];
        }
        cur = next;
      }
    }
  }

  const sortChildren = (nodes: FileNode[]): FileNode[] =>
    [...nodes].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).map((n) => ({
      ...n,
      children: n.children ? sortChildren(n.children) : undefined,
    }));

  return sortChildren(root.children || []);
}
