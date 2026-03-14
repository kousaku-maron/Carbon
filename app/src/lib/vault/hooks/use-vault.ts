import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteIndexEntry, TreeNode } from "../../types";
import { isMarkdownPath } from "../../file-kind";
import { getBaseName, isPathInside, pathsEqual, toVaultRelative } from "../../path-utils";
import { relocateInNoteIndex, removeFromNoteIndex, scanNoteIndex, upsertNoteIndex } from "../modules/note-catalog";
import { findTreeNode, replaceFolderChildren, scanFolderChildren, scanVault } from "../modules/note-index";
import {
  getVaultHistory,
  getVaultPath,
  removeFromHistory,
  setVaultPath,
} from "../modules/store";
import { useActiveNoteSync } from "./use-active-note-sync";
import { useFileOps } from "./use-file-ops";
import { useFileWatcher } from "./use-file-watcher";

interface UseVaultOptions {
  onError?: (msg: string) => void;
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

export function useVault(options?: UseVaultOptions) {
  const [vaultPath, setVaultPathState] = useState<string | null>(null);
  const [vaultHistory, setVaultHistory] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [noteIndex, setNoteIndex] = useState<NoteIndexEntry[]>([]);
  const [activeNonMarkdownFile, setActiveNonMarkdownFile] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingFoldersRef = useRef(new Set<string>());
  const noteIndexScanSeqRef = useRef(0);

  const {
    activeNote,
    handleSelectNote: handleSelectMarkdownNote,
    handleEditorBufferChange,
    onFileChange,
    onPathsRemoved: onActiveNoteRemoved,
    onPathsMoved: onActiveNoteMoved,
    handleSaveWithGuards,
    clearActiveNote,
  } = useActiveNoteSync({
    vaultPath,
    onError: options?.onError,
  });

  const refreshNoteIndex = useCallback(
    async (path: string) => {
      const seq = ++noteIndexScanSeqRef.current;
      try {
        const next = await scanNoteIndex(path);
        setNoteIndex((prev) => {
          if (seq !== noteIndexScanSeqRef.current) return prev;
          return next;
        });
      } catch (err) {
        options?.onError?.(`Failed to index notes: ${formatError(err, "unknown error")}`);
      }
    },
    [options?.onError],
  );

  const handlePathsRemoved = useCallback((removedPaths: string[]) => {
    onActiveNoteRemoved(removedPaths);
    setNoteIndex((prev) =>
      removedPaths.reduce((acc, path) => removeFromNoteIndex(acc, path), prev));
    setActiveNonMarkdownFile((prev) => {
      if (!prev) return prev;
      const removed = removedPaths.some((removedPath) => isPathInside(prev.path, removedPath));
      return removed ? null : prev;
    });
  }, [onActiveNoteRemoved]);

  const handlePathsMoved = useCallback((moves: Array<{ from: string; to: string }>) => {
    onActiveNoteMoved(moves);
    setNoteIndex((prev) =>
      moves.reduce(
        (acc, move) => vaultPath ? relocateInNoteIndex(acc, move.from, move.to, vaultPath) : acc,
        prev,
      ));
    setActiveNonMarkdownFile((prev) => {
      if (!prev) return prev;
      const moved = moves.find((move) => pathsEqual(prev.path, move.from));
      if (!moved) return prev;
      return {
        ...prev,
        path: moved.to,
        id: vaultPath ? toVaultRelative(moved.to, vaultPath) : prev.id,
        name: getBaseName(moved.to).replace(/\.md$/i, ""),
      };
    });
  }, [onActiveNoteMoved, vaultPath]);

  const handleWatchedMarkdownChange = useCallback(async (changedPaths: string[]) => {
    if (vaultPath) {
      setNoteIndex((prev) =>
        changedPaths.reduce((acc, path) => upsertNoteIndex(acc, path, vaultPath), prev));
    }
    await onFileChange(changedPaths);
  }, [onFileChange, vaultPath]);

  const handleSelectNote = useCallback(async (node: TreeNode) => {
    if (node.kind !== "file") return;
    if (!isMarkdownPath(node.path)) {
      clearActiveNote();
      setActiveNonMarkdownFile(node);
      return;
    }

    setActiveNonMarkdownFile(null);
    await handleSelectMarkdownNote(node);
  }, [clearActiveNote, handleSelectMarkdownNote]);

  const handleLoadFolder = useCallback(
    async (folderPath: string) => {
      if (!vaultPath) return;
      if (loadingFoldersRef.current.has(folderPath)) return;

      const existing = findTreeNode(tree, folderPath);
      if (!existing || existing.kind !== "folder") return;
      if (existing.loaded !== false && !existing.dirty) return;

      loadingFoldersRef.current.add(folderPath);
      try {
        const children = await scanFolderChildren(folderPath, vaultPath);
        setTree((prev) => replaceFolderChildren(prev, folderPath, children));
      } catch (err) {
        options?.onError?.(
          `Failed to load folder (${folderPath}): ${formatError(err, "unknown error")}`,
        );
      } finally {
        loadingFoldersRef.current.delete(folderPath);
      }
    },
    [options?.onError, tree, vaultPath],
  );

  useFileWatcher({
    vaultPath,
    setTree,
    onFileChange: handleWatchedMarkdownChange,
    onPathsRemoved: handlePathsRemoved,
    onPathsMoved: handlePathsMoved,
    onError: options?.onError,
  });

  const {
    handleSaveNote: handleSaveNoteFromOps,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleDelete,
    handleMove,
    handleNavigateToNote,
  } = useFileOps({
    vaultPath,
    tree,
    noteIndex,
    setTree,
    setNoteIndex,
    onSelectNote: handleSelectNote,
    onPathsRemoved: handlePathsRemoved,
    onPathsMoved: handlePathsMoved,
    onError: options?.onError,
  });

  const handleSaveNote = useCallback(
    async (path: string, content: string) =>
      handleSaveWithGuards(path, content, handleSaveNoteFromOps),
    [handleSaveWithGuards, handleSaveNoteFromOps],
  );

  const loadVault = useCallback(
    async (path: string) => {
      try {
        setTree(await scanVault(path));
        setNoteIndex([]);
        void refreshNoteIndex(path);
      } catch (err) {
        options?.onError?.(`Failed to scan vault: ${formatError(err, "unknown error")}`);
      }
    },
    [options?.onError, refreshNoteIndex],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const [path, history] = await Promise.all([
        getVaultPath(),
        getVaultHistory(),
      ]);
      if (!active) return;
      setVaultHistory(history);
      if (path) {
        setVaultPathState(path);
        await loadVault(path);
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [loadVault]);

  const switchVault = useCallback(
    async (path: string) => {
      clearActiveNote();
      setActiveNonMarkdownFile(null);
      noteIndexScanSeqRef.current += 1;
      await setVaultPath(path);
      setVaultPathState(path);
      setVaultHistory(await getVaultHistory());
      await loadVault(path);
    },
    [clearActiveNote, loadVault],
  );

  const handleRemoveFromHistory = useCallback(async (path: string) => {
    await removeFromHistory(path);
    setVaultHistory(await getVaultHistory());
  }, []);

  return {
    vaultPath,
    vaultHistory,
    tree,
    noteIndex,
    activeNote,
    activeNonMarkdownFile,
    loading,
    switchVault,
    handleRemoveFromHistory,
    handleSelectNote,
    handleLoadFolder,
    handleEditorBufferChange,
    handleSaveNote,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleDelete,
    handleMove,
    handleNavigateToNote,
  } as const;
}
