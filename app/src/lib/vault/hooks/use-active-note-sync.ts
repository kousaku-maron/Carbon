import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteContent, TreeNode } from "../../types";
import {
  getBaseName,
  isPathInside,
  pathsEqual,
  toVaultRelative,
} from "../../path-utils";
import { readNote } from "../modules/note-persistence";

interface UseActiveNoteSyncOptions {
  vaultPath: string | null;
  onError?: (msg: string) => void;
}

interface RuntimeRefState {
  activeNote: NoteContent | null;
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
    async (node: TreeNode) => {
      if (node.kind !== "file") return;
      try {
        const body = await readNote(node.path);
        docKeyCounter.current += 1;
        const nextNote: NoteContent = {
          id: node.id,
          path: node.path,
          name: node.name,
          body,
          docKey: docKeyCounter.current,
        };
        runtimeRef.current.activeNote = nextNote;
        setActiveNote(nextNote);
        runtimeRef.current.editor.path = node.path;
        runtimeRef.current.editor.buffer = body;
        runtimeRef.current.editor.savedBody = body;
        runtimeRef.current.editor.dirty = false;
        runtimeRef.current.editor.externalChangeNotified = false;
        runtimeRef.current.save.saving = false;
        runtimeRef.current.save.path = null;
        runtimeRef.current.save.pendingExternalChange = false;
        logActiveSyncDev("select-note", {
          path: node.path,
          docKey: docKeyCounter.current,
        });
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Failed to read note");
      }
    },
    [onError],
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
      const match = changedPaths.some((p) => pathsEqual(p, current.path));
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
    [consumeSelfSaveIfMatched, onError],
  );

  const handleEditorBufferChange = useCallback((path: string, content: string) => {
    const current = runtimeRef.current.activeNote;
    if (!current || !pathsEqual(current.path, path)) return;

    const editor = runtimeRef.current.editor;
    const saveState = runtimeRef.current.save;
    const prevDirty = editor.dirty;
    editor.path = current.path;
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
        void onFileChange([path]);
      }
    }
  }, [onFileChange]);

  const onPathsRemoved = useCallback((removedPaths: string[]) => {
    if (!removedPaths.length) return;
    const current = runtimeRef.current.activeNote;
    if (!current) return;
    const deleted = removedPaths.some((p) => isPathInside(current.path, p));
    if (!deleted) return;

    runtimeRef.current.activeNote = null;
    runtimeRef.current.save.saving = false;
    runtimeRef.current.save.path = null;
    runtimeRef.current.save.pendingExternalChange = false;
    runtimeRef.current.editor.path = null;
    runtimeRef.current.editor.buffer = "";
    runtimeRef.current.editor.savedBody = "";
    runtimeRef.current.editor.dirty = false;
    runtimeRef.current.editor.externalChangeNotified = false;
    logActiveSyncDev("active-note-removed", { removedPaths });
    setActiveNote(null);
  }, []);

  const onPathsMoved = useCallback(
    (moves: Array<{ from: string; to: string }>) => {
      if (!moves.length) return;

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
      const current = runtimeRef.current.activeNote;
      const saveState = runtimeRef.current.save;
      const isActiveTarget = Boolean(current && pathsEqual(path, current.path));

      if (isActiveTarget) {
        saveState.saving = true;
        saveState.path = path;
        saveState.pendingExternalChange = false;
        runtimeRef.current.editor.path = path;
        runtimeRef.current.editor.buffer = content;
        runtimeRef.current.editor.dirty = content !== runtimeRef.current.editor.savedBody;
        logActiveSyncDev("save-started", {
          path,
          dirty: runtimeRef.current.editor.dirty,
        });
      }

      try {
        await save(path, content);
      } catch (err) {
        if (isActiveTarget) {
          saveState.saving = false;
          saveState.path = null;
          saveState.pendingExternalChange = false;
          logActiveSyncDev("save-failed", { path });
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
      recordSelfSave(path, content);

      const pending = saveState.pendingExternalChange;
      saveState.saving = false;
      saveState.path = null;
      saveState.pendingExternalChange = pending && editor.dirty;
      logActiveSyncDev("save-completed", {
        path,
        pendingExternalChange: pending,
        dirty: editor.dirty,
      });

      if (!pending || editor.dirty) return;
      await onFileChange([path]);
    },
    [onFileChange, recordSelfSave],
  );

  const clearActiveNote = useCallback(() => {
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

  return {
    activeNote,
    handleSelectNote,
    handleEditorBufferChange,
    onFileChange,
    onPathsRemoved,
    onPathsMoved,
    handleSaveWithGuards,
    clearActiveNote,
  } as const;
}
