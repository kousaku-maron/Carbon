/**
 * Path helpers that handle both "/" and "\\" separators.
 * We keep absolute paths as-is for fs operations, and normalize only when comparing.
 */

export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

export function normalizeForCompare(path: string): string {
  return toPosix(path).replace(/\/+$/, "");
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

export function isPathInside(path: string, parent: string): boolean {
  const normalizedPath = normalizeForCompare(path);
  const normalizedParent = normalizeForCompare(parent);
  return (
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent}/`)
  );
}

export function getPathSeparator(path: string): "/" | "\\" {
  return path.includes("\\") ? "\\" : "/";
}

export function joinPath(parent: string, child: string): string {
  const sep = getPathSeparator(parent);
  if (parent.endsWith("/") || parent.endsWith("\\")) {
    return `${parent}${child}`;
  }
  return `${parent}${sep}${child}`;
}

export function getParentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const slashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slashIndex < 0) return trimmed;
  return trimmed.slice(0, slashIndex);
}

export function getBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const slashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slashIndex < 0) return trimmed;
  return trimmed.slice(slashIndex + 1);
}

export function toVaultRelative(absolutePath: string, vaultRoot: string): string {
  const normalizedAbsolute = toPosix(absolutePath);
  const normalizedRoot = toPosix(vaultRoot).replace(/\/+$/, "");
  if (normalizedAbsolute.startsWith(`${normalizedRoot}/`)) {
    return normalizedAbsolute.slice(normalizedRoot.length + 1);
  }
  return normalizedAbsolute;
}

export function hasInvalidNodeName(name: string): boolean {
  return name.includes("/") || name.includes("\\") || name.includes("..");
}
