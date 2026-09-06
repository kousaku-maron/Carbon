import { useEffect, useRef } from "react";
import type { NoteContent, NoteViewMode } from "../lib/types";
import { CopyMarkdownIcon } from "./CopyMarkdownIcon";

type NoteViewHeaderProps = {
  note: NoteContent;
  viewMode: NoteViewMode;
  onViewModeChange: (mode: NoteViewMode) => void;
  onCopyPath: () => void;
  onCopyMarkdown: () => void;
  copied: "markdown" | "path" | false;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  pdfExportActions?: {
    busy: boolean;
    onExport: () => void;
  };
};

export function NoteViewHeader(props: NoteViewHeaderProps) {
  const {
    note,
    viewMode,
    onViewModeChange,
    onCopyPath,
    onCopyMarkdown,
    copied,
    menuOpen,
    onMenuOpenChange,
    pdfExportActions,
  } = props;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      onMenuOpenChange(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onMenuOpenChange(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, onMenuOpenChange]);

  return (
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
      <div className="note-editor-header-spacer" />
      <button
        type="button"
        className="note-editor-copy-btn"
        onClick={onCopyPath}
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
        onClick={onCopyMarkdown}
        title="Copy as Markdown"
      >
        {copied === "markdown" ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <CopyMarkdownIcon />
        )}
      </button>
      <div className="note-header-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="note-editor-copy-btn note-header-menu-btn"
          aria-label="Open note menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => onMenuOpenChange(!menuOpen)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="3.25" cy="8" r="1.1" fill="currentColor" />
            <circle cx="8" cy="8" r="1.1" fill="currentColor" />
            <circle cx="12.75" cy="8" r="1.1" fill="currentColor" />
          </svg>
        </button>
        {menuOpen ? (
          <div className="note-header-menu" role="menu" aria-label="Note actions">
            <div className="note-header-menu-item note-header-menu-item--static">
              <span className="note-header-menu-item-label">Preview edit</span>
              <button
                type="button"
                role="switch"
                aria-checked={viewMode === "visual"}
                aria-label="Toggle preview edit mode"
                className={`note-header-switch${viewMode === "visual" ? " is-on" : ""}`}
                onClick={() => {
                  onViewModeChange(viewMode === "visual" ? "plaintext" : "visual");
                }}
              >
                <span className="note-header-switch-track">
                  <span className="note-header-switch-thumb" />
                </span>
              </button>
            </div>
            <button
              type="button"
              className="note-header-menu-item"
              onClick={() => {
                onMenuOpenChange(false);
                pdfExportActions?.onExport();
              }}
              disabled={pdfExportActions?.busy}
            >
              <span className="note-header-menu-item-label">
                {pdfExportActions?.busy ? "Exporting PDF..." : "Export PDF"}
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
