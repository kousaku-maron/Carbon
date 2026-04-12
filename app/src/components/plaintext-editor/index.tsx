import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debounce } from "../../lib/debounce";
import { useCopyFeedback } from "../../lib/hooks/use-copy-feedback";
import { formatPdfExportError, startNotePdfExport } from "../../lib/pdf-export";
import { formatMarkdownForCopy } from "../../lib/tiptap/markdown";
import { buildNotePathClipboardItem } from "../../lib/tiptap/carbon-link-extension";
import type { NoteContent, NoteViewMode } from "../../lib/types";
import { Toast } from "../Toast";
import { NoteViewHeader } from "../note-view-header";

type PlainTextEditorProps = {
  note: NoteContent;
  onSave: (path: string, content: string) => Promise<void>;
  onBufferChange?: (path: string, content: string) => void;
  vaultPath: string;
  viewMode: NoteViewMode;
  onViewModeChange: (mode: NoteViewMode) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
};

export function PlainTextEditor(props: PlainTextEditorProps) {
  const {
    note,
    onSave,
    onBufferChange,
    vaultPath,
    viewMode,
    onViewModeChange,
    menuOpen,
    onMenuOpenChange,
  } = props;
  const [value, setValue] = useState(note.body);
  const [pdfExportPending, setPdfExportPending] = useState(false);
  const [pdfExportNotice, setPdfExportNotice] = useState<null | {
    kind: "success" | "error";
    message: string;
  }>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { copied, showCopied, dismissCopied } = useCopyFeedback<"markdown" | "path">(1500);

  useEffect(() => {
    setValue(note.body);
  }, [note.body, note.docKey]);

  useEffect(() => {
    if (!pdfExportNotice || pdfExportNotice.kind !== "success") return;
    const timeoutId = window.setTimeout(() => {
      setPdfExportNotice(null);
    }, 2400);
    return () => window.clearTimeout(timeoutId);
  }, [pdfExportNotice]);

  const debouncedSave = useMemo(
    () =>
      debounce((path: string, content: string) => {
        onSave(path, content).catch(() => {
          console.error(`[PlainTextEditor] save failed (${path})`);
        });
      }, 500),
    [onSave],
  );

  useEffect(() => {
    return () => {
      debouncedSave.flush();
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  const handleCopyMarkdown = useCallback(() => {
    navigator.clipboard.writeText(formatMarkdownForCopy(value)).then(() => {
      showCopied("markdown");
    });
  }, [showCopied, value]);

  const handleCopyPath = useCallback(() => {
    const item = buildNotePathClipboardItem(note.path, note.id);
    navigator.clipboard
      .write([item])
      .catch(() => navigator.clipboard.writeText(note.path))
      .then(() => {
        showCopied("path");
      });
  }, [note.id, note.path, showCopied]);

  const handleChange = useCallback((nextValue: string) => {
    setValue(nextValue);
    onBufferChange?.(note.path, nextValue);
    debouncedSave(note.path, nextValue);
  }, [debouncedSave, note.path, onBufferChange]);

  const handleViewModeChange = useCallback((mode: NoteViewMode) => {
    debouncedSave.flush();
    onViewModeChange(mode);
  }, [debouncedSave, onViewModeChange]);

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
        markdownBody: value,
      });
      setPdfExportNotice({ kind: "success", message: `PDF saved: ${targetPath}` });
    } catch (cause) {
      const message = formatPdfExportError(cause);
      console.error("[pdf-export]", message, cause);
      setPdfExportNotice({ kind: "error", message });
    } finally {
      setPdfExportPending(false);
    }
  }, [note.id, note.name, note.path, pdfExportPending, value, vaultPath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "c" || !event.metaKey || event.shiftKey || event.altKey) return;
      if (document.activeElement === textareaRef.current) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;
      event.preventDefault();
      handleCopyPath();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleCopyPath]);

  return (
    <div className="note-editor">
      <NoteViewHeader
        note={note}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
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
      />
      <div className="note-editor-content note-editor-content--plaintext">
        <div className="plaintext-editor-shell">
          <textarea
            ref={textareaRef}
            className="plaintext-editor-textarea"
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            spellCheck={false}
          />
        </div>
      </div>
      {copied ? (
        <Toast
          message={copied === "path" ? "Path copied" : "Markdown copied"}
          onClose={dismissCopied}
        />
      ) : null}
      {pdfExportPending ? (
        <Toast message="Exporting PDF..." dismissible={false} loading />
      ) : null}
      {pdfExportNotice ? (
        <Toast
          message={pdfExportNotice.message}
          onClose={() => setPdfExportNotice(null)}
        />
      ) : null}
    </div>
  );
}
