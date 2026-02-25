import { readDir } from "@tauri-apps/plugin-fs";
import { getBaseName, getParentPath, joinPath, toVaultRelative } from "../../path-utils";
import type { TreeNode } from "../../types";

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

  return sortNodes(nodes);
}

/** Sort: folders first, then files, alphabetical (case-insensitive). */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Add a node to the tree at the correct sorted position. */
export function addToTree(
  tree: TreeNode[],
  filePath: string,
  vaultRoot: string,
  kind: "file" | "folder",
): TreeNode[] {
  const baseName = getBaseName(filePath);
  if (baseName.startsWith(".")) return tree;
  if (kind === "file" && !baseName.endsWith(".md")) return tree;

  const parentPath = getParentPath(filePath);
  const relativePath = toVaultRelative(filePath, vaultRoot);

  const newNode: TreeNode =
    kind === "folder"
      ? { id: relativePath, name: baseName, path: filePath, kind: "folder", children: [] }
      : { id: relativePath, name: baseName.replace(/\.md$/, ""), path: filePath, kind: "file" };

  if (parentPath === vaultRoot) {
    return sortNodes([...tree.filter((n) => n.path !== filePath), newNode]);
  }

  return tree.map((node) => {
    if (node.kind === "folder" && node.path === parentPath) {
      return {
        ...node,
        children: sortNodes([
          ...(node.children ?? []).filter((n) => n.path !== filePath),
          newNode,
        ]),
      };
    }
    if (node.kind === "folder" && node.children) {
      return { ...node, children: addToTree(node.children, filePath, vaultRoot, kind) };
    }
    return node;
  });
}

/** Remove a node from the tree by path. */
export function removeFromTree(tree: TreeNode[], filePath: string): TreeNode[] {
  return tree
    .filter((node) => node.path !== filePath)
    .map((node) => {
      if (node.kind === "folder" && node.children) {
        return { ...node, children: removeFromTree(node.children, filePath) };
      }
      return node;
    });
}

/** Relocate a node (and its children) from oldPath to newPath. Works for both rename and move. */
export function relocateInTree(
  tree: TreeNode[],
  oldPath: string,
  newPath: string,
  vaultRoot: string,
): TreeNode[] {
  const node = findNode(tree, oldPath);
  if (!node) return tree;

  const pruned = removeFromTree(tree, oldPath);
  const relocated = rebasePaths(node, oldPath, newPath, vaultRoot);
  return insertNode(pruned, relocated, vaultRoot);
}

function findNode(tree: TreeNode[], targetPath: string): TreeNode | null {
  for (const node of tree) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

function rebasePaths(
  node: TreeNode,
  oldBase: string,
  newBase: string,
  vaultRoot: string,
): TreeNode {
  const newPath = newBase + node.path.substring(oldBase.length);
  const newId = toVaultRelative(newPath, vaultRoot);
  const isRoot = node.path === oldBase;
  const newName = isRoot
    ? node.kind === "file"
      ? getBaseName(newPath).replace(/\.md$/, "")
      : getBaseName(newPath)
    : node.name;

  if (node.kind === "folder") {
    return {
      ...node,
      path: newPath,
      id: newId,
      name: newName,
      children: node.children?.map((child) => rebasePaths(child, oldBase, newBase, vaultRoot)),
    };
  }
  return { ...node, path: newPath, id: newId, name: newName };
}

function insertNode(tree: TreeNode[], node: TreeNode, vaultRoot: string): TreeNode[] {
  const parentPath = getParentPath(node.path);

  if (parentPath === vaultRoot) {
    return sortNodes([...tree, node]);
  }

  return tree.map((n) => {
    if (n.kind === "folder" && n.path === parentPath) {
      return { ...n, children: sortNodes([...(n.children ?? []), node]) };
    }
    if (n.kind === "folder" && n.children) {
      return { ...n, children: insertNode(n.children, node, vaultRoot) };
    }
    return n;
  });
}
