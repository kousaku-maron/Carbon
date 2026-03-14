import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { readDir, stat, watch } from "@tauri-apps/plugin-fs";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import {
  getParentPath,
  isPathInside,
  pathsEqual,
  shouldIncludeInVaultTree,
  toVaultRelative,
} from "../../path-utils";
import {
  addToTree,
  findTreeNode,
  getRemovedTreePaths,
  relocateInTree,
  removeFromTree,
  replaceFolderChildren,
} from "../modules/note-index";
import type { TreeNode } from "../../types";

interface UseFileWatcherOptions {
  vaultPath: string | null;
  setTree: Dispatch<SetStateAction<TreeNode[]>>;
  onFileChange?: (changedPaths: string[]) => Promise<void>;
  onPathsRemoved?: (removedPaths: string[]) => void;
  onPathsMoved?: (moves: Array<{ from: string; to: string }>) => void;
  onError?: (msg: string) => void;
}

type CanonicalOp =
  | { kind: "upsert"; path: string; nodeKind: "file" | "folder" }
  | { kind: "remove"; path: string }
  | { kind: "move"; from: string; to: string }
  | { kind: "touch"; path: string };

type SnapshotEntry = TreeNode;

const RESYNC_DEBOUNCE_MS = 350;
const RESYNC_FAILURE_FALLBACK_THRESHOLD = 3;

function logWatchDev(label: string, payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.debug(`[watch] ${label}`, payload);
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  try {
    const raw = JSON.stringify(err);
    if (raw && raw !== "{}") return raw;
  } catch {
    // ignore
  }
  return fallback;
}

