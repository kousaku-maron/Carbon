import { EditorContent, useEditor } from "@tiptap/react";
import { CARBON_PROSE_CLASS } from "@carbon/rendering";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createShare, listShares, republishShare, revokeShare } from "../../lib/api";
import { CarbonCodeBlock } from "../../lib/tiptap/carbon-code-block-extension";
import { CarbonImage } from "../../lib/tiptap/carbon-image-extension";
import { CarbonLink, buildNotePathClipboardItem, type NoteLinkSuggestionItem } from "../../lib/tiptap/carbon-link-extension";
import { CarbonPdf } from "../../lib/tiptap/carbon-pdf-extension";
import { CarbonSearch } from "../../lib/tiptap/carbon-search-extension";
import { CarbonSlashCommand } from "../../lib/tiptap/carbon-slash-command-extension";
import { CarbonVideo } from "../../lib/tiptap/carbon-video-extension";
import { API_BASE_URL } from "../../lib/api";
import { ENABLE_CLOUD_IMAGE_UPLOAD } from "../../lib/app-config";
import { debounce } from "../../lib/debounce";
import { useCopyFeedback } from "../../lib/hooks/use-copy-feedback";
import { resolveRelativePath, validateLinkTarget } from "../../lib/link-utils";
import { formatPdfExportError, startNotePdfExport } from "../../lib/pdf-export";
import { analyzeShareInput } from "../../lib/share/analyze-share-input";
import { buildShareFormData } from "../../lib/share/build-share-form-data";
import { formatShareError } from "../../lib/share/format-share-error";
import type { ShareSummary } from "../../lib/share/types";
import { formatMarkdownForCopy } from "../../lib/tiptap/markdown";
import type { NoteContent, NoteIndexEntry, NoteViewMode } from "../../lib/types";
import { MediaPreviewHost } from "./MediaPreviewHost";
import { buildNoteLinkSuggestions } from "./build-note-link-suggestions";
import { ShareConfirmDialog } from "../share/ShareConfirmDialog";
import { NoteViewHeader } from "../note-view-header";
import { Toast } from "../Toast";
import { useNoteSearch } from "./use-note-search";
import { useEditorZoom } from "./use-editor-zoom";
import { useImageDropUpload } from "./use-image-drop-upload";
import { useMediaPreview } from "./use-media-preview";

type NoteEditorProps = {
  note: NoteContent;
  onSave: (path: string, content: string) => Promise<void>;
  onBufferChange?: (path: string, content: string) => void;
  vaultPath: string;
  noteIndex: NoteIndexEntry[];
  onNavigateToNote?: (absolutePath: string) => void;
  onLinkError?: (message: string) => void;
  viewMode: NoteViewMode;
  onViewModeChange: (mode: NoteViewMode) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
};

type TableAxis = "row" | "column";
type TableHandleKind = TableAxis | "table";

