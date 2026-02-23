import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { cacheUrl, resolveAndCache, uploadAsset } from "../lib/assetApi";
import { AssetImage } from "../lib/assetImageExtension";
import { compressImage, isImageFile } from "../lib/imageCompression";
import {
  flattenTreeNodes,
  getRelativePath,
  isDangerousHref,
  isInternalLink,
  resolveRelativePath,
  validateLinkTarget,
} from "../lib/linkUtils";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import {
  NoteLinkSuggestion,
  type NoteLinkSuggestionItem,
} from "../lib/noteLinkSuggestion";
import {
  NoteLinkSuggestionList,
  type NoteLinkSuggestionListRef,
} from "./NoteLinkSuggestionList";
import {
  formatMarkdownForCopy,
  htmlToMarkdown,
  markdownToHtml,
  parseAssetUri,
} from "../lib/markdown";
import type { NoteContent, TreeNode } from "../lib/types";

type SaveStatus = "saved" | "saving" | "unsaved" | "error";

type UploadingImage = {
  id: string;
  blobUrl: string;
  progress: number; // 0-100, -1 = error
};

function sanitizeEditorHtmlForPersistence(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images = doc.querySelectorAll("img");

  for (const image of images) {
    const src = image.getAttribute("src") || "";

    // Never persist temporary preview images.
    if (src.startsWith("blob:")) {
      image.remove();
    }
  }

  return doc.body.innerHTML;
}