function isMarkdownFile(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function isMissingPathError(err: unknown): boolean {
  const text = formatError(err, "").toLowerCase();
  return (
    text.includes("enoent") ||
    text.includes("not found") ||
    text.includes("no such file") ||
    text.includes("does not exist")
  );
}

function isNotDirectoryError(err: unknown): boolean {
  const text = formatError(err, "").toLowerCase();
  return text.includes("enotdir") || text.includes("not a directory");
}

async function probePath(path: string): Promise<CanonicalOp> {
  try {
    await readDir(path);
    return { kind: "upsert", path, nodeKind: "folder" };
  } catch (readErr) {
    if (isMissingPathError(readErr)) {
      return { kind: "remove", path };
    }
    if (isNotDirectoryError(readErr)) {
      return { kind: "upsert", path, nodeKind: "file" };
    }

    // Fallback for platforms where readDir error text is ambiguous.
    try {
      const info = await stat(path);
      if (info.isDirectory) {
        return { kind: "upsert", path, nodeKind: "folder" };
      }
      return { kind: "upsert", path, nodeKind: "file" };
    } catch (statErr) {
      if (isMissingPathError(statErr)) {
        return { kind: "remove", path };
      }
      // Never throw from probing; prefer a stable best-effort tree update.
      return { kind: "upsert", path, nodeKind: "file" };
    }
  }
}

async function resolveNodeKind(
  path: string,
  hintedKind: "file" | "folder" | "any" | "other",
): Promise<"file" | "folder"> {
  if (hintedKind === "file" || hintedKind === "folder") return hintedKind;
  const probed = await probePath(path);
  return probed.kind === "upsert" ? probed.nodeKind : "file";
}

async function normalizeWatchEvent(event: WatchEvent): Promise<CanonicalOp[]> {
  const type = event.type;
  const paths = event.paths ?? [];
  const ops: CanonicalOp[] = [];

  if (typeof type === "string") {
    if (type === "any" || type === "other") {
      for (const path of paths) {
        ops.push(await probePath(path));
        ops.push({ kind: "touch", path });
      }
      return ops;
    }
    for (const path of paths) {
      ops.push({ kind: "touch", path });
    }
    return ops;
  }

  if ("create" in type) {
    for (const path of paths) {
      const nodeKind = await resolveNodeKind(path, type.create.kind);
      ops.push({ kind: "upsert", path, nodeKind });
    }
    return ops;
  }

  if ("remove" in type) {
    for (const path of paths) {
      ops.push({ kind: "remove", path });
      ops.push({ kind: "touch", path });
    }
    return ops;
  }

  if ("modify" in type && type.modify.kind === "rename") {
    const mode = type.modify.mode;
    if (mode === "both" && paths.length >= 2) {
      ops.push({ kind: "move", from: paths[0], to: paths[1] });
      ops.push(await probePath(paths[1]));
      ops.push({ kind: "touch", path: paths[0] });
      ops.push({ kind: "touch", path: paths[1] });
      return ops;
    }
    if (mode === "from") {
      for (const path of paths) {
        ops.push({ kind: "remove", path });
        ops.push({ kind: "touch", path });
      }
      return ops;
    }
    if (mode === "to") {
      for (const path of paths) {
        const nodeKind = await resolveNodeKind(path, "any");
        ops.push({ kind: "upsert", path, nodeKind });
        ops.push({ kind: "touch", path });
      }
      return ops;
    }

    if (mode === "any" || mode === "other") {
      for (const path of paths) {
        ops.push(await probePath(path));
        ops.push({ kind: "touch", path });
      }
      return ops;
    }

    for (const path of paths) {
      ops.push({ kind: "touch", path });
    }
    return ops;
  }

  if ("modify" in type && type.modify.kind === "data") {
    for (const path of paths) {
      ops.push({ kind: "touch", path });
    }
    return ops;
  }

  if ("modify" in type && (type.modify.kind === "any" || type.modify.kind === "other")) {
    for (const path of paths) {
      ops.push(await probePath(path));
      ops.push({ kind: "touch", path });
    }
    return ops;
  }

  if ("modify" in type) {
    // Metadata/attribute-only updates should not trigger markdown reload flow.
    return ops;
  }

  // Unknown events are ignored to avoid false positives in onFileChange.
  return ops;
}

function applyTreeOps(prev: TreeNode[], ops: CanonicalOp[], vaultRoot: string): TreeNode[] {
  let next = prev;

  for (const op of ops) {
    if (op.kind === "remove") {
      next = removeFromTree(next, op.path);
      continue;
    }
    if (op.kind === "move") {
      const relocated = relocateInTree(next, op.from, op.to, vaultRoot);
      next = relocated;
      continue;
    }
    if (op.kind === "upsert") {
      next = addToTree(next, op.path, vaultRoot, op.nodeKind);
    }
  }

  return next;
}

function collectChangedMarkdownPaths(ops: CanonicalOp[]): string[] {
  const changed = new Set<string>();
  for (const op of ops) {
    if (op.kind === "touch" && isMarkdownFile(op.path)) changed.add(op.path);
    if (op.kind === "upsert" && op.nodeKind === "file" && isMarkdownFile(op.path)) {
      changed.add(op.path);
    }
    if (op.kind === "remove" && isMarkdownFile(op.path)) changed.add(op.path);
    if (op.kind === "move") {
      if (isMarkdownFile(op.from)) changed.add(op.from);
      if (isMarkdownFile(op.to)) changed.add(op.to);
    }
  }
  return [...changed];
}

function collectRemovedPaths(ops: CanonicalOp[]): string[] {
  const removed = new Set<string>();
  for (const op of ops) {
    if (op.kind === "remove") removed.add(op.path);
  }
  return [...removed];
}

function collectMovedPaths(ops: CanonicalOp[]): Array<{ from: string; to: string }> {
  const moves: Array<{ from: string; to: string }> = [];
  for (const op of ops) {
    if (op.kind === "move") {
      moves.push({ from: op.from, to: op.to });
    }
  }
  return moves;
}

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

function shouldIgnoreResyncPath(path: string, vaultRoot: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(vaultRoot);
  if (pathsEqual(normalizedPath, normalizedRoot)) return false;
  if (!isPathInside(normalizedPath, normalizedRoot)) return true;
  return !shouldIncludeInVaultTree(normalizedPath, normalizedRoot);
}

async function readDirectorySnapshotEntries(
  absoluteDirPath: string,
  vaultRoot: string,
): Promise<TreeNode[]> {
  const entries = await readDir(absoluteDirPath);
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) =>
      shouldIncludeInVaultTree(
        absoluteDirPath.endsWith("/") || absoluteDirPath.endsWith("\\")
          ? `${absoluteDirPath}${entry.name}`
          : `${absoluteDirPath}${absoluteDirPath.includes("\\") ? "\\" : "/"}${entry.name}`,
        vaultRoot,
      ))
    .map((entry) => {
      const entryPath = absoluteDirPath.endsWith("/") || absoluteDirPath.endsWith("\\")
        ? `${absoluteDirPath}${entry.name}`
        : `${absoluteDirPath}${absoluteDirPath.includes("\\") ? "\\" : "/"}${entry.name}`;
      return entry.isDirectory
        ? {
            id: toVaultRelative(entryPath, vaultRoot),
            name: entry.name,
            path: entryPath,
            kind: "folder" as const,
            children: [],
            loaded: false,
            dirty: false,
          }
        : {
            id: toVaultRelative(entryPath, vaultRoot),
            name: entry.name.replace(/\.md$/i, ""),
            path: entryPath,
            kind: "file" as const,
          };
    });
}

