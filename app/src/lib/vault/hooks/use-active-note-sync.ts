import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteContent, TreeNode } from "../../types";
import {
  getBaseName,
  isPathInside,
  pathsEqual,
  toVaultRelative,
} from "../../path-utils";
import { readNote } from "../modules/note-persistence";
import { applyPathMoves, rebasePath, type PathMove } from "../modules/note-tabs";

interface UseActiveNoteSyncOptions {
  vaultPath: string | null;
  onError?: (msg: string) => void;
}

interface RuntimeRefState {
  activeNote: NoteContent | null;
  missingPaths: string[];
  pathRedirects: PathMove[];
  save: {
    saving: boolean;
    path: string | null;
    pendingExternalChange: boolean;
  };
  editor: {
    path: string | null;
    buffer: string;
    savedBody: string;
    dirty: boolean;
    externalChangeNotified: boolean;
  };
  selfSaveJournal: Array<{
    path: string;
    body: string;
    expiresAt: number;
    remainingHits: number;
  }>;
}

const SELF_SAVE_JOURNAL_TTL_MS = 2500;
const SELF_SAVE_JOURNAL_HITS = 4;

function logActiveSyncDev(label: string, payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.debug(`[active-sync] ${label}`, payload);
}

export function useActiveNoteSync({
  vaultPath,
  onError,
}: UseActiveNoteSyncOptions) {
  const [activeNote, setActiveNote] = useState<NoteContent | null>(null);
  const docKeyCounter = useRef(0);
  const runtimeRef = useRef<RuntimeRefState>({
    activeNote: null,
    missingPaths: [],
    pathRedirects: [],
    save: {
      saving: false,
      path: null,
      pendingExternalChange: false,
    },
    editor: {
      path: null,
      buffer: "",
      savedBody: "",
      dirty: false,
      externalChangeNotified: false,
    },
    selfSaveJournal: [],
  });
  const eventSeqRef = useRef(0);
  const selectionSeqRef = useRef(0);

  const resolveCurrentPath = useCallback((path: string): string => {
    return applyPathMoves(path, runtimeRef.current.pathRedirects);
  }, []);

  const clearAvailablePath = useCallback((availablePath: string) => {
    runtimeRef.current.missingPaths = runtimeRef.current.missingPaths.filter(
      (missingPath) => !isPathInside(availablePath, missingPath),
    );
    runtimeRef.current.pathRedirects = runtimeRef.current.pathRedirects.filter(
      (redirect) => !isPathInside(availablePath, redirect.from),
    );
  }, []);

  const isSaveBlocked = useCallback((path: string): boolean => {
    return runtimeRef.current.missingPaths.some((missingPath) =>
      isPathInside(path, missingPath));
  }, []);

  const sweepSelfSaveJournal = useCallback(() => {
    const now = Date.now();
    runtimeRef.current.selfSaveJournal = runtimeRef.current.selfSaveJournal.filter(
      (entry) => entry.expiresAt > now && entry.remainingHits > 0,
    );
  }, []);

  const recordSelfSave = useCallback((path: string, body: string) => {
    sweepSelfSaveJournal();
    const now = Date.now();
    const journal = runtimeRef.current.selfSaveJournal;
    const idx = journal.findIndex((entry) => pathsEqual(entry.path, path));
    const nextEntry = {
      path,
      body,
      expiresAt: now + SELF_SAVE_JOURNAL_TTL_MS,
      remainingHits: SELF_SAVE_JOURNAL_HITS,
    };
    if (idx >= 0) {
      journal[idx] = nextEntry;
    } else {
      journal.push(nextEntry);
    }
    logActiveSyncDev("journal-recorded", {
      path,
      ttlMs: SELF_SAVE_JOURNAL_TTL_MS,
      remainingHits: SELF_SAVE_JOURNAL_HITS,
    });
  }, [sweepSelfSaveJournal]);

  const consumeSelfSaveIfMatched = useCallback((path: string, body: string): boolean => {
    sweepSelfSaveJournal();
    const journal = runtimeRef.current.selfSaveJournal;
    const idx = journal.findIndex((entry) => pathsEqual(entry.path, path) && entry.body === body);
    if (idx < 0) return false;

    const entry = journal[idx];
    entry.remainingHits -= 1;
    if (entry.remainingHits <= 0) {
      journal.splice(idx, 1);
    }
    logActiveSyncDev("journal-consumed", {
      path,
      remainingHits: Math.max(entry.remainingHits, 0),
    });
    return true;
  }, [sweepSelfSaveJournal]);

  useEffect(() => {
    runtimeRef.current.activeNote = activeNote;
  }, [activeNote]);

  const handleSelectNote = useCallback(
    async (node: TreeNode): Promise<NoteContent | null> => {
      if (node.kind !== "file") return null;
      const selectionSeq = ++selectionSeqRef.current;
      try {
        let readPath = resolveCurrentPath(node.path);
        const unavailableAtStart = isSaveBlocked(readPath);
        let body: string;
        try {
          body = await readNote(readPath);
        } catch (initialError) {
          const redirectedPath = resolveCurrentPath(node.path);
          if (pathsEqual(redirectedPath, readPath)) throw initialError;
          readPath = redirectedPath;
          body = await readNote(redirectedPath);
        }
        if (selectionSeq !== selectionSeqRef.current) return null;
        const currentPath = resolveCurrentPath(node.path);
        if (!unavailableAtStart && isSaveBlocked(currentPath)) return null;
        clearAvailablePath(currentPath);
        docKeyCounter.current += 1;
        const nextNote: NoteContent = {
          id: vaultPath ? toVaultRelative(currentPath, vaultPath) : node.id,
          path: currentPath,
          name: pathsEqual(currentPath, node.path)
            ? node.name
            : getBaseName(currentPath).replace(/\.md$/i, ""),
          body,
          docKey: docKeyCounter.current,
        };
        runtimeRef.current.activeNote = nextNote;
        setActiveNote(nextNote);
        runtimeRef.current.editor.path = currentPath;
        runtimeRef.current.editor.buffer = body;
        runtimeRef.current.editor.savedBody = body;
        runtimeRef.current.editor.dirty = false;
        runtimeRef.current.editor.externalChangeNotified = false;
        runtimeRef.current.save.saving = false;
        runtimeRef.current.save.path = null;
        runtimeRef.current.save.pendingExternalChange = false;
        logActiveSyncDev("select-note", {
          path: currentPath,
          docKey: docKeyCounter.current,
        });
        return nextNote;
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Failed to read note");
        return null;
      }
    },
    [clearAvailablePath, isSaveBlocked, onError, resolveCurrentPath, vaultPath],
  );

  const onFileChange = useCallback(
    async (changedPaths: string[]) => {
      eventSeqRef.current += 1;
      const eventId = eventSeqRef.current;
      const current = runtimeRef.current.activeNote;
      if (!current) {
        logActiveSyncDev("skip-no-active-note", { eventId, changedPaths });
        return;
      }
      const match = changedPaths.some((p) =>
        pathsEqual(resolveCurrentPath(p), current.path));
      if (!match) {
        logActiveSyncDev("skip-non-target", {
          eventId,
          activePath: current.path,
          changedPaths,
        });
        return;
      }

      const { save } = runtimeRef.current;
      if (save.saving && save.path && pathsEqual(save.path, current.path)) {
        save.pendingExternalChange = true;
        logActiveSyncDev("skip-saving", {
          eventId,
          path: current.path,
          pendingExternalChange: save.pendingExternalChange,
        });
        return;
      }

      try {
        const body = await readNote(current.path);
        clearAvailablePath(current.path);
        const latest = runtimeRef.current.activeNote;
        if (!latest || !pathsEqual(latest.path, current.path)) return;

        const editor = runtimeRef.current.editor;
        if (!editor.path || !pathsEqual(editor.path, latest.path)) {
          editor.path = latest.path;
          editor.buffer = latest.body;
          editor.savedBody = latest.body;
          editor.dirty = false;
        }

        // Self-save or already-synced state: no remount/reload.
        if (body === editor.buffer) {
          editor.savedBody = body;
          editor.dirty = false;
          editor.externalChangeNotified = false;
          save.pendingExternalChange = false;
          logActiveSyncDev("skip-self-save", {
            eventId,
            path: latest.path,
            dirty: editor.dirty,
          });
          return;
        }

        // Self-save journal handles delayed watch events after the user typed again.
        if (consumeSelfSaveIfMatched(latest.path, body)) {
          save.pendingExternalChange = false;
          logActiveSyncDev("skip-self-save-journal", {
            eventId,
            path: latest.path,
            dirty: editor.dirty,
          });
          return;
        }

        // Phase2: avoid clobbering in-memory edits.
        if (editor.dirty) {
          save.pendingExternalChange = true;
          logActiveSyncDev("skip-dirty", {
            eventId,
            path: latest.path,
            pendingExternalChange: save.pendingExternalChange,
          });
          if (!editor.externalChangeNotified) {
            onError?.(
              "External file change detected. Reload skipped to keep your unsaved edits.",
            );
            editor.externalChangeNotified = true;
          }
          return;
        }

        if (body !== latest.body) {
          docKeyCounter.current += 1;
          const nextNote = { ...latest, body, docKey: docKeyCounter.current };
          runtimeRef.current.activeNote = nextNote;
          setActiveNote(nextNote);
          editor.path = latest.path;
          editor.buffer = body;
          editor.savedBody = body;
          editor.dirty = false;
          editor.externalChangeNotified = false;
          save.pendingExternalChange = false;
          logActiveSyncDev("reload-applied", {
            eventId,
            path: latest.path,
            docKey: docKeyCounter.current,
          });
          return;
        }
        logActiveSyncDev("skip-no-change", { eventId, path: latest.path });
      } catch {
        // File may have been deleted; ignore
        logActiveSyncDev("read-failed", { eventId, path: current.path });
      }
    },
    [clearAvailablePath, consumeSelfSaveIfMatched, onError, resolveCurrentPath],
  );

  const handleEditorBufferChange = useCallback((path: string, content: string) => {
    const current = runtimeRef.current.activeNote;
    const resolvedPath = resolveCurrentPath(path);
    if (!current || !pathsEqual(current.path, resolvedPath)) return;

    const editor = runtimeRef.current.editor;
    const saveState = runtimeRef.current.save;
    const prevDirty = editor.dirty;
    editor.path = resolvedPath;
    editor.buffer = content;
    editor.dirty = content !== editor.savedBody;
    if (prevDirty !== editor.dirty) {
      logActiveSyncDev("dirty-changed", {
        path: current.path,
        dirty: editor.dirty,
      });
    }
    if (!editor.dirty) {
      editor.externalChangeNotified = false;
      if (saveState.pendingExternalChange && !saveState.saving) {
        saveState.pendingExternalChange = false;
        logActiveSyncDev("consume-pending-external-change", { path: current.path });
        void onFileChange([resolvedPath]);
      }
    }
  }, [onFileChange, resolveCurrentPath]);

  const onPathsUnavailable = useCallback((unavailablePaths: string[]) => {
    if (!unavailablePaths.length) return;
    runtimeRef.current.missingPaths = [
      ...runtimeRef.current.missingPaths,
      ...unavailablePaths.filter(
        (path) => !runtimeRef.current.missingPaths.some((existing) => pathsEqual(existing, path)),
      ),
    ];
  }, []);

  const onPathsRemoved = useCallback((removedPaths: string[]) => {
    if (!removedPaths.length) return;
    onPathsUnavailable(removedPaths);

    const current = runtimeRef.current.activeNote;
    if (!current) return;
    const deleted = removedPaths.some((p) => isPathInside(current.path, p));
    if (!deleted) return;

    const editor = runtimeRef.current.editor;
    const next = editor.path && pathsEqual(editor.path, current.path)
      ? { ...current, body: editor.buffer }
      : current;
    runtimeRef.current.activeNote = next;
    setActiveNote(next);
    logActiveSyncDev("active-note-missing", { removedPaths });
  }, [onPathsUnavailable]);

  const onPathsAvailable = useCallback((availablePaths: string[]) => {
    if (!availablePaths.length) return;
    for (const path of availablePaths) {
      clearAvailablePath(path);
    }
  }, [clearAvailablePath]);

  const onPathsMoved = useCallback(
    (moves: Array<{ from: string; to: string }>) => {
      if (!moves.length) return;

      for (const move of moves) {
        runtimeRef.current.pathRedirects = runtimeRef.current.pathRedirects.map(
          (redirect) => ({
            ...redirect,
            to: rebasePath(redirect.to, move) ?? redirect.to,
          }),
        );
        runtimeRef.current.pathRedirects = runtimeRef.current.pathRedirects.filter(
          (redirect) => !pathsEqual(redirect.from, move.from),
        );
        runtimeRef.current.pathRedirects.push(move);
        runtimeRef.current.missingPaths = runtimeRef.current.missingPaths.filter(
          (missingPath) => !isPathInside(missingPath, move.from),
        );
      }

      runtimeRef.current.selfSaveJournal = runtimeRef.current.selfSaveJournal.map((entry) => ({
        ...entry,
        path: applyPathMoves(entry.path, moves),
      }));

      const editor = runtimeRef.current.editor;
      const saveState = runtimeRef.current.save;
      if (editor.path) {
        for (const move of moves) {
          if (!isPathInside(editor.path, move.from)) continue;
          const suffix = editor.path.substring(move.from.length);
          editor.path = `${move.to}${suffix}`;
        }
      }
      if (saveState.path) {
        for (const move of moves) {
          if (!isPathInside(saveState.path, move.from)) continue;
          const suffix = saveState.path.substring(move.from.length);
          saveState.path = `${move.to}${suffix}`;
        }
      }

      const current = runtimeRef.current.activeNote;
      if (!current) return;

      const updatedPath = applyPathMoves(current.path, moves);
      const next = pathsEqual(updatedPath, current.path)
        ? current
        : {
            ...current,
            path: updatedPath,
            id: vaultPath ? toVaultRelative(updatedPath, vaultPath) : current.id,
            name: getBaseName(updatedPath).replace(/\.md$/i, ""),
            body: editor.path && pathsEqual(editor.path, updatedPath)
              ? editor.buffer
              : current.body,
          };
      if (next === current) return;
      runtimeRef.current.activeNote = next;
      setActiveNote(next);
      logActiveSyncDev("active-note-rebased", {
        from: current.path,
        to: next.path,
      });
    },
    [vaultPath],
  );

  const handleSaveWithGuards = useCallback(
    async (
      path: string,
      content: string,
      save: (pathArg: string, contentArg: string) => Promise<void>,
    ) => {
      const targetPath = resolveCurrentPath(path);
      if (isSaveBlocked(targetPath)) {
        logActiveSyncDev("save-paused-missing", { path, targetPath });
        return;
      }

      const current = runtimeRef.current.activeNote;
      const saveState = runtimeRef.current.save;
      const isActiveTarget = Boolean(current && pathsEqual(targetPath, current.path));

      if (isActiveTarget) {
        saveState.saving = true;
        saveState.path = targetPath;
        saveState.pendingExternalChange = false;
        runtimeRef.current.editor.path = targetPath;
        runtimeRef.current.editor.buffer = content;
        runtimeRef.current.editor.dirty = content !== runtimeRef.current.editor.savedBody;
        logActiveSyncDev("save-started", {
          path: targetPath,
          dirty: runtimeRef.current.editor.dirty,
        });
      }

      try {
        await save(targetPath, content);
      } catch (err) {
        if (isActiveTarget) {
          saveState.saving = false;
          saveState.path = null;
          saveState.pendingExternalChange = false;
          logActiveSyncDev("save-failed", { path: targetPath });
        }
        throw err;
      }

      if (!isActiveTarget) return;

      const editor = runtimeRef.current.editor;
      editor.savedBody = content;
      editor.dirty = editor.buffer !== editor.savedBody;
      if (!editor.dirty) {
        editor.externalChangeNotified = false;
      }
      recordSelfSave(targetPath, content);

      const pending = saveState.pendingExternalChange;
      saveState.saving = false;
      saveState.path = null;
      saveState.pendingExternalChange = pending && editor.dirty;
      logActiveSyncDev("save-completed", {
        path: targetPath,
        pendingExternalChange: pending,
        dirty: editor.dirty,
      });

      if (!pending || editor.dirty) return;
      await onFileChange([targetPath]);
    },
    [isSaveBlocked, onFileChange, recordSelfSave, resolveCurrentPath],
  );

  const clearActiveNote = useCallback(() => {
    selectionSeqRef.current += 1;
    runtimeRef.current.activeNote = null;
    setActiveNote(null);
    runtimeRef.current.save.saving = false;
    runtimeRef.current.save.path = null;
    runtimeRef.current.save.pendingExternalChange = false;
    runtimeRef.current.editor.path = null;
    runtimeRef.current.editor.buffer = "";
    runtimeRef.current.editor.savedBody = "";
    runtimeRef.current.editor.dirty = false;
    runtimeRef.current.editor.externalChangeNotified = false;
    logActiveSyncDev("active-note-cleared", {});
  }, []);

  const resetNoteSession = useCallback(() => {
    clearActiveNote();
    runtimeRef.current.missingPaths = [];
    runtimeRef.current.pathRedirects = [];
    runtimeRef.current.selfSaveJournal = [];
    logActiveSyncDev("note-session-reset", {});
  }, [clearActiveNote]);

  const getActiveNoteSnapshot = useCallback((): NoteContent | null => {
    const current = runtimeRef.current.activeNote;
    if (!current) return null;

    const editor = runtimeRef.current.editor;
    if (!editor.path || !pathsEqual(editor.path, current.path)) {
      return current;
    }

    return {
      ...current,
      body: editor.buffer,
    };
  }, []);

  const commitActiveNoteBufferToState = useCallback(() => {
    const current = runtimeRef.current.activeNote;
    if (!current) return;

    const editor = runtimeRef.current.editor;
    if (!editor.path || !pathsEqual(editor.path, current.path)) return;
    if (current.body === editor.buffer) return;

    const next = {
      ...current,
      body: editor.buffer,
    };
    runtimeRef.current.activeNote = next;
    setActiveNote(next);
  }, []);

  return {
    activeNote,
    getActiveNoteSnapshot,
    commitActiveNoteBufferToState,
    handleSelectNote,
    handleEditorBufferChange,
    onFileChange,
    onPathsUnavailable,
    onPathsRemoved,
    onPathsAvailable,
    onPathsMoved,
    handleSaveWithGuards,
    clearActiveNote,
    resetNoteSession,
  } as const;
}
