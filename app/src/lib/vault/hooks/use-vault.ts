import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteContent, TreeNode } from "../../types";
import { getBaseName, isPathInside, pathsEqual, toVaultRelative } from "../../path-utils";
import { scanVault } from "../modules/note-index";
import { readNote } from "../modules/note-persistence";
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

  const docKeyCounter = useRef(0);

  const onFileChange = useCallback(async (changedPaths: string[]) => {
    if (!activeNote) return;
    const match = changedPaths.some((p) => pathsEqual(p, activeNote.path));
    if (!match) return;
    try {
      const body = await readNote(activeNote.path);
      if (body !== activeNote.body) {
        docKeyCounter.current += 1;
        setActiveNote({ ...activeNote, body, docKey: docKeyCounter.current });
      }
    } catch {
      // File may have been deleted; ignore
    }
  }, [activeNote, setActiveNote]);

  const onPathsRemoved = useCallback((removedPaths: string[]) => {
    if (!removedPaths.length) return;
    setActiveNote((current) => {
      if (!current) return current;
      const deleted = removedPaths.some((p) => isPathInside(current.path, p));
      return deleted ? null : current;
    });
  }, [setActiveNote]);

  const onPathsMoved = useCallback((moves: Array<{ from: string; to: string }>) => {
    if (!moves.length) return;
    setActiveNote((current) => {
      if (!current) return current;

      let next = current;
      for (const move of moves) {
        if (!isPathInside(next.path, move.from)) continue;
        const suffix = next.path.substring(move.from.length);
        const updatedPath = `${move.to}${suffix}`;
        next = {
          ...next,
          path: updatedPath,
          id: vaultPath ? toVaultRelative(updatedPath, vaultPath) : next.id,
          name: pathsEqual(next.path, move.from)
            ? getBaseName(updatedPath).replace(/\.md$/i, "")
            : next.name,
        };
      }
      return next;
    });
  }, [setActiveNote, vaultPath]);

  // --- Sub-hooks ---

  useFileWatcher({
    vaultPath,
    setTree,
    onFileChange,
    onPathsRemoved,
    onPathsMoved,
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