function reconcileTreeWithSnapshot(
  prev: TreeNode[],
  snapshot: SnapshotEntry[],
  scopePath: string,
  vaultRoot: string,
): { next: TreeNode[]; removedPaths: string[]; changedMarkdownPaths: string[] } {
  const mergeSnapshot = (existingChildren: TreeNode[], entries: SnapshotEntry[]): TreeNode[] =>
    entries.map((entry) => {
      const existing = existingChildren.find(
        (child) => pathsEqual(child.path, entry.path) && child.kind === entry.kind,
      );
      if (!existing || entry.kind !== "folder" || existing.kind !== "folder") return entry;
      return {
        ...entry,
        children: existing.children,
        loaded: existing.loaded,
        dirty: existing.dirty,
      };
    });

  const existingChildren = pathsEqual(scopePath, vaultRoot)
    ? prev
    : (() => {
        const folder = findTreeNode(prev, scopePath);
        if (!folder || folder.kind !== "folder") return [];
        return folder.children ?? [];
      })();

  const snapshotSet = new Set(snapshot.map((entry) => normalizePath(entry.path)));
  const existingSet = new Set(existingChildren.map((entry) => normalizePath(entry.path)));
  const removedNodes = existingChildren.filter(
    (entry) => !snapshotSet.has(normalizePath(entry.path)),
  );
  const removedPaths = removedNodes.flatMap((entry) => getRemovedTreePaths(prev, entry.path));
  const changedMarkdownPaths = new Set<string>();
  for (const removedPath of removedPaths) {
    if (isMarkdownFile(removedPath)) changedMarkdownPaths.add(removedPath);
  }
  for (const entry of snapshot) {
    if (entry.kind !== "file" || !isMarkdownFile(entry.path)) continue;
      if (!existingSet.has(normalizePath(entry.path))) changedMarkdownPaths.add(entry.path);
  }

  const mergedSnapshot = mergeSnapshot(existingChildren, snapshot);
  const next = pathsEqual(scopePath, vaultRoot)
    ? mergedSnapshot
    : replaceFolderChildren(addToTree(prev, scopePath, vaultRoot, "folder"), scopePath, mergedSnapshot);

  return {
    next,
    removedPaths: [...new Set(removedPaths)],
    changedMarkdownPaths: [...changedMarkdownPaths],
  };
}

