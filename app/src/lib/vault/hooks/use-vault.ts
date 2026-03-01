import { useCallback, useEffect, useState } from "react";
import type { TreeNode } from "../../types";
import { scanVault } from "../modules/note-index";
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

export function useVault(options?: UseVaultOptions) {
  const [vaultPath, setVaultPathState] = useState<string | null>(null);
  const [vaultHistory, setVaultHistory] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  const {
    activeNote,
    handleSelectNote,
    handleEditorBufferChange,
    onFileChange,
    onPathsRemoved,
    onPathsMoved,
    handleSaveWithGuards,
    clearActiveNote,
  } = useActiveNoteSync({
    vaultPath,
    onError: options?.onError,
  });

  useFileWatcher({
    vaultPath,
    setTree,
    onFileChange,
    onPathsRemoved,
    onPathsMoved,
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
    setTree,
    onSelectNote: handleSelectNote,
    onPathsRemoved,
    onPathsMoved,
    onError: options?.onError,
  });

  const handleSaveNote = useCallback(
    async (path: string, content: string) =>
      handleSaveWithGuards(path, content, handleSaveNoteFromOps),
    [handleSaveWithGuards, handleSaveNoteFromOps],
  );

  const scan = useCallback(
    async (path: string) => {
      try {
        setTree(await scanVault(path));
      } catch (err) {
        options?.onError?.(
          err instanceof Error ? err.message : "Failed to scan vault",
        );
      }
    },
    [options?.onError],
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
        await scan(path);
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [scan]);

  const switchVault = useCallback(
    async (path: string) => {
      clearActiveNote();
      await setVaultPath(path);
      setVaultPathState(path);
      setVaultHistory(await getVaultHistory());
      await scan(path);
    },
    [clearActiveNote, scan],
  );

  const handleRemoveFromHistory = useCallback(async (path: string) => {
    await removeFromHistory(path);
    setVaultHistory(await getVaultHistory());
  }, []);

  return {
    vaultPath,
    vaultHistory,
    tree,
    activeNote,
    loading,
    switchVault,
    handleRemoveFromHistory,
    handleSelectNote,
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
