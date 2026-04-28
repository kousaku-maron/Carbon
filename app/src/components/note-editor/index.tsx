import { EditorContent, useEditor } from "@tiptap/react";
import { CARBON_PROSE_CLASS } from "@carbon/rendering";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createShare, listShares, republishShare, revokeShare } from "../../lib/api";
import { CarbonCodeBlock } from "../../lib/tiptap/carbon-code-block-extension";
import { CarbonImage } from "../../lib/tiptap/carbon-image-extension";
import { CarbonLink, buildNotePathClipboardItem, type NoteLinkSuggestionItem } from "../../lib/tiptap/carbon-link-extension";
import { CarbonTable } from "../../lib/tiptap/carbon-table-extension";
import { CarbonPdf } from "../../lib/tiptap/carbon-pdf-extension";
import { CarbonSearch } from "../../lib/tiptap/carbon-search-extension";
import { CarbonSlashCommand } from "../../lib/tiptap/carbon-slash-command-extension";
import { CarbonVideo } from "../../lib/tiptap/carbon-video-extension";
import { API_BASE_URL } from "../../lib/api";
import { debounce } from "../../lib/debounce";
import { useCopyFeedback } from "../../lib/hooks/use-copy-feedback";
import { resolveRelativePath, validateLinkTarget } from "../../lib/link-utils";
import { formatPdfExportError, startNotePdfExport } from "../../lib/pdf-export";
import { analyzeShareInput } from "../../lib/share/analyze-share-input";
import { buildShareFormData } from "../../lib/share/build-share-form-data";
import { formatShareError } from "../../lib/share/format-share-error";
import type { ShareSummary } from "../../lib/share/types";
import { formatMarkdownForCopy } from "../../lib/tiptap/markdown";
import type { NoteContent, NoteIndexEntry, NoteViewMode } from "../../lib/types";
import { MediaPreviewHost } from "./MediaPreviewHost";
import { NOTE_EDITOR_SLASH_COMMANDS } from "./note-editor-slash-commands";
import { TableOverlayControls } from "./TableOverlayControls";
import { buildNoteLinkSuggestions } from "./build-note-link-suggestions";
import { ShareConfirmDialog } from "../share/ShareConfirmDialog";
import { NoteViewHeader } from "../note-view-header";
import { Toast } from "../Toast";
import { useTableControls } from "./use-table-controls";
import { useNoteSearch } from "./use-note-search";
import { useEditorZoom } from "./use-editor-zoom";
import { useAssetDropInsert } from "./use-asset-drop-insert";
import { useMediaPreview } from "./use-media-preview";

type NoteEditorProps = {
  note: NoteContent;
  onSave: (path: string, content: string) => Promise<void>;
  onBufferChange?: (path: string, content: string) => void;
  vaultPath: string;
  noteIndex: NoteIndexEntry[];
  onNavigateToNote?: (absolutePath: string) => void;
  onLinkError?: (message: string) => void;
  viewMode: NoteViewMode;
  onViewModeChange: (mode: NoteViewMode) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
};

