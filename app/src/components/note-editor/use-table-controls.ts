import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { formatMarkdownForCopy, serializeMarkdownContent } from "../../lib/tiptap/markdown";
import {
  buildTableHoverControls,
  getHandleAnchorPosition,
  getHandleBounds,
  getHoverTable,
  getStructureCells,
  hasHeaderRow,
  type SelectedTableHandle,
  type TableHandleKind,
  type TableHandleTarget,
  type TableHoverAction,
  type TableHoverControls,
  type TableMenuAction,
} from "./table-controls";

type UseTableControlsOptions = {
  editor: Editor | null;
  editorContentRef: RefObject<HTMLDivElement | null>;
};

export function useTableControls(options: UseTableControlsOptions) {
  const { editor, editorContentRef } = options;
  const [tableHoverControls, setTableHoverControls] = useState<TableHoverControls | null>(null);
  const [hoveredTableHandle, setHoveredTableHandle] = useState<TableHandleTarget | null>(null);
  const [selectedTableHandle, setSelectedTableHandle] = useState<SelectedTableHandle | null>(null);
  const hoveredTableRef = useRef<HTMLTableElement | null>(null);
  const selectedTableRef = useRef<HTMLTableElement | null>(null);

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

  const selectTableHandle = useCallback((kind: TableHandleKind, index: number) => {
    if (!editor) return false;

    const table = hoveredTableRef.current ?? selectedTableRef.current;
    if (!table) return false;
    if (kind === "row" && hasHeaderRow(table) && index === 0) return false;

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

    const selectionTarget = lastCell.querySelector("p, th, td, div") ?? lastCell;

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
    if (kind === "row" && hasHeaderRow(table) && index === 0) return;

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

    if (kind === "table" && action === "copy") {
      const $anchor = editor.state.doc.resolve(anchorPos);
      const tableDepth = Array.from({ length: $anchor.depth + 1 }, (_, depth) => depth)
        .reverse()
        .find((depth) => $anchor.node(depth).type.name === "table");

      if (tableDepth === undefined) return;

      const markdown = serializeMarkdownContent($anchor.node(tableDepth).toJSON());
      const formatted = formatMarkdownForCopy(markdown);
      void navigator.clipboard.writeText(formatted).then(() => {
        clearSelectedTableHandle();
      });
      return;
    }

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

  const handleTableHandleMouseEnter = useCallback((kind: TableHandleKind, index: number) => {
    setHoveredTableHandle({ kind, index });
  }, []);

  const handleTableHandleMouseLeave = useCallback((kind: TableHandleKind, index: number) => {
    setHoveredTableHandle((current) => (
      current?.kind === kind && current.index === index ? null : current
    ));
  }, []);

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
      className: string,
    ) => {
      if (!table || !handle) return;
      if (handle.kind === "table") return;
      if (handle.kind === "row" && hasHeaderRow(table) && handle.index === 0) return;
      getStructureCells(table, handle.kind, handle.index).forEach((cell) => {
        cell.classList.add(className);
      });
    };

    applyClasses(
      hoveredTableRef.current,
      hoveredTableHandle,
      hoveredTableHandle?.kind === "row" ? "note-editor-table-cell--hover-row" : "note-editor-table-cell--hover-column",
    );
    applyClasses(
      selectedTableRef.current,
      selectedTableHandle,
      selectedTableHandle?.kind === "row" ? "note-editor-table-cell--selected-row" : "note-editor-table-cell--selected-column",
    );

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

  return {
    tableHoverControls,
    hoveredTableHandle,
    selectedTableHandle,
    selectedHandleBounds,
    clearSelectedTableHandle,
    handleEditorContentMouseMove,
    handleEditorContentMouseLeave,
    handleTableHandleMouseEnter,
    handleTableHandleMouseLeave,
    runTableHoverAction,
    runTableMenuAction,
    selectTableHandle,
  };
}
