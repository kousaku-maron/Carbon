import { getParentPath, isPathInside, joinPath, pathsEqual, toPosix } from "./path-utils";
import type { TreeNode } from "./types";

function splitHashFromHref(href: string): { pathPart: string; hash: string } {
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0) {
    return { pathPart: href, hash: "" };
  }
  return {
    pathPart: href.slice(0, hashIndex),
    hash: href.slice(hashIndex),
  };
}

function splitAbsolutePath(absolutePath: string): {
  root: string;
  segments: string[];
} {
  const normalized = toPosix(absolutePath);

  // Unix absolute path: /vault/notes/a.md
  if (normalized.startsWith("/")) {
    return {
      root: "/",
      segments: normalized.slice(1).split("/").filter(Boolean),
    };
  }

  // Windows absolute path: C:/vault/notes/a.md
  if (/^[A-Za-z]:\//.test(normalized)) {
    return {
      root: normalized.slice(0, 3), // e.g. "C:/"
      segments: normalized.slice(3).split("/").filter(Boolean),
    };
  }

  // Fallback (shouldn't normally happen for note absolute paths).
  return {
    root: "",
    segments: normalized.split("/").filter(Boolean),
  };
}

function buildAbsolutePath(root: string, segments: string[]): string {
  const body = segments.join("/");
  if (!root) return body;
  if (!body) return root.endsWith("/") ? root : `${root}/`;
  return `${root}${body}`;
}

/**
 * Compute a POSIX-style relative path from one note to another.
 * Both arguments must be absolute paths.
 *
 * Example:
 *   fromNotePath = "/vault/notes/daily/2024-01-01.md"
 *   toNotePath   = "/vault/notes/projects/todo.md"
 *   result       = "../projects/todo.md"
 */
export function getRelativePath(
  fromNotePath: string,
  toNotePath: string,
): string {
  const fromDir = toPosix(getParentPath(fromNotePath));
  const to = toPosix(toNotePath);

  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);

  // Find the length of the common prefix
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const ups = fromParts.length - common;
  const remaining = toParts.slice(common);

  if (ups === 0) {
    return `./${remaining.join("/")}`;
  }
  return `${"../".repeat(ups)}${remaining.join("/")}`;
}

/**
 * Resolve a relative href against the current note's directory.
 * Returns an absolute POSIX path.
 *
 * Example:
 *   currentNotePath = "/vault/notes/daily/2024-01-01.md"
 *   relativeHref    = "../projects/todo.md"
 *   result          = "/vault/notes/projects/todo.md"
 */
export function resolveRelativePath(
  currentNotePath: string,
  relativeHref: string,
): string {
  const dir = getParentPath(currentNotePath);
  const { root, segments } = splitAbsolutePath(dir);
  const { pathPart } = splitHashFromHref(relativeHref);
  const hrefParts = pathPart.split("/");

  for (const segment of hrefParts) {
    if (segment === "..") {
      if (segments.length > 0) {
        segments.pop();
      }
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }

  return buildAbsolutePath(root, segments);
}

/**
 * Resolve a local Markdown href for vault files.
 * A leading slash means vault-root absolute, not filesystem-root absolute.
 */
export function resolveVaultLocalPath(
  currentNotePath: string,
  href: string,
  vaultPath: string,
): string {
  const { pathPart } = splitHashFromHref(href);

  if (pathPart.startsWith("/") && !pathPart.startsWith("//")) {
    return pathPart
      .split("/")
      .filter(Boolean)
      .reduce((parent, segment) => joinPath(parent, segment), vaultPath);
  }

  return resolveRelativePath(currentNotePath, href);
}

/**
 * Validate that a resolved link target is within the vault and is a markdown file.
 */
export function validateLinkTarget(
  resolvedPath: string,
  vaultPath: string,
): { valid: boolean; reason?: string } {
  const { pathPart } = splitHashFromHref(resolvedPath);
  if (!isPathInside(pathPart, vaultPath)) {
    return { valid: false, reason: "Link target is outside the vault" };
  }
  if (!/\.md$/i.test(pathPart)) {
    return { valid: false, reason: "Link target is not a markdown file" };
  }
  return { valid: true };
}

/**
 * Flatten a recursive TreeNode[] into a flat array of file nodes only.
 */
export function flattenTreeNodes(tree: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (node.kind === "file") {
        result.push(node);
      }
      if (node.children) {
        walk(node.children);
      }
    }
  }
  walk(tree);
  return result;
}

/**
 * Find a TreeNode by its absolute path (recursive search).
 */
export function findNodeByPath(
  nodes: TreeNode[],
  targetPath: string,
): TreeNode | null {
  for (const node of nodes) {
    if (node.kind === "file" && pathsEqual(node.path, targetPath)) {
      return node;
    }
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}
