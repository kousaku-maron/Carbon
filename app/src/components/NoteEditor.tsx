import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { cacheUrl, resolveAndCache, uploadAsset } from "../lib/assetApi";
import { AssetImage } from "../lib/assetImageExtension";
import { compressImage, isImageFile } from "../lib/imageCompression";
import { htmlToMarkdown, markdownToHtml, parseAssetUri } from "../lib/markdown";
import type { NoteContent } from "../lib/types";

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
}) {
  const { note, onSave, registerFlush } = props;
  const notePathRef = useRef(note.path);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
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

  // Resolve carbon://asset images after initial content mount.
  useEffect(() => {
    if (!editor) return;
    void resolveEditorAssetImages();
  }, [editor, resolveEditorAssetImages]);

  const flushPendingSaves = useCallback(async (): Promise<void> => {
    if (!editor) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const html = editor.getHTML();
      const md = buildPersistedMarkdown(html);
      await enqueueSave(notePathRef.current, md);
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
        <h1 className="note-editor-title">{note.name}</h1>
        <span className="note-editor-status">
          {saveStatus === "saving"
            ? "Saving..."
            : saveStatus === "unsaved"
              ? "Unsaved"
              : saveStatus === "error"
                ? "Save failed"
                : ""}
        </span>
      </header>
      <div className="note-editor-content">
        <EditorContent editor={editor} />
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
    </div>
  );
}
