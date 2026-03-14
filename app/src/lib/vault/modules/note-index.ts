import { readDir } from "@tauri-apps/plugin-fs";
import {
  getBaseName,
  getParentPath,
  isPathInside,
  joinPath,
  pathsEqual,
  shouldIncludeInVaultTree,
  toVaultRelative,
} from "../../path-utils";
import type { TreeNode } from "../../types";

function getFileDisplayName(fileName: string): string {
  return fileName.replace(/\.md$/i, "");
}

function createFileNode(filePath: string, vaultRoot: string): TreeNode {
  const baseName = getBaseName(filePath);
  return {
    id: toVaultRelative(filePath, vaultRoot),
    name: getFileDisplayName(baseName),
    path: filePath,
    kind: "file",
  };
}

function createFolderNode(filePath: string, vaultRoot: string): TreeNode {
  return {
    id: toVaultRelative(filePath, vaultRoot),
    name: getBaseName(filePath),
    path: filePath,
    kind: "folder",
    children: [],
    loaded: false,
    dirty: false,
  };
}

/** Sort: folders first, then files, alphabetical (case-insensitive). */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function createNode(filePath: string, vaultRoot: string, kind: "file" | "folder"): TreeNode {
  return kind === "folder"
    ? createFolderNode(filePath, vaultRoot)
    : createFileNode(filePath, vaultRoot);
}

async function readDirectoryNodes(
  absolutePath: string,
  vaultRoot: string,
): Promise<TreeNode[]> {
  const entries = await readDir(absolutePath);
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    const entryPath = joinPath(absolutePath, entry.name);
    if (!shouldIncludeInVaultTree(entryPath, vaultRoot)) continue;
    nodes.push(createNode(entryPath, vaultRoot, entry.isDirectory ? "folder" : "file"));
  }

  return sortNodes(nodes);
}

/**
 * Scan only the root level of a vault. Folder children are loaded lazily on expand.
 */
export async function scanVault(vaultPath: string): Promise<TreeNode[]> {
  return readDirectoryNodes(vaultPath, vaultPath);
}

/**
 * Scan one folder level and return its direct children as unloaded nodes.
 */
export async function scanFolderChildren(
  folderPath: string,
  vaultRoot: string,
): Promise<TreeNode[]> {
  return readDirectoryNodes(folderPath, vaultRoot);
}

function markFolderDirty(node: TreeNode): TreeNode {
  if (node.kind !== "folder" || node.dirty) return node;
  return { ...node, dirty: true };
}

function invalidateByChildPath(nodes: TreeNode[], childPath: string): TreeNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.kind !== "folder") return node;
    if (pathsEqual(node.path, childPath)) return node;
    if (!isPathInside(childPath, node.path) && !pathsEqual(getParentPath(childPath), node.path)) {
      return node;
    }
    if (node.loaded === false) {
      changed = true;
      return markFolderDirty(node);
    }
    if (!node.children?.length) return node;
    const nextChildren = invalidateByChildPath(node.children, childPath);
    if (nextChildren !== node.children) {
      changed = true;
      return { ...node, children: nextChildren };
    }
    return node;
  });
  return changed ? next : nodes;
}

