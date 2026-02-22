import { readDir } from "@tauri-apps/plugin-fs";
import { joinPath, toVaultRelative } from "./pathUtils";
import type { TreeNode } from "./types";

/**
 * Recursively scan a directory and return a sorted tree of folders and .md files.
 * Sorting: folders first, then files, both alphabetical (case-insensitive).
 */
export async function scanVault(vaultPath: string): Promise<TreeNode[]> {
  return scanDir(vaultPath, vaultPath);
}

async function scanDir(absolutePath: string, vaultRoot: string): Promise<TreeNode[]> {
  const entries = await readDir(absolutePath);
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    // Skip hidden files/folders (starting with .)
    if (entry.name.startsWith(".")) continue;

    const entryPath = joinPath(absolutePath, entry.name);
    const relativePath = toVaultRelative(entryPath, vaultRoot);

    if (entry.isDirectory) {
      const children = await scanDir(entryPath, vaultRoot);
      nodes.push({
        id: relativePath,
        name: entry.name,
        path: entryPath,
        kind: "folder",
        children,
      });
    } else if (entry.name.endsWith(".md")) {
      nodes.push({
        id: relativePath,
        name: entry.name.replace(/\.md$/, ""),
        path: entryPath,
        kind: "file",
      });
    }
  }

  // Sort: folders first, then files, alphabetical within each group
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return nodes;
}
