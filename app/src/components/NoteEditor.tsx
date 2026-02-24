import { EditorContent, useEditor } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CarbonImage } from "../lib/tiptap/carbon-image-extension";
import { CarbonLink, type NoteLinkSuggestionItem } from "../lib/tiptap/carbon-link-extension";
import { API_BASE_URL } from "../lib/api";
import { debounce } from "../lib/debounce";
import { flattenTreeNodes, getRelativePath, resolveRelativePath, validateLinkTarget } from "../lib/linkUtils";
import { formatMarkdownForCopy } from "../lib/markdown";
import type { NoteContent, TreeNode } from "../lib/types";

type NoteEditorProps = {
  note: NoteContent;
  onSave: (path: string, content: string) => Promise<void>;
  vaultPath: string;
  tree: TreeNode[];
  onNavigateToNote?: (absolutePath: string) => void;
  onLinkError?: (message: string) => void;
};

export function NoteEditor(props: NoteEditorProps) {
  const { note, onSave, vaultPath, tree, onNavigateToNote, onLinkError } = props;
  const [copied, setCopied] = useState(false);

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
  const latestRef = useRef({ onNavigateToNote, onLinkError, debouncedSave, tree });
  useEffect(() => {
    latestRef.current = { onNavigateToNote, onLinkError, debouncedSave, tree };
    return () => latestRef.current.debouncedSave.cancel();
  }, [onNavigateToNote, onLinkError, debouncedSave, tree]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false }),
        CarbonLink.configure({
          openOnClick: true,
          autolink: true,
          linkOnPaste: true,
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
            console.log(`TODO: implement later... [${href}]`);
          },
          suggestion: {
            items: ({ query }: { query: string }): NoteLinkSuggestionItem[] => {
              const allFiles = flattenTreeNodes(latestRef.current.tree);
              const currentPath = note.path;
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
          },
        }),
        CarbonImage.configure({
          inline: false,
          apiUrl: API_BASE_URL,
        }),
        Markdown,
      ],
      editable: true,
      content: note.body,
      contentType: "markdown",
      onUpdate: ({ editor: ed, transaction }) => {
        if (transaction.getMeta("skipPersistence")) return;
        latestRef.current.debouncedSave(note.path, ed.getMarkdown());
      },
    },
    [note.body, note.path, vaultPath],
  );

  const handleCopyMarkdown = useCallback(() => {
    if (!editor) return;
    const formatted = formatMarkdownForCopy(editor.getMarkdown());
    navigator.clipboard.writeText(formatted).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [editor]);

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
        <EditorContent editor={editor} />
      </div>
      {copied && (
        <div className="note-editor-toast">Copied to clipboard</div>
      )}
    </div>
  );
}
