import { useEffect, useRef, useState } from "react";
import type { NoteContent, NoteViewMode } from "../lib/types";

type ShareActions =
  | {
      state: "loading";
    }
  | {
      state: "unpublished";
      busy: boolean;
      busyLabel?: string;
      onShare: () => void;
    }
  | {
      state: "published";
      busy: boolean;
      busyLabel?: string;
      onCopyLink: () => void;
      onRepublish: () => void;
      onRevoke: () => void;
    };

type NoteViewHeaderProps = {
  note: NoteContent;
  viewMode: NoteViewMode;
  onViewModeChange: (mode: NoteViewMode) => void;
  onCopyPath: () => void;
  onCopyMarkdown: () => void;
  copied: "markdown" | "path" | false;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  shareActions?: ShareActions;
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
    shareActions,
    pdfExportActions,
  } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen && !shareMenuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (shareMenuRef.current?.contains(target)) return;
      onMenuOpenChange(false);
      setShareMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onMenuOpenChange(false);
        setShareMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, onMenuOpenChange, shareMenuOpen]);

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
      {shareActions?.state === "loading" ? (
        <button
          type="button"
          className="note-editor-copy-btn note-editor-share-icon-btn note-editor-share-loading-btn"
          disabled
          title="Checking publish status"
          aria-label="Checking publish status"
        >
          <svg className="note-editor-spinner" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.3" opacity="0.28" />
            <path d="M8 2.75C9.5 4.25 10.25 6 10.25 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
      {shareActions?.state === "unpublished" ? (
        <button
          type="button"
          className="note-editor-copy-btn note-editor-share-icon-btn"
          onClick={shareActions.onShare}
          disabled={shareActions.busy}
          title={shareActions.busy ? shareActions.busyLabel ?? "Publishing..." : "Share note"}
          aria-label={shareActions.busy ? shareActions.busyLabel ?? "Publishing..." : "Share note"}
        >
          {shareActions.busy ? (
            <svg className="note-editor-spinner" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.3" opacity="0.28" />
              <path d="M8 2.75C9.5 4.25 10.25 6 10.25 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2.75 8H13.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M8 2.75C9.5 4.25 10.25 6 10.25 8C10.25 10 9.5 11.75 8 13.25C6.5 11.75 5.75 10 5.75 8C5.75 6 6.5 4.25 8 2.75Z" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )}
        </button>
      ) : null}
      {shareActions?.state === "published" ? (
        <div className="note-header-menu-wrap note-header-share-menu-wrap" ref={shareMenuRef}>
          <button
            type="button"
            className="note-editor-share-menu-btn"
            onClick={() => {
              onMenuOpenChange(false);
              setShareMenuOpen((current) => !current);
            }}
            disabled={shareActions.busy}
            title="Published note actions"
            aria-label="Open publish menu"
            aria-haspopup="menu"
            aria-expanded={shareMenuOpen}
          >
            {shareActions.busy ? (
              <>
                <svg className="note-editor-spinner" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.3" opacity="0.28" />
                  <path d="M8 2.75C9.5 4.25 10.25 6 10.25 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <span>{shareActions.busyLabel ?? "Publishing..."}</span>
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M2.75 8H13.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M8 2.75C9.5 4.25 10.25 6 10.25 8C10.25 10 9.5 11.75 8 13.25C6.5 11.75 5.75 10 5.75 8C5.75 6 6.5 4.25 8 2.75Z" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                <span>Published</span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M4.5 6.5L8 10L11.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </button>
          {shareMenuOpen ? (
            <div className="note-header-menu note-header-share-menu" role="menu" aria-label="Publish actions">
              <button
                type="button"
                className="note-header-menu-item"
                onClick={() => {
                  setShareMenuOpen(false);
                  shareActions.onCopyLink();
                }}
                disabled={shareActions.busy}
              >
                <span className="note-header-menu-item-label">Copy Link</span>
              </button>
              <button
                type="button"
                className="note-header-menu-item"
                onClick={() => {
                  setShareMenuOpen(false);
                  shareActions.onRepublish();
                }}
                disabled={shareActions.busy}
              >
                <span className="note-header-menu-item-label">
                  {shareActions.busy ? "Publishing..." : "Republish"}
                </span>
              </button>
              <button
                type="button"
                className="note-header-menu-item note-header-menu-item--danger"
                onClick={() => {
                  setShareMenuOpen(false);
                  shareActions.onRevoke();
                }}
                disabled={shareActions.busy}
              >
                <span className="note-header-menu-item-label">Revoke</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="5.5" y="5.5" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H4.5C3.67 2 3 2.67 3 3.5V10C3 10.83 3.67 11.5 4.5 11.5H5.5" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
        )}
      </button>
      <div className="note-header-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="note-editor-copy-btn note-header-menu-btn"
          aria-label="Open note menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setShareMenuOpen(false);
            onMenuOpenChange(!menuOpen);
          }}
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
