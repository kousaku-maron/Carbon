import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  createLinkEditTransaction,
  createRemoveLinkTransaction,
  getLinkAtPosition,
  isEditableLinkHref,
  type LinkReference,
} from "../../lib/tiptap/carbon-link-extension/link-editing";

type LinkPopoverProps = {
  editor: Editor;
  editorRootRef: RefObject<HTMLDivElement | null>;
};

type HoveredLink = LinkReference & {
  element: HTMLElement;
};

type PopoverPosition = {
  left: number;
  top: number;
};

const HIDE_DELAY_MS = 140;
const VIEWPORT_PADDING = 12;
const POPOVER_GAP = 8;

export function LinkPopover({ editor, editorRootRef }: LinkPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const copiedTimeoutRef = useRef<number | null>(null);
  const [hoveredLink, setHoveredLink] = useState<HoveredLink | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftHref, setDraftHref] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [hrefInvalid, setHrefInvalid] = useState(false);
  const [copied, setCopied] = useState(false);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current === null) return;
    window.clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = null;
  }, []);

  const closePopover = useCallback(() => {
    clearHideTimeout();
    setHoveredLink(null);
    setPosition(null);
    setEditing(false);
    setHrefInvalid(false);
    setCopied(false);
  }, [clearHideTimeout]);

  const scheduleClose = useCallback(() => {
    clearHideTimeout();
    hideTimeoutRef.current = window.setTimeout(() => {
      hideTimeoutRef.current = null;
      setHoveredLink((current) => {
        if (!current) return current;
        setPosition(null);
        setCopied(false);
        return null;
      });
    }, HIDE_DELAY_MS);
  }, [clearHideTimeout]);

  const readHoveredLink = useCallback(
    (element: HTMLElement): HoveredLink | null => {
      if (!element.isConnected) return null;

      try {
        const position = editor.view.posAtDOM(element, 0);
        const link = getLinkAtPosition(editor.state, position);
        return link ? { ...link, element } : null;
      } catch {
        return null;
      }
    },
    [editor],
  );

  useEffect(() => {
    const root = editorRootRef.current;
    if (!root) return;

    const handlePointerOver = (event: PointerEvent) => {
      if (editing) return;
      const target = event.target as HTMLElement | null;
      const linkElement = target?.closest<HTMLElement>("[data-href]");
      if (!linkElement || !root.contains(linkElement)) return;

      clearHideTimeout();
      const link = readHoveredLink(linkElement);
      if (!link) return;

      setHoveredLink(link);
      setEditing(false);
      setHrefInvalid(false);
      setCopied(false);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const linkElement = target?.closest<HTMLElement>("[data-href]");
      if (!linkElement || !root.contains(linkElement)) return;

      const relatedTarget = event.relatedTarget as Node | null;
      if (
        relatedTarget &&
        (linkElement.contains(relatedTarget) ||
          popoverRef.current?.contains(relatedTarget))
      ) {
        return;
      }

      if (!editing) scheduleClose();
    };

    root.addEventListener("pointerover", handlePointerOver);
    root.addEventListener("pointerout", handlePointerOut);
    return () => {
      root.removeEventListener("pointerover", handlePointerOver);
      root.removeEventListener("pointerout", handlePointerOut);
    };
  }, [
    clearHideTimeout,
    editing,
    editorRootRef,
    readHoveredLink,
    scheduleClose,
  ]);

  const updatePosition = useCallback(() => {
    const popover = popoverRef.current;
    if (!hoveredLink?.element.isConnected || !popover) {
      closePopover();
      return;
    }

    const anchorRect = hoveredLink.element.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    let left = anchorRect.left;
    let top = anchorRect.bottom + POPOVER_GAP;

    if (top + popoverRect.height > window.innerHeight - VIEWPORT_PADDING) {
      top = anchorRect.top - popoverRect.height - POPOVER_GAP;
    }

    left = Math.min(
      Math.max(VIEWPORT_PADDING, left),
      Math.max(
        VIEWPORT_PADDING,
        window.innerWidth - popoverRect.width - VIEWPORT_PADDING,
      ),
    );
    top = Math.max(VIEWPORT_PADDING, top);
    setPosition({ left, top });
  }, [closePopover, hoveredLink]);

  useLayoutEffect(() => {
    if (!hoveredLink) return;
    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [editing, hoveredLink, updatePosition]);

  useEffect(
    () => () => {
      clearHideTimeout();
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    },
    [clearHideTimeout],
  );

  const startEditing = () => {
    if (!hoveredLink) return;
    clearHideTimeout();
    setDraftHref(hoveredLink.href);
    setDraftLabel(hoveredLink.label);
    setHrefInvalid(false);
    setEditing(true);
  };

  const applyDraft = useCallback((): boolean => {
    if (!hoveredLink || !isEditableLinkHref(draftHref)) {
      setHrefInvalid(true);
      return false;
    }

    const transaction = createLinkEditTransaction(
      editor.state,
      hoveredLink,
      draftHref,
      draftLabel,
    );
    if (transaction) editor.view.dispatch(transaction);
    setHrefInvalid(false);
    return true;
  }, [draftHref, draftLabel, editor, hoveredLink]);

  useEffect(() => {
    if (!editing) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && popoverRef.current?.contains(target)) return;
      if (applyDraft()) closePopover();
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    };
  }, [applyDraft, closePopover, editing]);

  const handleEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (applyDraft()) closePopover();
  };

  const handleEditBlur = (event: React.FocusEvent<HTMLFormElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    if (applyDraft()) closePopover();
  };

  const handleEditKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closePopover();
  };

  const handleCopy = () => {
    if (!hoveredLink) return;

    void navigator.clipboard
      .writeText(hoveredLink.href)
      .then(() => {
        setCopied(true);
        if (copiedTimeoutRef.current !== null) {
          window.clearTimeout(copiedTimeoutRef.current);
        }
        copiedTimeoutRef.current = window.setTimeout(() => {
          setCopied(false);
          copiedTimeoutRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  };

  const handleRemove = () => {
    if (!hoveredLink) return;
    const transaction = createRemoveLinkTransaction(
      editor.state,
      hoveredLink,
    );
    if (transaction) editor.view.dispatch(transaction);
    closePopover();
    editor.commands.focus();
  };

  if (!hoveredLink) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className={`note-editor-link-popover note-editor-link-popover--${editing ? "edit" : "preview"}`}
      style={
        position
          ? { left: position.left, top: position.top }
          : { left: -10_000, top: -10_000 }
      }
      onPointerEnter={clearHideTimeout}
      onPointerLeave={() => {
        if (!editing) scheduleClose();
      }}
    >
      {!editing ? (
        <div
          className="note-editor-link-preview"
          role="toolbar"
          aria-label="Link options"
        >
          <div className="note-editor-link-target" title={hoveredLink.href}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
            </svg>
            <span>{hoveredLink.href}</span>
          </div>
          <button
            type="button"
            className="note-editor-link-icon-button"
            onClick={handleCopy}
            aria-label={copied ? "Link copied" : "Copy link"}
            title={copied ? "Copied" : "Copy link"}
          >
            {copied ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12 4 4L19 6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="8" y="8" width="11" height="11" rx="2" />
                <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="note-editor-link-edit-button"
            onClick={startEditing}
          >
            Edit
          </button>
        </div>
      ) : (
        <form
          className="note-editor-link-edit-form"
          role="dialog"
          aria-label="Edit link"
          onSubmit={handleEditSubmit}
          onBlur={handleEditBlur}
          onKeyDown={handleEditKeyDown}
        >
          <label className="note-editor-link-field">
            <span>Page or URL</span>
            <input
              type="text"
              value={draftHref}
              onChange={(event) => {
                setDraftHref(event.target.value);
                setHrefInvalid(false);
              }}
              aria-invalid={hrefInvalid}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          {hrefInvalid ? (
            <div className="note-editor-link-field-error" role="alert">
              Enter a valid link
            </div>
          ) : null}
          <label className="note-editor-link-field">
            <span>Link title</span>
            <input
              type="text"
              value={draftLabel}
              onChange={(event) => setDraftLabel(event.target.value)}
            />
          </label>
          <div className="note-editor-link-edit-actions">
            <button
              type="button"
              className="note-editor-link-remove-button"
              onClick={handleRemove}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 10v7M14 10v7" />
              </svg>
              Remove link
            </button>
          </div>
        </form>
      )}
    </div>,
    document.body,
  );
}
