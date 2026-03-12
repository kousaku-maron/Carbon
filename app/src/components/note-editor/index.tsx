import { EditorContent, useEditor } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { CarbonImage } from "../../lib/tiptap/carbon-image-extension";
import { CarbonLink, buildNotePathClipboardItem, type NoteLinkSuggestionItem } from "../../lib/tiptap/carbon-link-extension";
import { CarbonPdf } from "../../lib/tiptap/carbon-pdf-extension";
import { CarbonVideo } from "../../lib/tiptap/carbon-video-extension";
import { API_BASE_URL } from "../../lib/api";
import { debounce } from "../../lib/debounce";
import { useCopyFeedback } from "../../lib/hooks/use-copy-feedback";
import { resolveRelativePath, validateLinkTarget } from "../../lib/link-utils";
import { formatMarkdownForCopy } from "../../lib/tiptap/markdown";
import type { NoteContent, TreeNode } from "../../lib/types";
import { MediaPreviewHost } from "./MediaPreviewHost";
import { buildNoteLinkSuggestions } from "./build-note-link-suggestions";
import { Toast } from "../Toast";
import { useEditorZoom } from "./use-editor-zoom";
import { useImageDropUpload } from "./use-image-drop-upload";
import { useMediaPreview } from "./use-media-preview";

type NoteEditorProps = {
  note: NoteContent;
  onSave: (path: string, content: string) => Promise<void>;
  onBufferChange?: (path: string, content: string) => void;
  vaultPath: string;
  tree: TreeNode[];
  onNavigateToNote?: (absolutePath: string) => void;
  onLinkError?: (message: string) => void;
};

export function NoteEditor(props: NoteEditorProps) {
  const { note, onSave, onBufferChange, vaultPath, tree, onNavigateToNote, onLinkError } = props;
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
    tree,
  });
  useEffect(() => {
    latestRef.current = {
      onNavigateToNote,
      onLinkError,
      onBufferChange,
      debouncedSave,
      tree,
    };
    return () => latestRef.current.debouncedSave.cancel();
  }, [onNavigateToNote, onLinkError, onBufferChange, debouncedSave, tree]);

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
              buildNoteLinkSuggestions(latestRef.current.tree, note.path, query),
          },
        }),
        CarbonImage.configure({
          inline: false,
          apiUrl: API_BASE_URL,
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
  const { handleContentDragOver, handleContentDrop } = useImageDropUpload(editor);

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
      <header className="note-editor-header">
        <nav className="note-editor-breadcrumbs">
          {note.id
            .replace(/\.md$/i, "")
            .split("/")
            .map((segment, i, arr) => (
              <span key={i} className="note-editor-breadcrumb-item">
                {i > 0 && <span className="note-editor-breadcrumb-sep">/</span>}
                <span
                  className={
                    i === arr.length - 1
                      ? "note-editor-breadcrumb-current"
                      : "note-editor-breadcrumb-folder"
                  }
                >
                  {segment}
                </span>
              </span>
            ))}
        </nav>
        <button
          type="button"
          className="note-editor-copy-btn"
          onClick={handleCopyPath}
          title="Copy path"
        >
          {copied === "path" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6.75 9.25L9.25 6.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M8.5 10L7.25 11.25C6.28 12.22 4.72 12.22 3.75 11.25C2.78 10.28 2.78 8.72 3.75 7.75L5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M7.5 6L8.75 4.75C9.72 3.78 11.28 3.78 12.25 4.75C13.22 5.72 13.22 7.28 12.25 8.25L11 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          )}
        </button>
        <button
          type="button"
          className="note-editor-copy-btn"
          onClick={handleCopyMarkdown}
          title="Copy as Markdown"
        >
          {copied === "markdown" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="5.5" y="5.5" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H4.5C3.67 2 3 2.67 3 3.5V10C3 10.83 3.67 11.5 4.5 11.5H5.5" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
          )}
        </button>
      </header>

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
