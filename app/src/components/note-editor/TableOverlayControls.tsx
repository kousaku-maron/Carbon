import type {
  SelectedTableHandle,
  TableHandleBounds,
  TableHandleKind,
  TableHandleTarget,
  TableHoverAction,
  TableHoverControls,
  TableMenuAction,
} from "./table-controls";
import { CopyMarkdownIcon } from "../CopyMarkdownIcon";

type TableOverlayControlsProps = {
  controls: TableHoverControls;
  hoveredHandle: TableHandleTarget | null;
  selectedHandle: SelectedTableHandle | null;
  selectedHandleBounds: TableHandleBounds | null;
  onHandleMouseEnter: (kind: TableHandleKind, index: number) => void;
  onHandleMouseLeave: (kind: TableHandleKind, index: number) => void;
  onHandleClick: (kind: TableHandleKind, index: number) => void;
  onHoverAction: (action: TableHoverAction) => void;
  onMenuAction: (kind: TableHandleKind, index: number, action: TableMenuAction) => void;
};

function DirectionIcon(props: { direction: "up" | "down" | "left" | "right" }) {
  const { direction } = props;

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === "up" ? (
        <path d="M12 19V5M6 11l6-6 6 6" />
      ) : null}
      {direction === "down" ? (
        <path d="M12 5v14M6 13l6 6 6-6" />
      ) : null}
      {direction === "left" ? (
        <path d="M19 12H5M11 6l-6 6 6 6" />
      ) : null}
      {direction === "right" ? (
        <path d="M5 12h14M13 6l6 6-6 6" />
      ) : null}
    </svg>
  );
}

export function TableOverlayControls(props: TableOverlayControlsProps) {
  const {
    controls,
    hoveredHandle,
    selectedHandle,
    selectedHandleBounds,
    onHandleMouseEnter,
    onHandleMouseLeave,
    onHandleClick,
    onHoverAction,
    onMenuAction,
  } = props;

  return (
    <>
      {(() => {
        const handle = controls.tableHandle;
        const isHovered = hoveredHandle?.kind === "table";
        const isSelected = selectedHandle?.kind === "table";

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
            onMouseEnter={() => onHandleMouseEnter("table", 0)}
            onMouseLeave={() => onHandleMouseLeave("table", 0)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onHandleClick("table", 0)}
          >
            <span className="note-editor-table-side-handle-line" aria-hidden="true" />
            <span className="note-editor-table-side-handle-pill" aria-hidden="true">
              <span className="note-editor-table-side-handle-dots" />
            </span>
          </button>
        );
      })()}
      {controls.rowHandles.map((handle) => {
        const isHovered = hoveredHandle?.kind === "row" && hoveredHandle.index === handle.index;
        const isSelected = selectedHandle?.kind === "row" && selectedHandle.index === handle.index;

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
            onMouseEnter={() => onHandleMouseEnter("row", handle.index)}
            onMouseLeave={() => onHandleMouseLeave("row", handle.index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onHandleClick("row", handle.index)}
          >
            <span className="note-editor-table-side-handle-line" aria-hidden="true" />
            <span className="note-editor-table-side-handle-pill" aria-hidden="true">
              <span className="note-editor-table-side-handle-dots" />
            </span>
          </button>
        );
      })}
      {controls.columnHandles.map((handle) => {
        const isHovered = hoveredHandle?.kind === "column" && hoveredHandle.index === handle.index;
        const isSelected = selectedHandle?.kind === "column" && selectedHandle.index === handle.index;

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
            onMouseEnter={() => onHandleMouseEnter("column", handle.index)}
            onMouseLeave={() => onHandleMouseLeave("column", handle.index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onHandleClick("column", handle.index)}
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
          left: controls.frameLeft,
          top: controls.frameTop + controls.frameHeight - 6,
          width: controls.frameWidth,
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
          onClick={() => onHoverAction("addRowAfter")}
        >
          +
        </button>
      </div>
      <div
        className="note-editor-table-hover-rail note-editor-table-hover-rail--column"
        style={{
          left: controls.frameLeft + controls.frameWidth - 6,
          top: controls.frameTop,
          height: controls.frameHeight,
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
          onClick={() => onHoverAction("addColumnAfter")}
        >
          +
        </button>
      </div>
      {selectedHandle && selectedHandleBounds ? (
        <div
          className={`note-header-menu note-editor-table-handle-menu note-editor-table-handle-menu--${selectedHandle.kind}`}
          style={
            selectedHandle.kind === "row"
              ? {
                  left: selectedHandleBounds.left + selectedHandleBounds.width + 10,
                  top: selectedHandleBounds.top + (selectedHandleBounds.height / 2),
                }
              : selectedHandle.kind === "column"
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
          {selectedHandle.kind !== "table" ? (
            <>
              <button
                type="button"
                className="note-header-menu-item"
                data-table-hover-controls="true"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onMenuAction(selectedHandle.kind, selectedHandle.index, "insertBefore")}
              >
                <span className="note-editor-table-menu-item-icon" aria-hidden="true">
                  <DirectionIcon direction={selectedHandle.kind === "row" ? "up" : "left"} />
                </span>
                <span className="note-header-menu-item-label">
                  {selectedHandle.kind === "row" ? "Insert above" : "Insert left"}
                </span>
              </button>
              <button
                type="button"
                className="note-header-menu-item"
                data-table-hover-controls="true"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onMenuAction(selectedHandle.kind, selectedHandle.index, "insertAfter")}
              >
                <span className="note-editor-table-menu-item-icon" aria-hidden="true">
                  <DirectionIcon direction={selectedHandle.kind === "row" ? "down" : "right"} />
                </span>
                <span className="note-header-menu-item-label">
                  {selectedHandle.kind === "row" ? "Insert below" : "Insert right"}
                </span>
              </button>
            </>
          ) : null}
          {selectedHandle.kind === "table" ? (
            <button
              type="button"
              className="note-header-menu-item"
              data-table-hover-controls="true"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onMenuAction(selectedHandle.kind, selectedHandle.index, "copy")}
            >
              <span className="note-editor-table-menu-item-icon" aria-hidden="true">
                <CopyMarkdownIcon />
              </span>
              <span className="note-header-menu-item-label">Copy</span>
            </button>
          ) : null}
          <button
            type="button"
            className="note-header-menu-item note-header-menu-item--danger"
            data-table-hover-controls="true"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onMenuAction(selectedHandle.kind, selectedHandle.index, "delete")}
          >
            <span className="note-header-menu-item-label">
              {selectedHandle.kind === "table"
                ? "Delete table"
                : selectedHandle.kind === "row"
                  ? "Delete row"
                  : "Delete column"}
            </span>
          </button>
        </div>
      ) : null}
    </>
  );
}
