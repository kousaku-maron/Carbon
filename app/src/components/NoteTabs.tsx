import { useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import type { OpenNoteTab } from "../lib/types";

type DropTarget = {
  tabKey: number;
  placement: "before" | "after";
};

type NoteTabsProps = {
  tabs: OpenNoteTab[];
  activeTabKey: number | null;
  sidebarOpen: boolean;
  onActivate: (tabKey: number) => void;
  onClose: (tabKey: number) => void;
  onReorder: (
    sourceTabKey: number,
    targetTabKey: number,
    placement: "before" | "after",
  ) => void;
};

const TAB_DRAG_TYPE = "application/x-carbon-note-tab";

export function NoteTabs({
  tabs,
  activeTabKey,
  sidebarOpen,
  onActivate,
  onClose,
  onReorder,
}: NoteTabsProps) {
  const [draggingTabKey, setDraggingTabKey] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabKey, sidebarOpen, tabs.length]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, tabKey: number) => {
    setDraggingTabKey(tabKey);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TAB_DRAG_TYPE, String(tabKey));
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, targetTabKey: number) => {
    const sourceTabKey = draggingTabKey ?? Number(event.dataTransfer.getData(TAB_DRAG_TYPE));
    if (!Number.isFinite(sourceTabKey) || sourceTabKey === targetTabKey) {
      setDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    setDropTarget({ tabKey: targetTabKey, placement });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetTabKey: number) => {
    event.preventDefault();
    const rawSource = event.dataTransfer.getData(TAB_DRAG_TYPE);
    const sourceTabKey = draggingTabKey ?? Number(rawSource);
    const placement = dropTarget?.tabKey === targetTabKey
      ? dropTarget.placement
      : "before";
    if (Number.isFinite(sourceTabKey) && sourceTabKey !== targetTabKey) {
      onReorder(sourceTabKey, targetTabKey, placement);
    }
    setDraggingTabKey(null);
    setDropTarget(null);
  };

  const resetDrag = () => {
    setDraggingTabKey(null);
    setDropTarget(null);
  };

  return (
    <div
      className={`note-tabs${sidebarOpen ? "" : " note-tabs--sidebar-closed"}`}
      role="tablist"
      aria-label="Open notes"
    >
      {tabs.map((tab) => {
        const active = tab.tabKey === activeTabKey;
        const targetClass = dropTarget?.tabKey === tab.tabKey
          ? ` is-drop-${dropTarget.placement}`
          : "";
        return (
          <div
            key={tab.tabKey}
            ref={active ? activeTabRef : undefined}
            className={`note-tab${active ? " is-active" : ""}${
              tab.status === "missing" ? " is-missing" : ""
            }${draggingTabKey === tab.tabKey ? " is-dragging" : ""}${targetClass}`}
            draggable
            onDragStart={(event) => handleDragStart(event, tab.tabKey)}
            onDragOver={(event) => handleDragOver(event, tab.tabKey)}
            onDrop={(event) => handleDrop(event, tab.tabKey)}
            onDragEnd={resetDrag}
          >
            <button
              type="button"
              className="note-tab-main"
              role="tab"
              aria-selected={active}
              title={tab.status === "missing"
                ? `${tab.path}\nFile moved or deleted`
                : tab.path}
              onClick={() => onActivate(tab.tabKey)}
            >
              {tab.status === "missing" ? (
                <span className="note-tab-missing-mark" aria-hidden="true">!</span>
              ) : null}
              <span className="note-tab-label">{tab.name}</span>
            </button>
            <button
              type="button"
              className="note-tab-close"
              aria-label={`Close ${tab.name}`}
              title="Close"
              onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.tabKey);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
