import { EditorContent, useEditor } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CarbonImage } from "../lib/tiptap/carbon-image-extension";
import { CarbonLink, buildNotePathClipboardItem, type NoteLinkSuggestionItem } from "../lib/tiptap/carbon-link-extension";
import { API_BASE_URL } from "../lib/api";
import { debounce } from "../lib/debounce";
import { useCopyFeedback } from "../lib/hooks/use-copy-feedback";
import { flattenTreeNodes, getRelativePath, resolveRelativePath, validateLinkTarget } from "../lib/link-utils";
import { formatMarkdownForCopy } from "../lib/tiptap/markdown";
import type { NoteContent, TreeNode } from "../lib/types";
import { Toast } from "./Toast";

type NoteEditorProps = {
  note: NoteContent;
  onSave: (path: string, content: string) => Promise<void>;
  onBufferChange?: (path: string, content: string) => void;
  vaultPath: string;
  tree: TreeNode[];
  onNavigateToNote?: (absolutePath: string) => void;
  onLinkError?: (message: string) => void;
};

const EDITOR_ZOOM_STORAGE_KEY = "carbon.editor.zoom";
const DEFAULT_EDITOR_ZOOM = 1;
const MIN_EDITOR_ZOOM = 0.6;
const MAX_EDITOR_ZOOM = 2;
const EDITOR_ZOOM_STEP = 0.1;
const ZOOM_INDICATOR_DISPLAY_MS = 2000;

function clampEditorZoom(value: number): number {
  return Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, value));
}

function parseStoredEditorZoom(value: string | null): number {
  if (!value) return DEFAULT_EDITOR_ZOOM;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return DEFAULT_EDITOR_ZOOM;
  return clampEditorZoom(parsed);
}

export function NoteEditor(props: NoteEditorProps) {
  const { note, onSave, onBufferChange, vaultPath, tree, onNavigateToNote, onLinkError } = props;
  const { copied, showCopied, dismissCopied } = useCopyFeedback<"markdown" | "path">(1500);
  const [editorZoom, setEditorZoom] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_EDITOR_ZOOM;
    return parseStoredEditorZoom(window.localStorage.getItem(EDITOR_ZOOM_STORAGE_KEY));
  });
  const [zoomIndicatorVisible, setZoomIndicatorVisible] = useState(false);
  const zoomIndicatorTimeoutRef = useRef<number | null>(null);
  const editorZoomRef = useRef(editorZoom);

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
            items: ({ query }: { query: string }): NoteLinkSuggestionItem[] => {
              const allFiles = flattenTreeNodes(latestRef.current.tree);
              const currentPath = note.path;
              const lower = query.toLowerCase();
              return allFiles
                .filter((f) => f.path !== currentPath)
                .filter((f) => /\.md$/i.test(f.path))
                .filter(
                  (f) =>
                    !query ||
                    f.name.toLowerCase().includes(lower) ||
                    f.id.toLowerCase().includes(lower),
                )
                .slice(0, 20)
                .map((f) => ({
                  id: f.id,
                  name: f.name,
                  path: f.path,
                  relativePath: getRelativePath(currentPath, f.path),
                }));
            },
          },
        }),
        CarbonImage.configure({
          inline: false,
          apiUrl: API_BASE_URL,
          currentNotePath: note.path,
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

  const showZoomIndicator = useCallback(() => {
    if (zoomIndicatorTimeoutRef.current !== null) {
      window.clearTimeout(zoomIndicatorTimeoutRef.current);
      zoomIndicatorTimeoutRef.current = null;
    }
    setZoomIndicatorVisible(true);
    zoomIndicatorTimeoutRef.current = window.setTimeout(() => {
      setZoomIndicatorVisible(false);
      zoomIndicatorTimeoutRef.current = null;
    }, ZOOM_INDICATOR_DISPLAY_MS);
  }, []);

  const setNextEditorZoom = useCallback(
    (delta: number) => {
      const nextZoom = clampEditorZoom(
        Math.round((editorZoomRef.current + delta) * 10) / 10,
      );
      if (nextZoom === editorZoomRef.current) return;
      editorZoomRef.current = nextZoom;
      setEditorZoom(nextZoom);
      showZoomIndicator();
    },
    [showZoomIndicator],
  );

  const handleZoomIn = useCallback(() => {
    setNextEditorZoom(EDITOR_ZOOM_STEP);
  }, [setNextEditorZoom]);

  const handleZoomOut = useCallback(() => {
    setNextEditorZoom(-EDITOR_ZOOM_STEP);
  }, [setNextEditorZoom]);

  useEffect(() => {
    editorZoomRef.current = editorZoom;
    window.localStorage.setItem(EDITOR_ZOOM_STORAGE_KEY, editorZoom.toFixed(1));
  }, [editorZoom]);

  useEffect(() => {
    return () => {
      if (zoomIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(zoomIndicatorTimeoutRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.shiftKey || e.altKey) return;
      if (e.isComposing) return;
      const isZoomIn = e.code === "Equal" || e.code === "NumpadAdd" || e.key === "+";
      const isZoomOut = e.code === "Minus" || e.code === "NumpadSubtract" || e.key === "-" || e.key === "_";
      if (!isZoomIn && !isZoomOut) return;
      e.preventDefault();
      if (isZoomIn) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleZoomIn, handleZoomOut]);

  const editorContentStyle = useMemo(
    () => ({ ["--editor-zoom" as any]: editorZoom.toString() }),
    [editorZoom],
  );
  const zoomPercent = Math.round(editorZoom * 100);

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

      <div className="note-editor-content" style={editorContentStyle}>
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
    </div>
  );
}
