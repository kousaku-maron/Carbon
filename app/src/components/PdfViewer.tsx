import { useCallback } from "react";
import { useCopyFeedback } from "../lib/hooks/use-copy-feedback";
import { buildNotePathClipboardItem } from "../lib/tiptap/carbon-link-extension";
import type { TreeNode } from "../lib/types";
import { Toast } from "./Toast";
import { PdfDeck } from "./PdfDeck";

type PdfViewerProps = {
  file: TreeNode;
};

export function PdfViewer(props: PdfViewerProps) {
  const { file } = props;
  const { copied, showCopied, dismissCopied } = useCopyFeedback<"path">(1500);

  const handleCopyPath = useCallback(() => {
    const item = buildNotePathClipboardItem(file.path, file.id);
    navigator.clipboard
      .write([item])
      .catch(() => navigator.clipboard.writeText(file.path))
      .then(() => {
        showCopied("path");
      })
      .catch(() => undefined);
  }, [file.id, file.path, showCopied]);

  return (
    <div className="pdf-viewer">
      <header className="pdf-viewer-header">
        <span className="pdf-viewer-title">{file.name}</span>
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
      </header>
      <div className="pdf-viewer-content">
        <PdfDeck sourcePath={file.path} title={file.name} />
      </div>
      {copied && <Toast message="Path copied" onClose={dismissCopied} />}
    </div>
  );
}
