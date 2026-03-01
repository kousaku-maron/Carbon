import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { watch } from "@tauri-apps/plugin-fs";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
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

function normalizeWatchEvent(event: WatchEvent): CanonicalOp[] {
  const type = event.type;
  const paths = event.paths ?? [];
  const ops: CanonicalOp[] = [];

  if (typeof type === "string") {
    for (const path of paths) {
      ops.push({ kind: "touch", path });
    }
    return ops;
  }

  if ("create" in type) {
    for (const path of paths) {
      if (type.create.kind === "folder") {
        ops.push({ kind: "upsert", path, nodeKind: "folder" });
        continue;
      }
      // NOTE: On macOS, create.kind can be "any", so keep the existing extension heuristic.
      if (isMarkdownFile(path)) {
        ops.push({ kind: "upsert", path, nodeKind: "file" });
      } else {
        ops.push({ kind: "upsert", path, nodeKind: "folder" });
      }
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
        if (isMarkdownFile(path)) {
          ops.push({ kind: "upsert", path, nodeKind: "file" });
        } else {
          ops.push({ kind: "upsert", path, nodeKind: "folder" });
        }
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
      if (relocated === next) {
        const fallbackKind = isMarkdownFile(op.to) ? "file" as const : "folder" as const;
        next = addToTree(next, op.to, vaultRoot, fallbackKind);
      } else {
        next = relocated;
      }
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

              const ops = normalizeWatchEvent(event);
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
            } catch (err) {
              latestRef.current.onError?.(
                formatError(err, "Failed to handle file watch event"),
              );
            }
          },
          {
            recursive: true,
            delayMs: 350,
          },
        );
      } catch (err) {
        latestRef.current.onError?.(
          `Failed to watch vault: ${formatError(err, "unknown error")}`,
        );
      }
    })();

    return () => {
      disposed = true;
      unwatch?.();
    };
  }, [vaultPath, setTree]);
}