export function findTreeNode(tree: TreeNode[], targetPath: string): TreeNode | null {
  for (const node of tree) {
    if (pathsEqual(node.path, targetPath)) return node;
    if (node.kind === "folder" && node.children?.length) {
      const found = findTreeNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

export function isFolderLoaded(tree: TreeNode[], folderPath: string): boolean {
  const node = findTreeNode(tree, folderPath);
  return !!node && node.kind === "folder" && node.loaded !== false;
}

export function replaceFolderChildren(
  tree: TreeNode[],
  folderPath: string,
  children: TreeNode[],
): TreeNode[] {
  let changed = false;
  const next = tree.map((node) => {
    if (node.kind !== "folder") return node;
    if (pathsEqual(node.path, folderPath)) {
      changed = true;
      return {
        ...node,
        children: sortNodes(children),
        loaded: true,
        dirty: false,
      };
    }
    if (!node.children?.length) return node;
    const nextChildren = replaceFolderChildren(node.children, folderPath, children);
    if (nextChildren !== node.children) {
      changed = true;
      return { ...node, children: nextChildren };
    }
    return node;
  });
  return changed ? next : tree;
}

export function addToTree(
  tree: TreeNode[],
  filePath: string,
  vaultRoot: string,
  kind: "file" | "folder",
): TreeNode[] {
  if (!shouldIncludeInVaultTree(filePath, vaultRoot)) return tree;
  const parentPath = getParentPath(filePath);
  const newNode = createNode(filePath, vaultRoot, kind);

  if (pathsEqual(parentPath, vaultRoot)) {
    return sortNodes([...tree.filter((node) => !pathsEqual(node.path, filePath)), newNode]);
  }

  let changed = false;
  const next = tree.map((node) => {
    if (node.kind !== "folder") return node;

    if (pathsEqual(node.path, parentPath)) {
      changed = true;
      if (node.loaded === false) return markFolderDirty(node);
      return {
        ...node,
        children: sortNodes([
          ...(node.children ?? []).filter((child) => !pathsEqual(child.path, filePath)),
          newNode,
        ]),
        dirty: false,
      };
    }

    if (!isPathInside(filePath, node.path)) return node;

    if (node.loaded === false) {
      changed = true;
      return markFolderDirty(node);
    }

    const nextChildren = addToTree(node.children ?? [], filePath, vaultRoot, kind);
    if (nextChildren !== (node.children ?? [])) {
      changed = true;
      return { ...node, children: nextChildren };
    }
    return node;
  });

  return changed ? next : tree;
}

function collectRemovedPaths(nodes: TreeNode[]): string[] {
  const removed: string[] = [];
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      removed.push(item.path);
      if (item.kind === "folder" && item.children?.length) walk(item.children);
    }
  };
  walk(nodes);
  return removed;
}

export function removeFromTree(tree: TreeNode[], filePath: string): TreeNode[] {
  let changed = false;
  const next = tree
    .filter((node) => {
      if (pathsEqual(node.path, filePath)) {
        changed = true;
        return false;
      }
      return true;
    })
    .map((node) => {
      if (node.kind !== "folder") return node;
      if (!isPathInside(filePath, node.path)) return node;
      if (node.loaded === false) {
        changed = true;
        return markFolderDirty(node);
      }
      const nextChildren = removeFromTree(node.children ?? [], filePath);
      if (nextChildren !== (node.children ?? [])) {
        changed = true;
        return { ...node, children: nextChildren };
      }
      return node;
    });
  return changed ? next : tree;
}

function rebasePaths(
  node: TreeNode,
  oldBase: string,
  newBase: string,
  vaultRoot: string,
): TreeNode {
  const newPath = newBase + node.path.substring(oldBase.length);
  const newId = toVaultRelative(newPath, vaultRoot);
  const isRoot = pathsEqual(node.path, oldBase);
  const newName = isRoot
    ? node.kind === "file"
      ? getFileDisplayName(getBaseName(newPath))
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

  if (pathsEqual(parentPath, vaultRoot)) {
    return sortNodes([...tree.filter((item) => !pathsEqual(item.path, node.path)), node]);
  }

  let changed = false;
  const next = tree.map((item) => {
    if (item.kind !== "folder") return item;

    if (pathsEqual(item.path, parentPath)) {
      changed = true;
      if (item.loaded === false) return markFolderDirty(item);
      return {
        ...item,
        children: sortNodes([...(item.children ?? []), node]),
        dirty: false,
      };
    }

    if (!isPathInside(node.path, item.path)) return item;
    if (item.loaded === false) {
      changed = true;
      return markFolderDirty(item);
    }

    const nextChildren = insertNode(item.children ?? [], node, vaultRoot);
    if (nextChildren !== (item.children ?? [])) {
      changed = true;
      return { ...item, children: nextChildren };
    }
    return item;
  });

  return changed ? next : tree;
}

export function relocateInTree(
  tree: TreeNode[],
  oldPath: string,
  newPath: string,
  vaultRoot: string,
): TreeNode[] {
  const node = findTreeNode(tree, oldPath);
  if (!node) {
    return invalidateTreePaths(tree, [oldPath, newPath]);
  }

  const pruned = removeFromTree(tree, oldPath);
  const relocated = rebasePaths(node, oldPath, newPath, vaultRoot);
  return insertNode(pruned, relocated, vaultRoot);
}

export function invalidateTreePaths(tree: TreeNode[], paths: string[]): TreeNode[] {
  let next = tree;
  for (const path of paths) {
    const parentPath = getParentPath(path);
    if (!parentPath) continue;
    next = invalidateByChildPath(next, path);
    if (!pathsEqual(parentPath, path)) {
      next = invalidateByChildPath(next, parentPath);
    }
  }
  return next;
}

export function getRemovedTreePaths(tree: TreeNode[], filePath: string): string[] {
  const node = findTreeNode(tree, filePath);
  if (!node) return [];
  return collectRemovedPaths([node]);
}