type TableHandleBounds = {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

type TableHoverControls = {
  frameLeft: number;
  frameTop: number;
  frameWidth: number;
  frameHeight: number;
  tableHandle: TableHandleBounds;
  rowHandles: TableHandleBounds[];
  columnHandles: TableHandleBounds[];
};

type TableHoverAction = "addColumnAfter" | "addRowAfter";
type TableMenuAction = "insertBefore" | "insertAfter" | "delete";

const TABLE_CONTROL_GAP = 10;
const TABLE_ROW_HANDLE_WIDTH = 20;
const TABLE_ROW_HANDLE_HEIGHT = 42;
const TABLE_COLUMN_HANDLE_WIDTH = 38;
const TABLE_COLUMN_HANDLE_HEIGHT = 18;
const TABLE_CORNER_HANDLE_SIZE = 20;

function getHoverTable(target: EventTarget | null): HTMLTableElement | null {
  if (!(target instanceof HTMLElement)) return null;

  const wrapper = target.closest(".tableWrapper");
  if (wrapper instanceof HTMLElement) {
    const wrappedTable = wrapper.querySelector("table");
    if (wrappedTable instanceof HTMLTableElement) {
      return wrappedTable;
    }
  }

  const table = target.closest("table");
  return table instanceof HTMLTableElement ? table : null;
}

function buildTableHoverControls(
  container: HTMLDivElement,
  table: HTMLTableElement,
): TableHoverControls | null {
  if (!container.contains(table)) return null;

  const wrapper = table.closest(".tableWrapper");
  const frame = wrapper instanceof HTMLElement ? wrapper : table;
  const containerRect = container.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const scrollLeft = container.scrollLeft;
  const scrollTop = container.scrollTop;

  const frameLeft = frameRect.left - containerRect.left + scrollLeft;
  const frameTop = frameRect.top - containerRect.top + scrollTop;
  const tableLeft = tableRect.left - containerRect.left + scrollLeft;
  const tableTop = tableRect.top - containerRect.top + scrollTop;
  const tableHandle = {
    index: 0,
    left: tableLeft - (TABLE_CORNER_HANDLE_SIZE / 2),
    top: tableTop - (TABLE_CORNER_HANDLE_SIZE / 2),
    width: TABLE_CORNER_HANDLE_SIZE,
    height: TABLE_CORNER_HANDLE_SIZE,
  };
  const rowHandles = Array.from(table.rows).map((row, index) => {
    const rowRect = row.getBoundingClientRect();
    return {
      index,
      left: tableLeft - (TABLE_ROW_HANDLE_WIDTH / 2),
      top: rowRect.top - containerRect.top + scrollTop + (rowRect.height / 2) - (TABLE_ROW_HANDLE_HEIGHT / 2),
      width: TABLE_ROW_HANDLE_WIDTH,
      height: TABLE_ROW_HANDLE_HEIGHT,
    };
  });
  const firstRow = table.rows.item(0);
  const columnHandles = firstRow
    ? Array.from(firstRow.cells).map((cell, index) => {
      const cellRect = cell.getBoundingClientRect();
      return {
        index,
        left: cellRect.left - containerRect.left + scrollLeft + (cellRect.width / 2) - (TABLE_COLUMN_HANDLE_WIDTH / 2),
        top: tableTop - (TABLE_COLUMN_HANDLE_HEIGHT / 2),
        width: TABLE_COLUMN_HANDLE_WIDTH,
        height: TABLE_COLUMN_HANDLE_HEIGHT,
      };
    })
    : [];

  return {
    frameLeft,
    frameTop,
    frameWidth: frameRect.width,
    frameHeight: frameRect.height,
    tableHandle,
    rowHandles,
    columnHandles,
  };
}

function getStructureCells(
  table: HTMLTableElement,
  kind: TableAxis,
  index: number,
): HTMLTableCellElement[] {
  if (kind === "row") {
    const row = table.rows.item(index);
    return row ? Array.from(row.cells) : [];
  }

  return Array.from(table.rows)
    .map((row) => row.cells.item(index))
    .filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement);
}

function getCellNodePosition(editor: NonNullable<ReturnType<typeof useEditor>>, cell: HTMLTableCellElement): number | null {
  try {
    return editor.view.posAtDOM(cell, 0);
  } catch {
    return null;
  }
}

function getHandleAnchorPosition(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  table: HTMLTableElement,
  kind: TableHandleKind,
  index: number,
): number | null {
  if (kind === "table") {
    const firstRow = table.rows.item(0);
    const firstCell = firstRow?.cells.item(0);
    if (!(firstCell instanceof HTMLTableCellElement)) return null;
    const selectionTarget = firstCell.querySelector("p, th, td, div") ?? firstCell;
    try {
      return editor.view.posAtDOM(selectionTarget, 0);
    } catch {
      return null;
    }
  }

  const cells = getStructureCells(table, kind, index);
  const targetCell = cells[0];
  if (!(targetCell instanceof HTMLTableCellElement)) return null;

  const selectionTarget = targetCell.querySelector("p, th, td, div") ?? targetCell;

  try {
    return editor.view.posAtDOM(selectionTarget, 0);
  } catch {
    return null;
  }
}

type TableHandleTarget = {
  kind: TableHandleKind;
  index: number;
};

type SelectedTableHandle = TableHandleTarget & {
  anchorPos: number;
};

