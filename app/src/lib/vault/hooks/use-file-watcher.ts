import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { readDir, stat, watch } from "@tauri-apps/plugin-fs";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import { getParentPath, isPathInside, pathsEqual } from "../../path-utils";
import { addToTree, relocateInTree, removeFromTree } from "../modules/note-index";
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

type SnapshotEntry = { path: string; kind: "file" | "folder" };

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

  const relative = normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, "");
  if (!relative) return false;
  return relative.split("/").some((segment) => segment.startsWith("."));
}

function collectTreeEntries(nodes: TreeNode[]): SnapshotEntry[] {
  const entries: SnapshotEntry[] = [];
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      entries.push({ path: item.path, kind: item.kind });
      if (item.kind === "folder" && item.children?.length) {
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return entries;
}

async function readDirectorySnapshotEntries(
  absoluteDirPath: string,
): Promise<Array<{ entryPath: string; isDirectory: boolean }>> {
  const entries = await readDir(absoluteDirPath);
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => ({
      entryPath: absoluteDirPath.endsWith("/") || absoluteDirPath.endsWith("\\")
        ? `${absoluteDirPath}${entry.name}`
        : `${absoluteDirPath}${absoluteDirPath.includes("\\") ? "\\" : "/"}${entry.name}`,
      isDirectory: entry.isDirectory,
    }));
}

async function scanSubtree(path: string): Promise<SnapshotEntry[]> {
  const out: SnapshotEntry[] = [{ path, kind: "folder" }];
  const stack: string[] = [path];

  while (stack.length) {
    const currentDir = stack.pop()!;
    let entries: Array<{ entryPath: string; isDirectory: boolean }>;
    try {
      entries = await readDirectorySnapshotEntries(currentDir);
    } catch (err) {
      if (isMissingPathError(err)) {
        if (pathsEqual(currentDir, path)) return [];
        continue;
      }
      throw err;
    }

    for (const entry of entries) {
      if (entry.isDirectory) {
        out.push({ path: entry.entryPath, kind: "folder" });
        stack.push(entry.entryPath);
      } else {
        out.push({ path: entry.entryPath, kind: "file" });
      }
    }
  }

  return out;
}

async function scanScopeSnapshot(scopePath: string, vaultRoot: string): Promise<SnapshotEntry[]> {
  if (pathsEqual(scopePath, vaultRoot)) {
    const rootEntries = await scanSubtree(vaultRoot);
    return rootEntries.filter((entry) => !pathsEqual(entry.path, vaultRoot));
  }
  return scanSubtree(scopePath);
}

function reconcileTreeWithSnapshot(
  prev: TreeNode[],
  snapshot: SnapshotEntry[],
  scopePath: string,
  vaultRoot: string,
): { next: TreeNode[]; removedPaths: string[]; changedMarkdownPaths: string[] } {
  const normalizedScope = normalizePath(scopePath);
  const inScope = (path: string) =>
    pathsEqual(normalizedScope, vaultRoot) || isPathInside(path, normalizedScope);

  const existing = collectTreeEntries(prev);
  const existingInScope = existing.filter((entry) => inScope(entry.path));
  const snapshotSet = new Set(snapshot.map((entry) => normalizePath(entry.path)));
  const existingSet = new Set(existing.map((entry) => normalizePath(entry.path)));

  let next = prev;
  const sortedRemovals = [...existingInScope]
    .sort((a, b) => b.path.length - a.path.length)
    .map((entry) => entry.path);
  for (const path of sortedRemovals) {
    next = removeFromTree(next, path);
  }

  const sortedAdditions = [...snapshot].sort((a, b) => {
    const depthA = normalizePath(a.path).split("/").length;
    const depthB = normalizePath(b.path).split("/").length;
    if (depthA !== depthB) return depthA - depthB;
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  for (const entry of sortedAdditions) {
    next = addToTree(next, entry.path, vaultRoot, entry.kind);
  }

  const removedPaths = existingInScope
    .map((entry) => entry.path)
    .filter((path) => !snapshotSet.has(normalizePath(path)));
  const changedMarkdownPaths = new Set<string>();
  for (const removedPath of removedPaths) {
    if (isMarkdownFile(removedPath)) changedMarkdownPaths.add(removedPath);
  }
  for (const entry of snapshot) {
    if (entry.kind !== "file" || !isMarkdownFile(entry.path)) continue;
    if (!existingSet.has(normalizePath(entry.path))) changedMarkdownPaths.add(entry.path);
  }

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
        const snapshot = await scanScopeSnapshot(dirPath, vaultPath);
        if (disposed) return;
        if (latestSeqByDir.get(key) !== seq) return;

        let removedPaths: string[] = [];
        let changedMarkdownPaths: string[] = [];
        setTree((prev) => {
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
