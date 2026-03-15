import { EditorContent, useEditor } from "@tiptap/react";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { CarbonImage } from "../../lib/tiptap/carbon-image-extension";
import { CarbonLink, buildNotePathClipboardItem, type NoteLinkSuggestionItem } from "../../lib/tiptap/carbon-link-extension";
import { CarbonPdf } from "../../lib/tiptap/carbon-pdf-extension";
import { CarbonVideo } from "../../lib/tiptap/carbon-video-extension";
import { API_BASE_URL } from "../../lib/api";
import { ENABLE_CLOUD_IMAGE_UPLOAD } from "../../lib/app-config";
import { debounce } from "../../lib/debounce";
import { useCopyFeedback } from "../../lib/hooks/use-copy-feedback";
import { resolveRelativePath, validateLinkTarget } from "../../lib/link-utils";
import { formatMarkdownForCopy } from "../../lib/tiptap/markdown";
import type { NoteContent, NoteIndexEntry, NoteViewMode } from "../../lib/types";
import { MediaPreviewHost } from "./MediaPreviewHost";
import { buildNoteLinkSuggestions } from "./build-note-link-suggestions";
import { NoteViewHeader } from "../note-view-header";
import { Toast } from "../Toast";
import { useEditorZoom } from "./use-editor-zoom";
import { useImageDropUpload } from "./use-image-drop-upload";
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
    debouncedSave,
    noteIndex,
  });
  useEffect(() => {
    latestRef.current = {
      onNavigateToNote,
      onLinkError,
      onBufferChange,
      debouncedSave,
      noteIndex,
    };
    return () => latestRef.current.debouncedSave.cancel();
  }, [onNavigateToNote, onLinkError, onBufferChange, debouncedSave, noteIndex]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false }),
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
          uploadEnabled: ENABLE_CLOUD_IMAGE_UPLOAD,
          currentNotePath: note.path,
          onPreviewImage: openImagePreview,
        }),
        CarbonVideo.configure({
          currentNotePath: note.path,
          onPreviewVideo: openVideoPreview,
        }),
        CarbonPdf.configure({
          currentNotePath: note.path,
          onPreviewPdf: openPdfPreview,
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Markdown,
      ],
      editable: true,
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
  const { handleContentDragOver, handleContentDrop } = useImageDropUpload(
    editor,
    ENABLE_CLOUD_IMAGE_UPLOAD,
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
      />

      <div
        className="note-editor-content"
        style={editorContentStyle}
        onDragOver={handleContentDragOver}
        onDrop={handleContentDrop}
      >
        <EditorContent editor={editor} />
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