function getHandleBounds(
  controls: TableHoverControls,
  handle: TableHandleTarget,
): TableHandleBounds | null {
  if (handle.kind === "table") {
    return controls.tableHandle;
  }
  const candidates = handle.kind === "row" ? controls.rowHandles : controls.columnHandles;
  return candidates.find((candidate) => candidate.index === handle.index) ?? null;
}

export function NoteEditor(props: NoteEditorProps) {
  const {
    note,
    onSave,
    onBufferChange,
    vaultPath,
    noteIndex,
    onNavigateToNote,
    onLinkError,
    viewMode,
    onViewModeChange,
    menuOpen,
    onMenuOpenChange,
  } = props;
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
  const [shareSummary, setShareSummary] = useState<ShareSummary | null>(null);
  const [shareLoading, setShareLoading] = useState(true);
  const [sharePendingAction, setSharePendingAction] = useState<null | "publishing" | "republishing" | "revoking">(null);
  const [shareMessage, setShareMessage] = useState("");
  const [pdfExportPending, setPdfExportPending] = useState(false);
  const [tableHoverControls, setTableHoverControls] = useState<TableHoverControls | null>(null);
  const [hoveredTableHandle, setHoveredTableHandle] = useState<TableHandleTarget | null>(null);
  const [selectedTableHandle, setSelectedTableHandle] = useState<SelectedTableHandle | null>(null);
  const [pdfExportNotice, setPdfExportNotice] = useState<null | {
    kind: "success" | "error";
    message: string;
  }>(null);
  const [shareConfirmOpen, setShareConfirmOpen] = useState(false);
  const hoveredTableRef = useRef<HTMLTableElement | null>(null);
  const selectedTableRef = useRef<HTMLTableElement | null>(null);
  const shareBusy = sharePendingAction !== null;
  const shareProgressMessage =
    sharePendingAction === "revoking"
      ? "Revoking..."
      : sharePendingAction === "publishing" || sharePendingAction === "republishing"
        ? "Publishing..."
        : "";

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
    noteIndex,
  });
  useEffect(() => {
    latestRef.current = {
      onNavigateToNote,
      onLinkError,
      onBufferChange,
      debouncedSave,
      noteIndex,
    };
    return () => latestRef.current.debouncedSave.cancel();
  }, [onNavigateToNote, onLinkError, onBufferChange, debouncedSave, noteIndex]);

  useEffect(() => {
    let cancelled = false;
    setShareSummary(null);
    setShareLoading(true);
    setShareMessage("");

    void listShares({ status: "active", sourceVaultPath: vaultPath, sourceNotePath: note.id })
      .then((items) => {
        if (!cancelled) {
          setShareSummary(items[0] ?? null);
          setShareLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShareSummary(null);
          setShareLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [note.id, vaultPath]);

  useEffect(() => {
    if (!shareMessage) return;

    const timeoutId = window.setTimeout(() => {
      setShareMessage("");
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [shareMessage]);

  useEffect(() => {
    if (!pdfExportNotice || pdfExportNotice.kind !== "success") return;

    const timeoutId = window.setTimeout(() => {
      setPdfExportNotice(null);
    }, 2400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pdfExportNotice]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false, codeBlock: false }),
        CarbonCodeBlock.configure({ languageClassPrefix: "language-" }),
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
              buildNoteLinkSuggestions(latestRef.current.noteIndex, note.path, query),
          },
        }),
        CarbonImage.configure({
          inline: false,
          apiUrl: API_BASE_URL,
          uploadEnabled: ENABLE_CLOUD_IMAGE_UPLOAD,
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
        CarbonSearch,
        CarbonSlashCommand.configure({
          commands: [
            {
              id: "table",
              title: "Table",
              description: "Insert a 3 x 3 table",
              query: "table",
              execute: (editor, range) =>
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: false })
                  .run(),
            },
          ],
        }),
        TableKit,
        TaskList,
        TaskItem.configure({ nested: true }),
        Markdown.configure({
          markedOptions: {
            gfm: true,
            breaks: false,
          },
        }),
      ],
      editable: true,
      editorProps: {
        attributes: {
          class: CARBON_PROSE_CLASS,
        },
      },
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

  const {
    editorContentRef,
    searchInputRef,
    isSearchOpen,
    searchMatchIndex,
    searchMatchCount,
    searchQuery,
    applySearchQuery,
    closeSearch,
    handleFindNext,
    handleFindPrevious,
    handleSearchInputKeyDown,
  } = useNoteSearch({
    editor,
    noteDocKey: note.docKey,
  });

  const syncVisibleTableControls = useCallback((preferredTable: HTMLTableElement | null = null) => {
    const table = preferredTable ?? hoveredTableRef.current ?? selectedTableRef.current;
    const container = editorContentRef.current;

    if (!container || !table || !container.contains(table)) {
      setTableHoverControls(null);
      return;
    }

    const next = buildTableHoverControls(container, table);
    setTableHoverControls(next);
  }, [editorContentRef]);

  const hideTableHoverControls = useCallback(() => {
    hoveredTableRef.current = null;
    if (!selectedTableRef.current) {
      setTableHoverControls(null);
      setHoveredTableHandle(null);
      return;
    }

    syncVisibleTableControls(selectedTableRef.current);
  }, [syncVisibleTableControls]);

  const updateTableHoverControls = useCallback((table: HTMLTableElement | null) => {
    hoveredTableRef.current = table;
    if (!table) {
      hideTableHoverControls();
      return;
    }

    syncVisibleTableControls(table);
  }, [hideTableHoverControls, syncVisibleTableControls]);

  const clearSelectedTableHandle = useCallback(() => {
    selectedTableRef.current = null;
    setSelectedTableHandle(null);
    setHoveredTableHandle(null);
    if (hoveredTableRef.current) {
      syncVisibleTableControls(hoveredTableRef.current);
    } else {
      setTableHoverControls(null);
    }
  }, [syncVisibleTableControls]);

  const selectTableHandle = useCallback((kind: TableHandleKind, index: number) => {
    if (!editor) return false;

    const table = hoveredTableRef.current ?? selectedTableRef.current;
    if (!table) return false;

    const anchorPos = getHandleAnchorPosition(editor, table, kind, index);
    if (anchorPos === null) return false;

    selectedTableRef.current = table;
    setSelectedTableHandle({ kind, index, anchorPos });
    syncVisibleTableControls(table);

    editor.commands.focus();
    void editor.commands.setTextSelection(anchorPos);
    return true;
  }, [editor, syncVisibleTableControls]);

  const runTableHoverAction = useCallback((action: TableHoverAction) => {
    if (!editor) return;

    const table = hoveredTableRef.current ?? selectedTableRef.current;
    if (!table) return;

    const rows = Array.from(table.rows);
    const lastRow = rows.at(-1);
    const lastCell = lastRow ? Array.from(lastRow.cells).at(-1) : null;
    if (!(lastCell instanceof HTMLTableCellElement)) return;

    const selectionTarget =
      lastCell.querySelector("p, th, td, div") ?? lastCell;

    let selectionPosition = 0;
    try {
      selectionPosition = editor.view.posAtDOM(selectionTarget, 0);
    } catch {
      return;
    }

    editor.commands.focus();

    const didSelect = editor.commands.setTextSelection(selectionPosition);
    if (!didSelect) {
      return;
    }

    const didRun =
      action === "addColumnAfter"
        ? editor.commands.addColumnAfter()
        : editor.commands.addRowAfter();

    if (didRun) {
      syncVisibleTableControls(table);
    }
  }, [editor, syncVisibleTableControls]);

  const runTableMenuAction = useCallback((kind: TableHandleKind, index: number, action: TableMenuAction) => {
    if (!editor) return;

    const table = selectedTableRef.current ?? hoveredTableRef.current;
    if (!table) return;

    const selectedHandle =
      selectedTableHandle?.kind === kind && selectedTableHandle.index === index
        ? selectedTableHandle
        : null;

    const anchorPos = selectedHandle?.anchorPos ?? getHandleAnchorPosition(editor, table, kind, index);
    if (anchorPos === null) return;

    selectedTableRef.current = table;
    setSelectedTableHandle({ kind, index, anchorPos });
    editor.commands.focus();

    const didSelect = editor.commands.setTextSelection(anchorPos);
    if (!didSelect) return;

    const didRun = (() => {
      if (kind === "table") {
        return action === "delete" ? editor.commands.deleteTable() : false;
      }

      if (kind === "row") {
        if (action === "insertBefore") return editor.commands.addRowBefore();
        if (action === "insertAfter") return editor.commands.addRowAfter();
        return editor.commands.deleteRow();
      }

      if (action === "insertBefore") return editor.commands.addColumnBefore();
      if (action === "insertAfter") return editor.commands.addColumnAfter();
      return editor.commands.deleteColumn();
    })();

    if (didRun) {
      clearSelectedTableHandle();
      syncVisibleTableControls(table);
    }
  }, [clearSelectedTableHandle, editor, selectedTableHandle, syncVisibleTableControls]);

  const handleEditorContentMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      hideTableHoverControls();
      return;
    }

    if (target.closest("[data-table-hover-controls]")) {
      return;
    }

    updateTableHoverControls(getHoverTable(target));
  }, [hideTableHoverControls, updateTableHoverControls]);

  const handleEditorContentMouseLeave = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof HTMLElement && nextTarget.closest("[data-table-hover-controls]")) {
      return;
    }

    hideTableHoverControls();
  }, [hideTableHoverControls]);

  const selectedHandleBounds = tableHoverControls && selectedTableHandle
    ? getHandleBounds(tableHoverControls, selectedTableHandle)
    : null;

  useEffect(() => {
    const container = editorContentRef.current;
    if (!container) return;

    const clearClasses = () => {
      container.querySelectorAll(".note-editor-table-cell--hover-row").forEach((node) => node.classList.remove("note-editor-table-cell--hover-row"));
      container.querySelectorAll(".note-editor-table-cell--hover-column").forEach((node) => node.classList.remove("note-editor-table-cell--hover-column"));
      container.querySelectorAll(".note-editor-table-cell--selected-row").forEach((node) => node.classList.remove("note-editor-table-cell--selected-row"));
      container.querySelectorAll(".note-editor-table-cell--selected-column").forEach((node) => node.classList.remove("note-editor-table-cell--selected-column"));
    };

    clearClasses();

    const applyClasses = (
      table: HTMLTableElement | null,
      handle: TableHandleTarget | null,
      hoverClassName: string,
    ) => {
      if (!table || !handle) return;
      if (handle.kind === "table") return;
      getStructureCells(table, handle.kind, handle.index).forEach((cell) => {
        cell.classList.add(hoverClassName);
      });
    };

    applyClasses(hoveredTableRef.current, hoveredTableHandle, hoveredTableHandle?.kind === "row" ? "note-editor-table-cell--hover-row" : "note-editor-table-cell--hover-column");
    applyClasses(selectedTableRef.current, selectedTableHandle, selectedTableHandle?.kind === "row" ? "note-editor-table-cell--selected-row" : "note-editor-table-cell--selected-column");

    return clearClasses;
  }, [editorContentRef, hoveredTableHandle, selectedTableHandle]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-table-hover-controls]")) return;
      clearSelectedTableHandle();
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [clearSelectedTableHandle]);

  useEffect(() => {
    const container = editorContentRef.current;
    if (!container) return;

    const handleReposition = () => {
      syncVisibleTableControls();
    };

    container.addEventListener("scroll", handleReposition, { passive: true });
    window.addEventListener("resize", handleReposition);

    return () => {
      container.removeEventListener("scroll", handleReposition);
      window.removeEventListener("resize", handleReposition);
    };
  }, [editorContentRef, syncVisibleTableControls]);

  const buildCurrentShareFormData = useCallback(async () => {
    const markdownBody = editor?.getMarkdown() ?? note.body;
    const analysis = analyzeShareInput({
      noteId: note.id,
      notePath: note.path,
      vaultPath,
      markdownBody,
      title: note.name,
    });
    return buildShareFormData(analysis);
  }, [editor, note.body, note.id, note.name, note.path, vaultPath]);
  const handleShare = useCallback(async () => {
    setSharePendingAction("publishing");
    try {
      const formData = await buildCurrentShareFormData();
      const result = await createShare(formData);
      setShareSummary(result.share);
      setShareMessage("Shared");
      setShareConfirmOpen(false);
    } catch (error) {
      setShareMessage(formatShareError(error, "Failed to share"));
    } finally {
      setSharePendingAction(null);
    }
  }, [buildCurrentShareFormData]);

  const handleRepublish = useCallback(async () => {
    if (!shareSummary) return;
    setSharePendingAction("republishing");
    try {
      const formData = await buildCurrentShareFormData();
      const result = await republishShare(shareSummary.id, formData);
      setShareSummary(result.share);
      setShareMessage("Republished");
    } catch (error) {
      setShareMessage(formatShareError(error, "Failed to republish"));
    } finally {
      setSharePendingAction(null);
    }
  }, [buildCurrentShareFormData, shareSummary]);

  const handleRevoke = useCallback(async () => {
    if (!shareSummary) return;
    setSharePendingAction("revoking");
    try {
      await revokeShare(shareSummary.id);
      setShareSummary(null);
      setShareMessage("Share revoked");
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : "Failed to revoke");
    } finally {
      setSharePendingAction(null);
    }
  }, [shareSummary]);

  const handleCopyLink = useCallback(() => {
    if (!shareSummary) return;
    navigator.clipboard.writeText(shareSummary.publicUrl).then(() => {
      setShareMessage("Public link copied");
    });
  }, [shareSummary]);
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
        markdownBody: editor?.getMarkdown() ?? note.body,
      });
      setPdfExportNotice({ kind: "success", message: `PDF saved: ${targetPath}` });
    } catch (cause) {
      const message = formatPdfExportError(cause);
      console.error("[pdf-export]", message, cause);
      setPdfExportNotice({ kind: "error", message });
    } finally {
      setPdfExportPending(false);
    }
  }, [editor, note.body, note.id, note.name, note.path, pdfExportPending, vaultPath]);
  const { handleContentDragOver, handleContentDrop } = useImageDropUpload(
    editor,
    ENABLE_CLOUD_IMAGE_UPLOAD,
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
      <NoteViewHeader
        note={note}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
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
        shareActions={
          shareLoading
            ? {
                state: "loading",
              }
            : shareSummary
            ? {
                state: "published",
                busy: shareBusy,
                busyLabel: shareProgressMessage || "Publishing...",
                onCopyLink: handleCopyLink,
                onRepublish: handleRepublish,
                onRevoke: handleRevoke,
              }
            : {
                state: "unpublished",
                busy: shareBusy,
                busyLabel: shareProgressMessage || "Publishing...",
                onShare: () => setShareConfirmOpen(true),
              }
        }
      />
      {isSearchOpen ? (
        <div className="note-editor-searchbar" role="search" aria-label="Find in note">
          <input
            ref={searchInputRef}
            type="text"
            className="note-editor-search-input"
            value={searchQuery}
            onChange={(event) => applySearchQuery(event.target.value)}
            onKeyDown={handleSearchInputKeyDown}
            placeholder="Search text"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <div className="note-editor-search-actions">
            {searchQuery ? (
              <>
                <div className="note-editor-search-meta" aria-live="polite">
                  {searchMatchCount > 0 ? `${searchMatchIndex} of ${searchMatchCount}` : "No results"}
                </div>
                <button
                  type="button"
                  className="note-editor-search-btn"
                  onClick={handleFindPrevious}
                  disabled={searchMatchCount === 0}
                  aria-label="Previous match"
                  title="Previous match"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="note-editor-search-btn"
                  onClick={handleFindNext}
                  disabled={searchMatchCount === 0}
                  aria-label="Next match"
                  title="Next match"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="note-editor-search-close"
              onClick={closeSearch}
              aria-label="Close search"
              title="Close search"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={editorContentRef}
        className="note-editor-content"
        style={editorContentStyle}
        onDragOver={handleContentDragOver}
        onDrop={handleContentDrop}
        onMouseMove={handleEditorContentMouseMove}
        onMouseLeave={handleEditorContentMouseLeave}
      >
        <EditorContent editor={editor} />
        {tableHoverControls && editor ? (
          <>
            {(() => {
              const handle = tableHoverControls.tableHandle;
              const isHovered = hoveredTableHandle?.kind === "table";
              const isSelected = selectedTableHandle?.kind === "table";

              return (
                <button
                  type="button"
                  className={`note-editor-table-side-handle note-editor-table-side-handle--table${isHovered ? " is-hovered" : ""}${isSelected ? " is-selected" : ""}`}
                  style={{
                    left: handle.left,
                    top: handle.top,
                    width: handle.width,
                    height: handle.height,
                  }}
                  aria-label="Select table"
                  aria-pressed={isSelected}
                  data-table-hover-controls="true"
                  onMouseEnter={() => setHoveredTableHandle({ kind: "table", index: 0 })}
                  onMouseLeave={() => setHoveredTableHandle((current) => (
                    current?.kind === "table" ? null : current
                  ))}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    void selectTableHandle("table", 0);
                  }}
                >
                  <span className="note-editor-table-side-handle-line" aria-hidden="true" />
                  <span className="note-editor-table-side-handle-pill" aria-hidden="true">
                    <span className="note-editor-table-side-handle-dots" />
                  </span>
                </button>
              );
            })()}
            {tableHoverControls.rowHandles.map((handle) => {
              const isHovered = hoveredTableHandle?.kind === "row" && hoveredTableHandle.index === handle.index;
              const isSelected = selectedTableHandle?.kind === "row" && selectedTableHandle.index === handle.index;

              return (
                <button
                  key={`row-${handle.index}`}
                  type="button"
                  className={`note-editor-table-side-handle note-editor-table-side-handle--row${isHovered ? " is-hovered" : ""}${isSelected ? " is-selected" : ""}`}
                  style={{
                    left: handle.left,
                    top: handle.top,
                    width: handle.width,
                    height: handle.height,
                  }}
                  aria-label={`Select row ${handle.index + 1}`}
                  aria-pressed={isSelected}
                  data-table-hover-controls="true"
                  onMouseEnter={() => setHoveredTableHandle({ kind: "row", index: handle.index })}
                  onMouseLeave={() => setHoveredTableHandle((current) => (
                    current?.kind === "row" && current.index === handle.index ? null : current
                  ))}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    void selectTableHandle("row", handle.index);
                  }}
                >
                  <span className="note-editor-table-side-handle-line" aria-hidden="true" />
                  <span className="note-editor-table-side-handle-pill" aria-hidden="true">
                    <span className="note-editor-table-side-handle-dots" />
                  </span>
                </button>
              );
            })}
            {tableHoverControls.columnHandles.map((handle) => {
              const isHovered = hoveredTableHandle?.kind === "column" && hoveredTableHandle.index === handle.index;
              const isSelected = selectedTableHandle?.kind === "column" && selectedTableHandle.index === handle.index;

              return (
                <button
                  key={`column-${handle.index}`}
                  type="button"
                  className={`note-editor-table-side-handle note-editor-table-side-handle--column${isHovered ? " is-hovered" : ""}${isSelected ? " is-selected" : ""}`}
                  style={{
                    left: handle.left,
                    top: handle.top,
                    width: handle.width,
                    height: handle.height,
                  }}
                  aria-label={`Select column ${handle.index + 1}`}
                  aria-pressed={isSelected}
                  data-table-hover-controls="true"
                  onMouseEnter={() => setHoveredTableHandle({ kind: "column", index: handle.index })}
                  onMouseLeave={() => setHoveredTableHandle((current) => (
                    current?.kind === "column" && current.index === handle.index ? null : current
                  ))}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    void selectTableHandle("column", handle.index);
                  }}
                >
                  <span className="note-editor-table-side-handle-line" aria-hidden="true" />
                  <span className="note-editor-table-side-handle-pill" aria-hidden="true">
                    <span className="note-editor-table-side-handle-dots" />
                  </span>
                </button>
              );
            })}
            <div
              className="note-editor-table-hover-rail note-editor-table-hover-rail--row"
              style={{
                left: tableHoverControls.frameLeft,
                top: tableHoverControls.frameTop + tableHoverControls.frameHeight - 6,
                width: tableHoverControls.frameWidth,
              }}
              data-table-hover-controls="true"
            >
              <button
                type="button"
                className="note-editor-table-hover-add note-editor-table-hover-add--row"
                aria-label="Add row below"
                title="Add row below"
                data-table-hover-controls="true"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runTableHoverAction("addRowAfter")}
              >
                +
              </button>
            </div>
            <div
              className="note-editor-table-hover-rail note-editor-table-hover-rail--column"
              style={{
                left: tableHoverControls.frameLeft + tableHoverControls.frameWidth - 6,
                top: tableHoverControls.frameTop,
                height: tableHoverControls.frameHeight,
              }}
              data-table-hover-controls="true"
            >
              <button
                type="button"
                className="note-editor-table-hover-add note-editor-table-hover-add--column"
                aria-label="Add column to the right"
                title="Add column to the right"
                data-table-hover-controls="true"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runTableHoverAction("addColumnAfter")}
              >
                +
              </button>
            </div>
            {selectedTableHandle && selectedHandleBounds ? (
              <div
                className={`note-header-menu note-editor-table-handle-menu note-editor-table-handle-menu--${selectedTableHandle.kind}`}
                style={
                  selectedTableHandle.kind === "row"
                    ? {
                        left: selectedHandleBounds.left + selectedHandleBounds.width + 10,
                        top: selectedHandleBounds.top + (selectedHandleBounds.height / 2),
                      }
                    : selectedTableHandle.kind === "column"
                    ? {
                        left: selectedHandleBounds.left + (selectedHandleBounds.width / 2),
                        top: selectedHandleBounds.top + selectedHandleBounds.height + 10,
                      }
                    : {
                        left: selectedHandleBounds.left + selectedHandleBounds.width + 10,
                        top: selectedHandleBounds.top + selectedHandleBounds.height + 10,
                      }
                }
                data-table-hover-controls="true"
              >
                {selectedTableHandle.kind !== "table" ? (
                  <>
                    <button
                      type="button"
                      className="note-header-menu-item"
                      data-table-hover-controls="true"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => runTableMenuAction(selectedTableHandle.kind, selectedTableHandle.index, "insertBefore")}
                    >
                      <span className="note-header-menu-item-label">
                        {selectedTableHandle.kind === "row" ? "Insert Above" : "Insert Left"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="note-header-menu-item"
                      data-table-hover-controls="true"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => runTableMenuAction(selectedTableHandle.kind, selectedTableHandle.index, "insertAfter")}
                    >
                      <span className="note-header-menu-item-label">
                        {selectedTableHandle.kind === "row" ? "Insert Below" : "Insert Right"}
                      </span>
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="note-header-menu-item note-header-menu-item--danger"
                  data-table-hover-controls="true"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runTableMenuAction(selectedTableHandle.kind, selectedTableHandle.index, "delete")}
                >
                  <span className="note-header-menu-item-label">{selectedTableHandle.kind === "table" ? "Delete Table" : "Delete"}</span>
                </button>
              </div>
            ) : null}
          </>
        ) : null}
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
      {shareProgressMessage ? (
        <Toast message={shareProgressMessage} dismissible={false} loading />
      ) : null}
      {pdfExportPending ? (
        <Toast message="Exporting PDF..." dismissible={false} loading />
      ) : null}
      {shareMessage ? (
        <Toast message={shareMessage} onClose={() => setShareMessage("")} />
      ) : null}
      {pdfExportNotice ? (
        <Toast
          message={pdfExportNotice.message}
          onClose={() => setPdfExportNotice(null)}
        />
      ) : null}
      {shareConfirmOpen ? (
        <ShareConfirmDialog
          noteName={note.name}
          busy={shareBusy}
          onConfirm={() => {
            void handleShare();
          }}
          onClose={() => setShareConfirmOpen(false)}
        />
      ) : null}
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
