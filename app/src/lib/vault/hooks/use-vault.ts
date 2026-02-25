import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteContent, TreeNode } from "../../types";
import { scanVault } from "../modules/note-index";
import {
  getVaultHistory,
  getVaultPath,
  removeFromHistory,
  setVaultPath,
} from "../modules/store";
import { useFileWatcher } from "./use-file-watcher";
import { useFileOps } from "./use-file-ops";

interface UseVaultOptions {
  onError?: (msg: string) => void;
}

export function useVault(options?: UseVaultOptions) {
  const [vaultPath, setVaultPathState] = useState<string | null>(null);
  const [vaultHistory, setVaultHistory] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [activeNote, setActiveNote] = useState<NoteContent | null>(null);
  const [loading, setLoading] = useState(true);

  // --- Sub-hooks ---

  useFileWatcher({
    vaultPath,
    setTree,
    // onFileChange: stableOnFileChange,
    onError: options?.onError,
  });

  const fileOps = useFileOps({
    vaultPath,
    tree,
    activeNote,
    setTree,
    setActiveNote,
    onError: options?.onError,
  });

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

  // --- Mount: restore persisted vault ---

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

  // --- Actions ---

  const switchVault = useCallback(
    async (path: string) => {
      setActiveNote(null);
      await setVaultPath(path);
      setVaultPathState(path);
      setVaultHistory(await getVaultHistory());
      await scan(path);
    },
    [scan],
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
    ...fileOps,
  } as const;
}
