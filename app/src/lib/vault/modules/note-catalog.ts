import { readDir } from "@tauri-apps/plugin-fs";
import { getBaseName, isPathInside, joinPath, pathsEqual, shouldIncludeInVaultTree, toVaultRelative } from "../../path-utils";
import type { NoteIndexEntry } from "../../types";

function sortEntries(entries: NoteIndexEntry[]): NoteIndexEntry[] {
  return [...entries].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.id.localeCompare(b.id, undefined, { sensitivity: "base" }),
  );
}

export function createNoteIndexEntry(
  filePath: string,
  vaultRoot: string,
): NoteIndexEntry | null {
  if (!/\.md$/i.test(filePath)) return null;
  if (!shouldIncludeInVaultTree(filePath, vaultRoot)) return null;
  const baseName = getBaseName(filePath);
  return {
    id: toVaultRelative(filePath, vaultRoot),
    name: baseName.replace(/\.md$/i, ""),
    path: filePath,
  };
}

export async function scanNoteIndex(vaultRoot: string): Promise<NoteIndexEntry[]> {
  const entries: NoteIndexEntry[] = [];
  const stack = [vaultRoot];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    let children;
    try {
      children = await readDir(currentDir);
    } catch {
      continue;
    }
    if (!Array.isArray(children)) continue;

    for (const child of children) {
      const childPath = joinPath(currentDir, child.name);
      if (!shouldIncludeInVaultTree(childPath, vaultRoot)) continue;
      if (child.isDirectory) {
        stack.push(childPath);
        continue;
      }
      const entry = createNoteIndexEntry(childPath, vaultRoot);
      if (entry) entries.push(entry);
    }
  }

  return sortEntries(entries);
}

export function upsertNoteIndex(
  prev: NoteIndexEntry[],
  filePath: string,
  vaultRoot: string,
): NoteIndexEntry[] {
  const entry = createNoteIndexEntry(filePath, vaultRoot);
  if (!entry) return prev;
  return sortEntries([...prev.filter((item) => !pathsEqual(item.path, filePath)), entry]);
}

export function removeFromNoteIndex(prev: NoteIndexEntry[], removedPath: string): NoteIndexEntry[] {
  return prev.filter(
    (entry) =>
      !pathsEqual(entry.path, removedPath) &&
      !isPathInside(entry.path, removedPath),
  );
}

export function relocateInNoteIndex(
  prev: NoteIndexEntry[],
  oldPath: string,
  newPath: string,
  vaultRoot: string,
): NoteIndexEntry[] {
  const next: NoteIndexEntry[] = [];

  for (const entry of prev) {
    if (isPathInside(entry.path, oldPath)) {
      const relocatedPath = newPath + entry.path.substring(oldPath.length);
      const relocated = createNoteIndexEntry(relocatedPath, vaultRoot);
      if (relocated) next.push(relocated);
      continue;
    }
    next.push(entry);
  }

  const direct = createNoteIndexEntry(newPath, vaultRoot);
  if (direct && !next.some((entry) => pathsEqual(entry.path, direct.path))) {
    next.push(direct);
  }

  return sortEntries(next);
}