export function NoteEditor(props: NoteEditorProps) {
  const {
    note,
    onSave,
    onBufferChange,
    vaultPath,
    noteIndex,
    onNavigateToNote,
    onLinkError,
    viewMode,
    onViewModeChange,
    menuOpen,
    onMenuOpenChange,
  } = props;
  const { copied, showCopied, dismissCopied } = useCopyFeedback<"markdown" | "path">(1500);
  const { editorContentStyle, zoomIndicatorVisible, zoomPercent } = useEditorZoom();
  const {
    preview,
    videoPreviewRef,
    openImagePreview,
    openPdfPreview,
    openVideoPreview,
    updatePdfPreviewPage,
    closePreview,
  } = useMediaPreview();
  const [shareSummary, setShareSummary] = useState<ShareSummary | null>(null);
  const [shareLoading, setShareLoading] = useState(true);
  const [sharePendingAction, setSharePendingAction] = useState<null | "publishing" | "republishing" | "revoking">(null);
  const [shareMessage, setShareMessage] = useState("");
  const [pdfExportPending, setPdfExportPending] = useState(false);
  const [pdfExportNotice, setPdfExportNotice] = useState<null | {
    kind: "success" | "error";
    message: string;
  }>(null);
  const [shareConfirmOpen, setShareConfirmOpen] = useState(false);
  const shareBusy = sharePendingAction !== null;
  const shareProgressMessage =
    sharePendingAction === "revoking"
      ? "Revoking..."
      : sharePendingAction === "publishing" || sharePendingAction === "republishing"
        ? "Publishing..."
        : "";

  const debouncedSave = useMemo(
    () =>
      debounce((path: string, md: string) => {
        onSave(path, md).catch(() => {
          console.error(`[NoteEditor] save failed (${path})`);
        });
      }, 500),
    [onSave],
  );

  // Stable ref to avoid unnecessary useEditor re-initialization.
  const latestRef = useRef({
    onNavigateToNote,
    onLinkError,
    onBufferChange,
    onSave,
    debouncedSave,
    noteIndex,
  });
  useEffect(() => {
    latestRef.current = {
      onNavigateToNote,
      onLinkError,
      onBufferChange,
      onSave,
      debouncedSave,
      noteIndex,
    };
    return () => latestRef.current.debouncedSave.cancel();
  }, [onNavigateToNote, onLinkError, onBufferChange, onSave, debouncedSave, noteIndex]);

  useEffect(() => {
    let cancelled = false;
    setShareSummary(null);
    setShareLoading(true);
    setShareMessage("");

    void listShares({ status: "active", sourceVaultPath: vaultPath, sourceNotePath: note.id })
      .then((items) => {
        if (!cancelled) {
          setShareSummary(items[0] ?? null);
          setShareLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShareSummary(null);
          setShareLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [note.id, vaultPath]);

  useEffect(() => {
    if (!shareMessage) return;

    const timeoutId = window.setTimeout(() => {
      setShareMessage("");
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [shareMessage]);

  useEffect(() => {
    if (!pdfExportNotice || pdfExportNotice.kind !== "success") return;

    const timeoutId = window.setTimeout(() => {
      setPdfExportNotice(null);
    }, 2400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pdfExportNotice]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false, codeBlock: false }),
        CarbonCodeBlock.configure({ languageClassPrefix: "language-" }),
        CarbonLink.configure({
          openOnClick: true,
          autolink: true,
          linkOnPaste: true,
          currentNotePath: note.path,
          HTMLAttributes: {
            target: null,
            rel: null,
          },
          onOpenInternal: (href) => {
            const resolved = resolveRelativePath(note.path, href);
            const result = validateLinkTarget(resolved, vaultPath);
            if (!result.valid) {
              latestRef.current.onLinkError?.(
                result.reason ?? "Invalid link",
              );
              return;
            }
            latestRef.current.onNavigateToNote?.(resolved);
          },
          onOpenExternal: (href) => {
            try {
              const protocol = new URL(href).protocol;
              if (!["http:", "https:", "mailto:"].includes(protocol)) {
                latestRef.current.onLinkError?.(
                  `Unsupported external link protocol: ${protocol}`,
                );
                return;
              }

              void openUrl(href).catch(() => {
                latestRef.current.onLinkError?.(
                  "Failed to open external link",
                );
              });
            } catch {
              latestRef.current.onLinkError?.("Invalid external link URL");
            }
          },
          suggestion: {
            items: ({ query }: { query: string }): NoteLinkSuggestionItem[] =>
              buildNoteLinkSuggestions(latestRef.current.noteIndex, note.path, query),
          },
        }),
        CarbonImage.configure({
          inline: false,
          apiUrl: API_BASE_URL,
          uploadEnabled: true,
          vaultPath,
          currentNotePath: note.path,
          onPreviewImage: openImagePreview,
          onPersistMarkdown: (markdown) => {
            latestRef.current.debouncedSave.cancel();
            latestRef.current.onBufferChange?.(note.path, markdown);
            latestRef.current.onSave(note.path, markdown).catch(() => {
              console.error(`[NoteEditor] save failed (${note.path})`);
            });
          },
        }),
        CarbonVideo.configure({
          uploadEnabled: true,
          vaultPath,
          currentNotePath: note.path,
          onPersistMarkdown: (markdown) => {
            latestRef.current.debouncedSave.cancel();
            latestRef.current.onBufferChange?.(note.path, markdown);
            latestRef.current.onSave(note.path, markdown).catch(() => {
              console.error(`[NoteEditor] save failed (${note.path})`);
            });
          },
          onPreviewVideo: openVideoPreview,
        }),
        CarbonPdf.configure({
          currentNotePath: note.path,
          onPreviewPdf: openPdfPreview,
        }),
        CarbonSearch,
        CarbonSlashCommand.configure({
          commands: NOTE_EDITOR_SLASH_COMMANDS,
        }),
        CarbonTable,
        TaskList,
        TaskItem.configure({ nested: true }),
        Markdown.configure({
          markedOptions: {
            gfm: true,
            breaks: false,
          },
        }),
      ],
      editable: true,
      editorProps: {
        attributes: {
          class: CARBON_PROSE_CLASS,
        },
      },
      content: note.body,
      contentType: "markdown",
      onUpdate: ({ editor: ed, transaction }) => {
        if (transaction.getMeta("skipPersistence")) return;
        const markdown = ed.getMarkdown();
        latestRef.current.onBufferChange?.(note.path, markdown);
        latestRef.current.debouncedSave(note.path, markdown);
      },
    },
    [note.body, note.path, vaultPath],
  );

  const {
    editorContentRef,
    searchInputRef,
    isSearchOpen,
    searchMatchIndex,
    searchMatchCount,
    searchQuery,
    applySearchQuery,
    closeSearch,
    handleFindNext,
    handleFindPrevious,
    handleSearchInputKeyDown,
  } = useNoteSearch({
    editor,
    noteDocKey: note.docKey,
  });
  const {
    tableHoverControls,
    hoveredTableHandle,
    selectedTableHandle,
    selectedHandleBounds,
    handleEditorContentMouseMove,
    handleEditorContentMouseLeave,
    handleTableHandleMouseEnter,
    handleTableHandleMouseLeave,
    runTableHoverAction,
    runTableMenuAction,
    selectTableHandle,
  } = useTableControls({
    editor,
    editorContentRef,
  });

  const buildCurrentShareFormData = useCallback(async () => {
    const markdownBody = editor?.getMarkdown() ?? note.body;
    const analysis = analyzeShareInput({
      noteId: note.id,
      notePath: note.path,
      vaultPath,
      markdownBody,
      title: note.name,
    });
    return buildShareFormData(analysis);
  }, [editor, note.body, note.id, note.name, note.path, vaultPath]);
  const handleShare = useCallback(async () => {
    setSharePendingAction("publishing");
    try {
      const formData = await buildCurrentShareFormData();
      const result = await createShare(formData);
      setShareSummary(result.share);
      setShareMessage("Shared");
      setShareConfirmOpen(false);
    } catch (error) {
      setShareMessage(formatShareError(error, "Failed to share"));
    } finally {
      setSharePendingAction(null);
    }
  }, [buildCurrentShareFormData]);

  const handleRepublish = useCallback(async () => {
    if (!shareSummary) return;
    setSharePendingAction("republishing");
    try {
      const formData = await buildCurrentShareFormData();
      const result = await republishShare(shareSummary.id, formData);
      setShareSummary(result.share);
      setShareMessage("Republished");
    } catch (error) {
      setShareMessage(formatShareError(error, "Failed to republish"));
    } finally {
      setSharePendingAction(null);
    }
  }, [buildCurrentShareFormData, shareSummary]);

  const handleRevoke = useCallback(async () => {
    if (!shareSummary) return;
    setSharePendingAction("revoking");
    try {
      await revokeShare(shareSummary.id);
      setShareSummary(null);
      setShareMessage("Share revoked");
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : "Failed to revoke");
    } finally {
      setSharePendingAction(null);
    }
  }, [shareSummary]);

  const handleCopyLink = useCallback(() => {
    if (!shareSummary) return;
    navigator.clipboard.writeText(shareSummary.publicUrl).then(() => {
      setShareMessage("Public link copied");
    });
  }, [shareSummary]);
  const handleExportPdf = useCallback(async () => {
    if (pdfExportPending) return;
    setPdfExportPending(true);
    setPdfExportNotice(null);

    try {
      const targetPath = await startNotePdfExport({
        noteId: note.id,
        notePath: note.path,
        noteName: note.name,
        vaultPath,
        markdownBody: editor?.getMarkdown() ?? note.body,
      });
      setPdfExportNotice({ kind: "success", message: `PDF saved: ${targetPath}` });
    } catch (cause) {
      const message = formatPdfExportError(cause);
      console.error("[pdf-export]", message, cause);
      setPdfExportNotice({ kind: "error", message });
    } finally {
      setPdfExportPending(false);
    }
  }, [editor, note.body, note.id, note.name, note.path, pdfExportPending, vaultPath]);
  const { handleContentDragOver, handleContentDrop } = useAssetDropInsert(
    editor,
    true,
  );

  const handleCopyMarkdown = useCallback(() => {
    if (!editor) return;
    const formatted = formatMarkdownForCopy(editor.getMarkdown());
    navigator.clipboard.writeText(formatted).then(() => {
      showCopied("markdown");
    });
  }, [editor, showCopied]);

  const handleCopyPath = useCallback(() => {
    const item = buildNotePathClipboardItem(note.path, note.id);
    navigator.clipboard
      .write([item])
      .catch(() => navigator.clipboard.writeText(note.path))
      .then(() => {
        showCopied("path");
      });
  }, [note.path, note.id, showCopied]);

  // Cmd+C with no editor focus and no text selection → copy path
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "c" || !e.metaKey || e.shiftKey || e.altKey) return;
      if (editor?.isFocused) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;
      e.preventDefault();
      handleCopyPath();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, handleCopyPath]);

  return (
    <div className="note-editor">
      <NoteViewHeader
        note={note}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        onCopyPath={handleCopyPath}
        onCopyMarkdown={handleCopyMarkdown}
        copied={copied}
        menuOpen={menuOpen}
        onMenuOpenChange={onMenuOpenChange}
        pdfExportActions={{
          busy: pdfExportPending,
          onExport: () => {
            void handleExportPdf();
          },
        }}
        shareActions={
          shareLoading
            ? {
                state: "loading",
              }
            : shareSummary
            ? {
                state: "published",
                busy: shareBusy,
                busyLabel: shareProgressMessage || "Publishing...",
                onCopyLink: handleCopyLink,
                onRepublish: handleRepublish,
                onRevoke: handleRevoke,
              }
            : {
                state: "unpublished",
                busy: shareBusy,
                busyLabel: shareProgressMessage || "Publishing...",
                onShare: () => setShareConfirmOpen(true),
              }
        }
      />
      {isSearchOpen ? (
        <div className="note-editor-searchbar" role="search" aria-label="Find in note">
          <input
            ref={searchInputRef}
            type="text"
            className="note-editor-search-input"
            value={searchQuery}
            onChange={(event) => applySearchQuery(event.target.value)}
            onKeyDown={handleSearchInputKeyDown}
            placeholder="Search text"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <div className="note-editor-search-actions">
            {searchQuery ? (
              <>
                <div className="note-editor-search-meta" aria-live="polite">
                  {searchMatchCount > 0 ? `${searchMatchIndex} of ${searchMatchCount}` : "No results"}
                </div>
                <button
                  type="button"
                  className="note-editor-search-btn"
                  onClick={handleFindPrevious}
                  disabled={searchMatchCount === 0}
                  aria-label="Previous match"
                  title="Previous match"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="note-editor-search-btn"
                  onClick={handleFindNext}
                  disabled={searchMatchCount === 0}
                  aria-label="Next match"
                  title="Next match"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="note-editor-search-close"
              onClick={closeSearch}
              aria-label="Close search"
              title="Close search"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={editorContentRef}
        className="note-editor-content"
        style={editorContentStyle}
        onDragOver={handleContentDragOver}
        onDrop={handleContentDrop}
        onMouseMove={handleEditorContentMouseMove}
        onMouseLeave={handleEditorContentMouseLeave}
      >
        <EditorContent editor={editor} />
        {tableHoverControls && editor ? (
          <TableOverlayControls
            controls={tableHoverControls}
            hoveredHandle={hoveredTableHandle}
            selectedHandle={selectedTableHandle}
            selectedHandleBounds={selectedHandleBounds}
            onHandleMouseEnter={handleTableHandleMouseEnter}
            onHandleMouseLeave={handleTableHandleMouseLeave}
            onHandleClick={(kind, index) => {
              void selectTableHandle(kind, index);
            }}
            onHoverAction={runTableHoverAction}
            onMenuAction={runTableMenuAction}
          />
        ) : null}
      </div>
      <div className={`note-editor-zoom-indicator${zoomIndicatorVisible ? " is-visible" : ""}`}>
        {zoomPercent}%
      </div>
      {copied && (
        <Toast
          message={copied === "path" ? "Path copied" : "Markdown copied"}
          onClose={dismissCopied}
        />
      )}
      {shareProgressMessage ? (
        <Toast message={shareProgressMessage} dismissible={false} loading />
      ) : null}
      {pdfExportPending ? (
        <Toast message="Exporting PDF..." dismissible={false} loading />
      ) : null}
      {shareMessage ? (
        <Toast message={shareMessage} onClose={() => setShareMessage("")} />
      ) : null}
      {pdfExportNotice ? (
        <Toast
          message={pdfExportNotice.message}
          onClose={() => setPdfExportNotice(null)}
        />
      ) : null}
      {shareConfirmOpen ? (
        <ShareConfirmDialog
          noteName={note.name}
          busy={shareBusy}
          onConfirm={() => {
            void handleShare();
          }}
          onClose={() => setShareConfirmOpen(false)}
        />
      ) : null}
      <MediaPreviewHost
        notePath={note.path}
        preview={preview}
        videoPreviewRef={videoPreviewRef}
        onClose={closePreview}
        onPdfPageChange={updatePdfPreviewPage}
      />
    </div>
  );
}