function collectSuspiciousResyncDirs(
  event: WatchEvent,
  ops: CanonicalOp[],
  vaultRoot: string,
): string[] {
  const dirs = new Set<string>();
  const add = (path: string) => {
    const normalized = normalizePath(path);
    if (shouldIgnoreResyncPath(normalized, vaultRoot)) return;
    dirs.add(normalized);
  };
  const addParent = (path: string) => {
    const parent = getParentPath(path);
    if (!parent) {
      add(vaultRoot);
      return;
    }
    add(parent);
  };

  const eventType = event.type;
  if (typeof eventType !== "string" && "modify" in eventType && eventType.modify.kind === "rename") {
    if (eventType.modify.mode === "to") {
      for (const path of event.paths ?? []) addParent(path);
    } else if (eventType.modify.mode === "both") {
      const [from, to] = event.paths ?? [];
      if (from) addParent(from);
      if (to) addParent(to);
    }
  }

  for (const op of ops) {
    if (op.kind === "upsert" && op.nodeKind === "folder") {
      add(op.path);
      addParent(op.path);
      continue;
    }
    if (op.kind === "move") {
      addParent(op.from);
      addParent(op.to);
      continue;
    }
    if (op.kind === "upsert") {
      addParent(op.path);
    }
  }

  return [...dirs];
}

// Test-only exports to lock current normalization/apply behavior.
export const __fileWatcherTestUtils = {
  formatError,
  isMarkdownFile,
  isMissingPathError,
  isNotDirectoryError,
  probePath,
  resolveNodeKind,
  normalizeWatchEvent,
  applyTreeOps,
  collectChangedMarkdownPaths,
  collectRemovedPaths,
  collectMovedPaths,
  normalizePath,
  normalizePathKey,
  shouldIgnoreResyncPath,
  readDirectorySnapshotEntries,
  reconcileTreeWithSnapshot,
  collectSuspiciousResyncDirs,
};

