import { useCallback, useEffect, useMemo, useState } from "react";
import { listShares, republishShare, revokeShare } from "../../lib/api";
import { analyzeShareInput } from "../../lib/share/analyze-share-input";
import { buildShareFormData } from "../../lib/share/build-share-form-data";
import type { ShareSummary } from "../../lib/share/types";
import type { NoteIndexEntry } from "../../lib/types";
import { readNote } from "../../lib/vault/modules/note-persistence";
import { resolveShareSourceNoteLinkage } from "./share-linkage";

type SharePanelProps = {
  vaultPath: string | null;
  noteIndex: NoteIndexEntry[];
  onError?: (message: string) => void;
};

type ShareItemWithStatus = ShareSummary & {
  sourceNoteStatus: "linked" | "missing";
  noteEntry?: NoteIndexEntry;
};

export function SharePanel(props: SharePanelProps) {
  const { vaultPath, noteIndex, onError } = props;
  const [items, setItems] = useState<ShareSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const nextItems = await listShares({ status: "active" });
    setItems(nextItems);
  }, []);

  useEffect(() => {
    void refresh().catch((error) => {
      onError?.(error instanceof Error ? error.message : "Failed to load shares");
    });
  }, [onError, refresh]);

  const enrichedItems = useMemo<ShareItemWithStatus[]>(() => {
    return items.map((item) => {
      const { noteEntry, sourceNoteStatus } = resolveShareSourceNoteLinkage(item, noteIndex, vaultPath);
      return {
        ...item,
        sourceNoteStatus,
        noteEntry,
      };
    });
  }, [items, noteIndex, vaultPath]);

  const handleCopyLink = useCallback(async (share: ShareSummary) => {
    await navigator.clipboard.writeText(share.publicUrl);
  }, []);

  const handleRevoke = useCallback(async (share: ShareSummary) => {
    setBusyId(share.id);
    try {
      await revokeShare(share.id);
      await refresh();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Failed to revoke share");
    } finally {
      setBusyId(null);
    }
  }, [onError, refresh]);

  const handleRepublish = useCallback(async (share: ShareItemWithStatus) => {
    if (!vaultPath || !share.noteEntry) {
      onError?.("Source note is no longer linked to the current vault");
      return;
    }

    setBusyId(share.id);
    try {
      const markdownBody = await readNote(share.noteEntry.path);
      const analysis = analyzeShareInput({
        noteId: share.noteEntry.id,
        notePath: share.noteEntry.path,
        vaultPath,
        markdownBody,
        title: share.noteEntry.name,
      });
      const formData = await buildShareFormData(analysis);
      await republishShare(share.id, formData);
      await refresh();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Failed to republish share");
    } finally {
      setBusyId(null);
    }
  }, [onError, refresh, vaultPath]);

  return (
    <section className="share-panel">
      <div className="share-panel-header">
        <h2>Published notes</h2>
        <span>{enrichedItems.length}</span>
      </div>
      <div className="share-panel-list share-panel-list--full">
        {enrichedItems.length > 0 ? (
          <div className="share-list-table-header">
            <div className="share-list-table-header-label">Note</div>
            <div className="share-list-table-header-spacer" />
          </div>
        ) : null}
        {enrichedItems.map((item) => (
          <div key={item.id} className="share-list-row">
            <div className="share-list-row-main">
              <div className="share-list-item-title">{item.title}</div>
              <div className="share-list-item-path">{item.sourceNotePath}</div>
              {item.sourceNoteStatus === "missing" ? (
                <div className="share-list-item-note-status">Local note is missing</div>
              ) : null}
            </div>
            <div className="share-list-row-actions">
              <button
                type="button"
                className="share-row-icon-btn"
                onClick={() => void handleCopyLink(item)}
                title="Copy Link"
                aria-label={`Copy public link for ${item.title}`}
                disabled={busyId === item.id}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6.75 9.25L9.25 6.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M8.5 10L7.25 11.25C6.28 12.22 4.72 12.22 3.75 11.25C2.78 10.28 2.78 8.72 3.75 7.75L5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M7.5 6L8.75 4.75C9.72 3.78 11.28 3.78 12.25 4.75C13.22 5.72 13.22 7.28 12.25 8.25L11 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                className="share-row-icon-btn"
                onClick={() => void handleRepublish(item)}
                title="Republish"
                aria-label={`Republish ${item.title}`}
                disabled={busyId === item.id || item.sourceNoteStatus !== "linked"}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M13 8A5 5 0 0 1 4.46 11.54" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M3 10.75V12.75H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 8A5 5 0 0 1 11.54 4.46" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M13 5.25V3.25H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="share-row-icon-btn share-row-icon-btn--danger"
                onClick={() => void handleRevoke(item)}
                title="Revoke"
                aria-label={`Revoke ${item.title}`}
                disabled={busyId === item.id}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3.75 4.5H12.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M6.25 2.75H9.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M5 4.5V11.25C5 12.08 5.67 12.75 6.5 12.75H9.5C10.33 12.75 11 12.08 11 11.25V4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M6.75 6.5V10.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M9.25 6.5V10.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        ))}
        {enrichedItems.length === 0 ? <div className="share-panel-empty">No shares yet</div> : null}
      </div>
    </section>
  );
}
