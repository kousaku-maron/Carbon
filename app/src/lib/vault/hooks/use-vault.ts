import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteIndexEntry, OpenNoteTab, TreeNode } from "../../types";
import { isMarkdownPath } from "../../file-kind";
import { getBaseName, isPathInside, pathsEqual, toVaultRelative } from "../../path-utils";
import { relocateInNoteIndex, removeFromNoteIndex, scanNoteIndex, upsertNoteIndex } from "../modules/note-catalog";
import { findTreeNode, replaceFolderChildren, scanFolderChildren, scanVault } from "../modules/note-index";
import {
  applyPathMoves,
  chooseActiveTabAfterRemoval,
  createOpenNoteTab,
  findOpenNoteTabByPath,
  markOpenNoteTabsAvailable,
  markOpenNoteTabsMissing,
  relocateOpenNoteTabs,
  removeOpenNoteTabs,
  reorderOpenNoteTabs,
} from "../modules/note-tabs";
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
  const [openNoteTabs, setOpenNoteTabsState] = useState<OpenNoteTab[]>([]);
  const [activeNoteTabKey, setActiveNoteTabKeyState] = useState<number | null>(null);
  const [activeNonMarkdownFile, setActiveNonMarkdownFile] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingFoldersRef = useRef(new Set<string>());
  const noteIndexScanSeqRef = useRef(0);
  const openNoteTabsRef = useRef<OpenNoteTab[]>([]);
  const activeNoteTabKeyRef = useRef<number | null>(null);
  const noteTabKeyCounterRef = useRef(0);

  const replaceOpenNoteTabs = useCallback((next: OpenNoteTab[]) => {
    openNoteTabsRef.current = next;
    setOpenNoteTabsState(next);
  }, []);

  const replaceActiveNoteTabKey = useCallback((next: number | null) => {
    activeNoteTabKeyRef.current = next;
    setActiveNoteTabKeyState(next);
  }, []);

  const {
    activeNote,
    getActiveNoteSnapshot,
    commitActiveNoteBufferToState,
    handleSelectNote: handleSelectMarkdownNote,
    handleEditorBufferChange,
    onFileChange,
    onPathsUnavailable: blockUnavailablePaths,
    onPathsRemoved: markActiveNoteMissing,
    onPathsAvailable: markActiveNoteAvailable,
    onPathsMoved: onActiveNoteMoved,
    handleSaveWithGuards,
    clearActiveNote,
    resetNoteSession,
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

  const loadOpenNoteTab = useCallback(async (tab: OpenNoteTab): Promise<boolean> => {
    if (tab.status === "missing") return false;
    const loaded = await handleSelectMarkdownNote({
      id: tab.id,
      path: tab.path,
      name: tab.name,
      kind: "file",
    });
    if (!loaded) return false;

    const nextTabs = openNoteTabsRef.current.map((item) =>
      item.tabKey === tab.tabKey
        ? {
            ...item,
            id: loaded.id,
            path: loaded.path,
            name: loaded.name,
            status: "ready" as const,
          }
        : item,
    );
    replaceOpenNoteTabs(nextTabs);
    return true;
  }, [handleSelectMarkdownNote, replaceOpenNoteTabs]);

  const handleActivateNoteTab = useCallback(async (tabKey: number) => {
    const tab = openNoteTabsRef.current.find((item) => item.tabKey === tabKey);
    if (!tab) return;

    const current = getActiveNoteSnapshot();
    if (
      activeNoteTabKeyRef.current === tabKey &&
      (tab.status === "missing" || (current && pathsEqual(current.path, tab.path)))
    ) {
      return;
    }

    commitActiveNoteBufferToState();
    clearActiveNote();
    setActiveNonMarkdownFile(null);
    replaceActiveNoteTabKey(tabKey);
    if (tab.status === "ready") {
      await loadOpenNoteTab(tab);
    }
  }, [
    clearActiveNote,
    commitActiveNoteBufferToState,
    getActiveNoteSnapshot,
    loadOpenNoteTab,
    replaceActiveNoteTabKey,
  ]);

  const activateAdjacentTab = useCallback((tabKey: number | null) => {
    replaceActiveNoteTabKey(tabKey);
    if (tabKey === null) return;
    const nextTab = openNoteTabsRef.current.find((tab) => tab.tabKey === tabKey);
    if (nextTab?.status === "ready") {
      void loadOpenNoteTab(nextTab);
    }
  }, [loadOpenNoteTab, replaceActiveNoteTabKey]);

  const handleCloseNoteTab = useCallback((tabKey: number) => {
    const previousTabs = openNoteTabsRef.current;
    const closing = previousTabs.find((tab) => tab.tabKey === tabKey);
    if (!closing) return;

    const nextTabs = previousTabs.filter((tab) => tab.tabKey !== tabKey);
    const previousActiveKey = activeNoteTabKeyRef.current;
    const nextActiveKey = chooseActiveTabAfterRemoval(
      previousTabs,
      nextTabs,
      previousActiveKey,
    );
    replaceOpenNoteTabs(nextTabs);

    if (previousActiveKey !== tabKey) return;
    commitActiveNoteBufferToState();
    clearActiveNote();
    activateAdjacentTab(nextActiveKey);
  }, [
    activateAdjacentTab,
    clearActiveNote,
    commitActiveNoteBufferToState,
    replaceOpenNoteTabs,
  ]);

  const handleReorderNoteTab = useCallback((
    sourceTabKey: number,
    targetTabKey: number,
    placement: "before" | "after",
  ) => {
    replaceOpenNoteTabs(
      reorderOpenNoteTabs(
        openNoteTabsRef.current,
        sourceTabKey,
        targetTabKey,
        placement,
      ),
    );
  }, [replaceOpenNoteTabs]);

  const updateRemovedIndexesAndPreview = useCallback((removedPaths: string[]) => {
    setNoteIndex((prev) =>
      removedPaths.reduce((acc, path) => removeFromNoteIndex(acc, path), prev));
    setActiveNonMarkdownFile((prev) => {
      if (!prev) return prev;
      const removed = removedPaths.some((removedPath) => isPathInside(prev.path, removedPath));
      return removed ? null : prev;
    });
  }, []);

  const handleWatchedPathsRemoved = useCallback((removedPaths: string[]) => {
    markActiveNoteMissing(removedPaths);
    replaceOpenNoteTabs(markOpenNoteTabsMissing(openNoteTabsRef.current, removedPaths));
    updateRemovedIndexesAndPreview(removedPaths);
  }, [markActiveNoteMissing, replaceOpenNoteTabs, updateRemovedIndexesAndPreview]);

  const handleDeletedPaths = useCallback((removedPaths: string[]) => {
    // Block any editor cleanup save before removing the tabs, otherwise a deleted
    // file can be recreated by a pending Auto Save.
    markActiveNoteMissing(removedPaths);
    updateRemovedIndexesAndPreview(removedPaths);

    const previousTabs = openNoteTabsRef.current;
    const nextTabs = removeOpenNoteTabs(previousTabs, removedPaths);
    const previousActiveKey = activeNoteTabKeyRef.current;
    const nextActiveKey = chooseActiveTabAfterRemoval(
      previousTabs,
      nextTabs,
      previousActiveKey,
    );
    replaceOpenNoteTabs(nextTabs);

    if (nextActiveKey === previousActiveKey) return;
    commitActiveNoteBufferToState();
    clearActiveNote();
    activateAdjacentTab(nextActiveKey);
  }, [
    activateAdjacentTab,
    clearActiveNote,
    commitActiveNoteBufferToState,
    markActiveNoteMissing,
    replaceOpenNoteTabs,
    updateRemovedIndexesAndPreview,
  ]);

  const handlePathsMoved = useCallback((moves: Array<{ from: string; to: string }>) => {
    onActiveNoteMoved(moves);
    if (vaultPath) {
      replaceOpenNoteTabs(relocateOpenNoteTabs(openNoteTabsRef.current, moves, vaultPath));
    }
    setNoteIndex((prev) =>
      moves.reduce(
        (acc, move) => vaultPath ? relocateInNoteIndex(acc, move.from, move.to, vaultPath) : acc,
        prev,
      ));
    setActiveNonMarkdownFile((prev) => {
      if (!prev) return prev;
      const nextPath = applyPathMoves(prev.path, moves);
      if (pathsEqual(nextPath, prev.path)) return prev;
      return {
        ...prev,
        path: nextPath,
        id: vaultPath ? toVaultRelative(nextPath, vaultPath) : prev.id,
        name: getBaseName(nextPath).replace(/\.md$/i, ""),
      };
    });

    const activeKey = activeNoteTabKeyRef.current;
    const activeTab = activeKey === null
      ? null
      : openNoteTabsRef.current.find((tab) => tab.tabKey === activeKey) ?? null;
    if (activeTab?.status === "ready" && !getActiveNoteSnapshot()) {
      void loadOpenNoteTab(activeTab);
    }
  }, [
    getActiveNoteSnapshot,
    loadOpenNoteTab,
    onActiveNoteMoved,
    replaceOpenNoteTabs,
    vaultPath,
  ]);

  const handlePathsAvailable = useCallback((availablePaths: string[]) => {
    markActiveNoteAvailable(availablePaths);
    const previousTabs = openNoteTabsRef.current;
    const activeKey = activeNoteTabKeyRef.current;
    const activeWasMissing = activeKey !== null && previousTabs.some(
      (tab) => tab.tabKey === activeKey && tab.status === "missing" &&
        availablePaths.some((path) => pathsEqual(tab.path, path)),
    );
    const nextTabs = markOpenNoteTabsAvailable(previousTabs, availablePaths);
    replaceOpenNoteTabs(nextTabs);

    if (activeWasMissing && activeKey !== null && !getActiveNoteSnapshot()) {
      const activeTab = nextTabs.find((tab) => tab.tabKey === activeKey);
      if (activeTab) void loadOpenNoteTab(activeTab);
    }
  }, [
    getActiveNoteSnapshot,
    loadOpenNoteTab,
    markActiveNoteAvailable,
    replaceOpenNoteTabs,
  ]);

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
      commitActiveNoteBufferToState();
      clearActiveNote();
      replaceActiveNoteTabKey(null);
      setActiveNonMarkdownFile(node);
      return;
    }

    setActiveNonMarkdownFile(null);
    const existing = findOpenNoteTabByPath(openNoteTabsRef.current, node.path);
    if (existing) {
      await handleActivateNoteTab(existing.tabKey);
      return;
    }

    commitActiveNoteBufferToState();
    clearActiveNote();
    replaceActiveNoteTabKey(null);
    const loaded = await handleSelectMarkdownNote(node);
    if (!loaded) return;

    noteTabKeyCounterRef.current += 1;
    const tab = createOpenNoteTab(
      {
        id: loaded.id,
        path: loaded.path,
        name: loaded.name,
        kind: "file",
      },
      noteTabKeyCounterRef.current,
    );
    replaceOpenNoteTabs([...openNoteTabsRef.current, tab]);
    replaceActiveNoteTabKey(tab.tabKey);
  }, [
    clearActiveNote,
    commitActiveNoteBufferToState,
    handleActivateNoteTab,
    handleSelectMarkdownNote,
    replaceActiveNoteTabKey,
    replaceOpenNoteTabs,
  ]);

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
    onPathsUnavailable: blockUnavailablePaths,
    onPathsRemoved: handleWatchedPathsRemoved,
    onPathsMoved: handlePathsMoved,
    onPathsAvailable: handlePathsAvailable,
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
    onPathsRemoved: handleDeletedPaths,
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
      commitActiveNoteBufferToState();
      resetNoteSession();
      replaceOpenNoteTabs([]);
      replaceActiveNoteTabKey(null);
      setActiveNonMarkdownFile(null);
      noteIndexScanSeqRef.current += 1;
      await setVaultPath(path);
      setVaultPathState(path);
      setVaultHistory(await getVaultHistory());
      await loadVault(path);
    },
    [
      commitActiveNoteBufferToState,
      loadVault,
      replaceActiveNoteTabKey,
      replaceOpenNoteTabs,
      resetNoteSession,
    ],
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
    openNoteTabs,
    activeNoteTabKey,
    activeNote,
    getActiveNoteSnapshot,
    commitActiveNoteBufferToState,
    activeNonMarkdownFile,
    loading,
    switchVault,
    handleRemoveFromHistory,
    handleSelectNote,
    handleActivateNoteTab,
    handleCloseNoteTab,
    handleReorderNoteTab,
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