export function useFileWatcher({
  vaultPath,
  setTree,
  onFileChange,
  onPathsRemoved,
  onPathsMoved,
  onError,
}: UseFileWatcherOptions) {
  const latestRef = useRef({ onFileChange, onPathsRemoved, onPathsMoved, onError });
  const eventSeqRef = useRef(0);

  useEffect(() => {
    latestRef.current = { onFileChange, onPathsRemoved, onPathsMoved, onError };
  }, [onFileChange, onPathsRemoved, onPathsMoved, onError]);

  useEffect(() => {
    if (!vaultPath) return;
    let unwatch: (() => void) | null = null;
    let disposed = false;
    let resyncSeq = 0;
    const latestSeqByDir = new Map<string, number>();
    const timerByDir = new Map<string, ReturnType<typeof setTimeout>>();
    const resyncFailureByDir = new Map<string, number>();

    const reportError = (err: unknown, fallback: string) => {
      const msg = formatError(err, fallback);
      console.error("[workspace-error]", msg, err);
      latestRef.current.onError?.(msg);
    };

    const runResync = async (dirPath: string, key: string, seq: number): Promise<void> => {
      if (disposed) return;
      if (latestSeqByDir.get(key) !== seq) return;
      if (shouldIgnoreResyncPath(dirPath, vaultPath)) return;

      try {
        let snapshot: SnapshotEntry[] = [];
        let missingDir = false;
        try {
          snapshot = await readDirectorySnapshotEntries(dirPath, vaultPath);
        } catch (err) {
          if (isMissingPathError(err) && !pathsEqual(dirPath, vaultPath)) {
            missingDir = true;
          } else {
            throw err;
          }
        }
        if (disposed) return;
        if (latestSeqByDir.get(key) !== seq) return;

        let removedPaths: string[] = [];
        let changedMarkdownPaths: string[] = [];
        setTree((prev) => {
          if (missingDir) {
            removedPaths = getRemovedTreePaths(prev, dirPath);
            return removeFromTree(prev, dirPath);
          }
          const reconciled = reconcileTreeWithSnapshot(prev, snapshot, dirPath, vaultPath);
          removedPaths = reconciled.removedPaths;
          changedMarkdownPaths = reconciled.changedMarkdownPaths;
          return reconciled.next;
        });

        resyncFailureByDir.set(key, 0);

        if (removedPaths.length) {
          latestRef.current.onPathsRemoved?.(removedPaths);
        }

        if (changedMarkdownPaths.length) {
          await latestRef.current.onFileChange?.(changedMarkdownPaths);
        }
      } catch (err) {
        reportError(err, `Failed to resync directory: ${dirPath}`);
        const nextFailures = (resyncFailureByDir.get(key) ?? 0) + 1;
        resyncFailureByDir.set(key, nextFailures);

        if (
          nextFailures >= RESYNC_FAILURE_FALLBACK_THRESHOLD &&
          !pathsEqual(dirPath, vaultPath)
        ) {
          const rootKey = normalizePathKey(vaultPath);
          const rootSeq = ++resyncSeq;
          latestSeqByDir.set(rootKey, rootSeq);
          const existingTimer = timerByDir.get(rootKey);
          if (existingTimer) clearTimeout(existingTimer);
          const rootTimer = setTimeout(() => {
            timerByDir.delete(rootKey);
            void runResync(vaultPath, rootKey, rootSeq);
          }, RESYNC_DEBOUNCE_MS);
          timerByDir.set(rootKey, rootTimer);
        }
      }
    };

    const scheduleResync = (targetDirPath: string) => {
      const normalizedPath = normalizePath(targetDirPath);
      if (shouldIgnoreResyncPath(normalizedPath, vaultPath)) return;
      const key = normalizePathKey(normalizedPath);
      const seq = ++resyncSeq;
      latestSeqByDir.set(key, seq);

      const existingTimer = timerByDir.get(key);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        timerByDir.delete(key);
        void runResync(normalizedPath, key, seq);
      }, RESYNC_DEBOUNCE_MS);
      timerByDir.set(key, timer);
    };

    (async () => {
      try {
        unwatch = await watch(
          vaultPath,
          async (event: WatchEvent) => {
            if (disposed) return;
            try {
              eventSeqRef.current += 1;
              const eventId = eventSeqRef.current;
              const rawType = typeof event.type === "string"
                ? event.type
                : JSON.stringify(event.type);
              logWatchDev("received", {
                eventId,
                rawType,
                pathCount: event.paths?.length ?? 0,
                paths: event.paths ?? [],
              });

              const ops = await normalizeWatchEvent(event);
              if (disposed) return;
              if (!ops.length) return;
              logWatchDev("normalized", {
                eventId,
                opCount: ops.length,
                opKinds: ops.map((op) => op.kind),
              });
              setTree((prev) => applyTreeOps(prev, ops, vaultPath));

              const removedPaths = collectRemovedPaths(ops);
              if (removedPaths.length) {
                logWatchDev("removed-paths", { eventId, removedPaths });
                latestRef.current.onPathsRemoved?.(removedPaths);
              }

              const movedPaths = collectMovedPaths(ops);
              if (movedPaths.length) {
                logWatchDev("moved-paths", { eventId, movedPaths });
                latestRef.current.onPathsMoved?.(movedPaths);
              }

              const changed = collectChangedMarkdownPaths(ops);
              if (changed.length) {
                logWatchDev("changed-markdown", { eventId, changed });
                await latestRef.current.onFileChange?.(changed);
              }

              const suspiciousDirs = collectSuspiciousResyncDirs(event, ops, vaultPath);
              if (suspiciousDirs.length) {
                for (const dirPath of suspiciousDirs) {
                  scheduleResync(dirPath);
                }
              }
            } catch (err) {
              reportError(err, "Failed to handle file watch event");
            }
          },
          {
            recursive: true,
            delayMs: 350,
          },
        );
      } catch (err) {
        const msg = `Failed to watch vault: ${formatError(err, "unknown error")}`;
        console.error("[workspace-error]", msg, err);
        latestRef.current.onError?.(msg);
      }
    })();

    return () => {
      disposed = true;
      for (const timer of timerByDir.values()) {
        clearTimeout(timer);
      }
      timerByDir.clear();
      unwatch?.();
    };
  }, [vaultPath, setTree]);
}
