import type { Editor } from "@tiptap/react";

export type TableAxis = "row" | "column";
export type TableHandleKind = TableAxis | "table";

export type TableHandleBounds = {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TableHoverControls = {
  frameLeft: number;
  frameTop: number;
  frameWidth: number;
  frameHeight: number;
  tableHandle: TableHandleBounds;
  rowHandles: TableHandleBounds[];
  columnHandles: TableHandleBounds[];
};

export type TableHoverAction = "addColumnAfter" | "addRowAfter";
export type TableMenuAction = "insertBefore" | "insertAfter" | "copy" | "delete";

export type TableHandleTarget = {
  kind: TableHandleKind;
  index: number;
};

export type SelectedTableHandle = TableHandleTarget & {
  anchorPos: number;
};

const TABLE_ROW_HANDLE_WIDTH = 20;
const TABLE_ROW_HANDLE_HEIGHT = 42;
const TABLE_COLUMN_HANDLE_WIDTH = 38;
const TABLE_COLUMN_HANDLE_HEIGHT = 18;
const TABLE_CORNER_HANDLE_SIZE = 20;

export function hasHeaderRow(table: HTMLTableElement): boolean {
  const firstRow = table.rows.item(0);
  if (!firstRow) return false;

  return Array.from(firstRow.cells).some((cell) => cell.tagName === "TH");
}

export function getHoverTable(target: EventTarget | null): HTMLTableElement | null {
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

export function buildTableHoverControls(
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
  const rowHandles = Array.from(table.rows)
    .map((row, index) => {
      const rowRect = row.getBoundingClientRect();
      return {
        index,
        left: tableLeft - (TABLE_ROW_HANDLE_WIDTH / 2),
        top: rowRect.top - containerRect.top + scrollTop + (rowRect.height / 2) - (TABLE_ROW_HANDLE_HEIGHT / 2),
        width: TABLE_ROW_HANDLE_WIDTH,
        height: TABLE_ROW_HANDLE_HEIGHT,
      };
    })
    .filter((handle) => !(hasHeaderRow(table) && handle.index === 0));
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

export function getStructureCells(
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

export function getHandleAnchorPosition(
  editor: Editor,
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

  if (kind === "row" && hasHeaderRow(table) && index === 0) {
    return null;
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

export function getHandleBounds(
  controls: TableHoverControls,
  handle: TableHandleTarget,
): TableHandleBounds | null {
  if (handle.kind === "table") {
    return controls.tableHandle;
  }
  const candidates = handle.kind === "row" ? controls.rowHandles : controls.columnHandles;
  return candidates.find((candidate) => candidate.index === handle.index) ?? null;
}