export function NoteEditor(props: {
  note: NoteContent;
  onSave: (path: string, content: string) => Promise<void>;
  registerFlush?: (flush: (() => Promise<void>) | null) => void;
  vaultPath: string;
  tree: TreeNode[];
  onNavigateToNote?: (absolutePath: string) => void;
  onLinkError?: (message: string) => void;
}) {
  const { note, onSave, registerFlush, vaultPath, tree, onNavigateToNote, onLinkError } = props;
  const notePathRef = useRef(note.path);
  const treeRef = useRef(tree);
  const vaultPathRef = useRef(vaultPath);
  const onNavigateToNoteRef = useRef(onNavigateToNote);
  const onLinkErrorRef = useRef(onLinkError);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"rich" | "plain">("rich");
  const [plainText, setPlainText] = useState(note.body);
  const plainTextRef = useRef(note.body);
  const modeRef = useRef<"rich" | "plain">("rich");
  const [uploading, setUploading] = useState<UploadingImage[]>([]);

  const buildPersistedMarkdown = useCallback((html: string): string => {
    const sanitized = sanitizeEditorHtmlForPersistence(html);
    return htmlToMarkdown(sanitized);
  }, []);

  const doSave = useCallback(
    async (path: string, md: string) => {
      setSaveStatus("saving");
      try {
        await onSave(path, md);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
        throw new Error("Failed to save");
      }
    },
    [onSave],
  );

  const enqueueSave = useCallback(
    (path: string, md: string): Promise<void> => {
      const queued = saveQueueRef.current.then(
        () => doSave(path, md),
        () => doSave(path, md),
      );
      // Keep queue chain alive even if a save fails.
      saveQueueRef.current = queued.catch(() => {});
      return queued;
    },
    [doSave],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: { languageClassPrefix: "language-" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      AssetImage.configure({ inline: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          target: null,
          rel: null,
        },
      }),
      NoteLinkSuggestion.configure({
        suggestion: {
          items: ({ query }: { query: string }): NoteLinkSuggestionItem[] => {
            const allFiles = flattenTreeNodes(treeRef.current);
            const currentPath = notePathRef.current;
            const lower = query.toLowerCase();
            return allFiles
              .filter((f) => f.path !== currentPath)
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
          render: () => {
            let renderer: ReactRenderer<NoteLinkSuggestionListRef> | null =
              null;
            let popup: HTMLElement | null = null;

            const POPUP_MAX_WIDTH = 360;
            const POPUP_MAX_HEIGHT = 240;
            const GAP = 4;

            function positionPopup(
              clientRect: (() => DOMRect | null) | null | undefined,
              el: HTMLElement,
            ) {
              const rect = clientRect?.();
              if (!rect) return;
              // Clamp left to keep popup within viewport
              const left = Math.max(
                0,
                Math.min(rect.left, window.innerWidth - POPUP_MAX_WIDTH - 8),
              );
              // Show above if not enough space below
              const fitsBelow =
                rect.bottom + GAP + POPUP_MAX_HEIGHT <= window.innerHeight;
              const top = fitsBelow
                ? rect.bottom + GAP
                : rect.top - POPUP_MAX_HEIGHT - GAP;
              el.style.left = `${left}px`;
              el.style.top = `${Math.max(0, top)}px`;
            }

            return {
              onStart(onStartProps: SuggestionProps<NoteLinkSuggestionItem>) {
                popup = document.createElement("div");
                popup.style.position = "fixed";
                popup.style.zIndex = "200";
                document.body.appendChild(popup);

                renderer = new ReactRenderer(NoteLinkSuggestionList, {
                  props: {
                    items: onStartProps.items,
                    command: onStartProps.command,
                  },
                  editor: onStartProps.editor,
                });
                popup.appendChild(renderer.element);
                positionPopup(onStartProps.clientRect, popup);
              },
              onUpdate(onUpdateProps: SuggestionProps<NoteLinkSuggestionItem>) {
                renderer?.updateProps({
                  items: onUpdateProps.items,
                  command: onUpdateProps.command,
                });
                if (popup) positionPopup(onUpdateProps.clientRect, popup);
              },
              onKeyDown(onKeyDownProps: SuggestionKeyDownProps) {
                if (onKeyDownProps.event.key === "Escape") {
                  popup?.remove();
                  renderer?.destroy();
                  popup = null;
                  renderer = null;
                  return true;
                }
                return renderer?.ref?.onKeyDown(onKeyDownProps.event) ?? false;
              },
              onExit() {
                renderer?.destroy();
                popup?.remove();
                popup = null;
                renderer = null;
              },
            };
          },
        },
      }),
    ],
    content: markdownToHtml(note.body),
    onUpdate: ({ editor: ed, transaction }) => {
      if (transaction.getMeta("skipPersistence")) return;

      setSaveStatus("unsaved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const html = ed.getHTML();
        const md = buildPersistedMarkdown(html);
        void enqueueSave(notePathRef.current, md).catch(() => {
          // Save status is already reflected in doSave.
        });
      }, 500);
    },
    editorProps: {
      handleClick: (view, pos, event) => {
        // Only navigate on Cmd+Click (macOS) or Ctrl+Click (other platforms).
        // Normal clicks place the cursor for editing.
        if (!event.metaKey && !event.ctrlKey) return false;

        const { doc } = view.state;
        const $pos = doc.resolve(pos);
        const linkMark = $pos.marks().find((m) => m.type.name === "link");
        if (!linkMark) return false;

        const href = linkMark.attrs.href as string | undefined;
        if (!href) return false;

        if (isDangerousHref(href)) return true;

        if (!isInternalLink(href)) {
          // External links: ignore for now (no browser navigation in Tauri)
          return false;
        }

        event.preventDefault();
        const resolved = resolveRelativePath(notePathRef.current, href);
        const validation = validateLinkTarget(resolved, vaultPathRef.current);
        if (!validation.valid) {
          onLinkErrorRef.current?.(validation.reason ?? "Invalid link");
          return true;
        }

        onNavigateToNoteRef.current?.(resolved);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;

        const imageFiles = Array.from(files).filter(isImageFile);
        if (imageFiles.length === 0) return false;

        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        for (const file of imageFiles) {
          void handleImageInsert(file, pos);
        }
        return true;
      },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files || files.length === 0) return false;

        const imageFiles = Array.from(files).filter(isImageFile);
        if (imageFiles.length === 0) return false;

        event.preventDefault();
        for (const file of imageFiles) {
          void handleImageInsert(file);
        }
        return true;
      },
    },
  });

  // Handle image insertion: compress, show preview, upload, replace with asset URI
  const handleImageInsert = useCallback(
    async (file: File, insertPos?: number) => {
      if (!editor) return;

      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const blobUrl = URL.createObjectURL(file);

      // Insert preview image immediately
      const pos = insertPos ?? editor.state.selection.anchor;
      editor
        .chain()
        .focus()
        .insertContentAt(pos, {
          type: "image",
          attrs: { src: blobUrl, alt: file.name, "data-asset-uri": null },
        })
        .run();

      // Track upload
      setUploading((prev) => [...prev, { id: uploadId, blobUrl, progress: 0 }]);

      try {
        // Compress
        setUploading((prev) =>
          prev.map((u) => (u.id === uploadId ? { ...u, progress: 10 } : u)),
        );
        const compressed = await compressImage(file);

        setUploading((prev) =>
          prev.map((u) => (u.id === uploadId ? { ...u, progress: 40 } : u)),
        );

        // Upload
        const result = await uploadAsset(compressed.blob);

        setUploading((prev) =>
          prev.map((u) => (u.id === uploadId ? { ...u, progress: 100 } : u)),
        );

        // Cache the signed URL
        cacheUrl(result.assetId, result.signedUrl, result.expiresAt);

        // Replace blob URL with signed URL + set data-asset-uri
        const { doc } = editor.state;
        let found = false;
        doc.descendants((node, nodePos) => {
          if (found) return false;
          if (node.type.name === "image" && node.attrs.src === blobUrl) {
            found = true;
            const tr = editor.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              src: result.signedUrl,
              "data-asset-uri": result.assetUri,
            });
            editor.view.dispatch(tr);
            return false;
          }
        });

        // Trigger save
        setSaveStatus("unsaved");
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          const html = editor.getHTML();
          const md = buildPersistedMarkdown(html);
          void enqueueSave(notePathRef.current, md).catch(() => {
            // Save status is already reflected in doSave.
          });
        }, 300);
      } catch (err) {
        console.error("Image upload failed:", err);
        setUploading((prev) =>
          prev.map((u) => (u.id === uploadId ? { ...u, progress: -1 } : u)),
        );

        // Remove the failed placeholder image
        const { doc } = editor.state;
        doc.descendants((node, nodePos) => {
          if (node.type.name === "image" && node.attrs.src === blobUrl) {
            const tr = editor.state.tr.delete(nodePos, nodePos + node.nodeSize);
            tr.setMeta("addToHistory", false);
            editor.view.dispatch(tr);
            return false;
          }
        });
      } finally {
        URL.revokeObjectURL(blobUrl);
        // Remove from uploading list after a delay
        setTimeout(() => {
          setUploading((prev) => prev.filter((u) => u.id !== uploadId));
        }, 2000);
      }
    },
    [editor, enqueueSave, buildPersistedMarkdown],
  );

  const resolveEditorAssetImages = useCallback(async (): Promise<void> => {
    if (!editor) return;

    const targets: Array<{
      pos: number;
      attrs: Record<string, unknown>;
      assetId: string;
      assetUri: string;
    }> = [];

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "image") return;

      const attrs = node.attrs as Record<string, unknown>;
      const src = typeof attrs.src === "string" ? attrs.src : "";
      const dataAssetUri =
        typeof attrs["data-asset-uri"] === "string" ? (attrs["data-asset-uri"] as string) : "";

      const idFromData = dataAssetUri ? parseAssetUri(dataAssetUri) : null;
      const idFromSrc = src ? parseAssetUri(src) : null;
      const assetId = idFromData ?? idFromSrc;
      if (!assetId) return;

      targets.push({
        pos,
        attrs,
        assetId,
        assetUri: idFromData ? dataAssetUri : `carbon://asset/${assetId}`,
      });
    });

    if (targets.length === 0) return;

    try {
      const uniqueAssetIds = Array.from(new Set(targets.map((t) => t.assetId)));
      const urlMap = await resolveAndCache(uniqueAssetIds);

      const tr = editor.state.tr;
      let changed = false;
      for (const target of targets) {
        const newUrl = urlMap.get(target.assetId);
        if (!newUrl) continue;

        const nextAttrs = {
          ...target.attrs,
          src: newUrl,
          "data-asset-uri": target.assetUri,
        };

        if (
          nextAttrs.src !== target.attrs.src ||
          nextAttrs["data-asset-uri"] !== target.attrs["data-asset-uri"]
        ) {
          tr.setNodeMarkup(target.pos, undefined, nextAttrs);
          changed = true;
        }
      }

      if (changed) {
        tr.setMeta("addToHistory", false);
        tr.setMeta("skipPersistence", true);
        editor.view.dispatch(tr);
      }
    } catch {
      // Silently ignore resolve failures.
    }
  }, [editor]);

  // Track current save destination for same-note move/rename.
  useEffect(() => {
    notePathRef.current = note.path;
  }, [note.path]);

  // Keep refs in sync for callbacks captured by useEditor closures.
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);
  useEffect(() => {
    vaultPathRef.current = vaultPath;
  }, [vaultPath]);
  useEffect(() => {
    onNavigateToNoteRef.current = onNavigateToNote;
  }, [onNavigateToNote]);
  useEffect(() => {
    onLinkErrorRef.current = onLinkError;
  }, [onLinkError]);

  // Resolve carbon://asset images after initial content mount.
  useEffect(() => {
    if (!editor) return;
    void resolveEditorAssetImages();
  }, [editor, resolveEditorAssetImages]);

  const flushPendingSaves = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;

      if (modeRef.current === "plain") {
        await enqueueSave(notePathRef.current, plainTextRef.current);
      } else if (editor) {
        const html = editor.getHTML();
        const md = buildPersistedMarkdown(html);
        await enqueueSave(notePathRef.current, md);
      }
    }

    await saveQueueRef.current;
  }, [editor, buildPersistedMarkdown, enqueueSave]);

  useEffect(() => {
    if (!registerFlush) return;
    registerFlush(flushPendingSaves);
    return () => registerFlush(null);
  }, [registerFlush, flushPendingSaves]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopyMarkdown = useCallback(() => {
    if (modeRef.current === "plain") {
      const formatted = formatMarkdownForCopy(plainTextRef.current);
      navigator.clipboard.writeText(formatted).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
      return;
    }
    if (!editor) return;
    const html = editor.getHTML();
    const md = htmlToMarkdown(html);
    const formatted = formatMarkdownForCopy(md);
    navigator.clipboard.writeText(formatted).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [editor]);

  const handleToggleMode = useCallback(() => {
    // Flush pending timer before switching
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (modeRef.current === "rich") {
      // Rich → Plain: extract current markdown from TipTap
      if (editor) {
        const html = editor.getHTML();
        const md = buildPersistedMarkdown(html);
        setPlainText(md);
        plainTextRef.current = md;
      }
      modeRef.current = "plain";
      setMode("plain");
    } else {
      // Plain → Rich: push markdown into TipTap
      if (editor) {
        const html = markdownToHtml(plainTextRef.current);
        editor.commands.setContent(html);
      }
      modeRef.current = "rich";
      setMode("rich");
    }
  }, [editor, buildPersistedMarkdown]);

  const handlePlainTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setPlainText(value);
      plainTextRef.current = value;

      setSaveStatus("unsaved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void enqueueSave(notePathRef.current, value).catch(() => {});
      }, 500);
    },
    [enqueueSave],
  );

  // Periodic re-resolve for expired signed URLs.
  useEffect(() => {
    if (!editor) return;

    const interval = setInterval(() => {
      void resolveEditorAssetImages();
    }, 4 * 60 * 1000);

    return () => clearInterval(interval);
  }, [editor, resolveEditorAssetImages]);

  return (
    <div className="note-editor">
      <header className="note-editor-header">
        <nav className="note-editor-breadcrumbs">
          {note.id.replace(/\.md$/i, "").split("/").map((segment, i, arr) => (
            <span key={i} className="note-editor-breadcrumb-item">
              {i > 0 && <span className="note-editor-breadcrumb-sep">/</span>}
              <span className={i === arr.length - 1 ? "note-editor-breadcrumb-current" : "note-editor-breadcrumb-folder"}>
                {segment}
              </span>
            </span>
          ))}
        </nav>
        <span className="note-editor-status">
          {saveStatus === "saving"
            ? "Saving..."
            : saveStatus === "unsaved"
              ? "Unsaved"
              : saveStatus === "error"
                ? "Save failed"
                : ""}
        </span>
        <button
          type="button"
          className={`note-editor-mode-switch ${mode === "plain" ? "active" : ""}`}
          onClick={handleToggleMode}
          title={mode === "rich" ? "Switch to Markdown" : "Switch to Rich Editor"}
          role="switch"
          aria-checked={mode === "plain"}
        >
          <span className="note-editor-mode-switch-thumb" />
        </button>
        <span className="note-editor-mode-label">Plain Text</span>
        <button
          type="button"
          className="note-editor-copy-btn"
          onClick={handleCopyMarkdown}
          title="Copy as Markdown"
        >
          {copied ? (
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
      <div className="note-editor-content">
        {mode === "rich" ? (
          <EditorContent editor={editor} />
        ) : (
          <textarea
            className="note-editor-plain-textarea"
            value={plainText}
            onChange={handlePlainTextChange}
            spellCheck={false}
          />
        )}
      </div>
      {uploading.length > 0 && (
        <div className="upload-indicator">
          {uploading.map((u) => (
            <div key={u.id} className="upload-indicator-item">
              <div className="upload-indicator-bar">
                <div
                  className={`upload-indicator-fill ${u.progress === -1 ? "upload-indicator-fill--error" : ""}`}
                  style={{ width: `${u.progress === -1 ? 100 : u.progress}%` }}
                />
              </div>
              <span className="upload-indicator-text">
                {u.progress === -1
                  ? "Upload failed"
                  : u.progress < 100
                    ? `Uploading... ${u.progress}%`
                    : "Done"}
              </span>
            </div>
          ))}
        </div>
      )}
      {copied && (
        <div className="note-editor-toast">Copied to clipboard</div>
      )}
    </div>
  );
}
