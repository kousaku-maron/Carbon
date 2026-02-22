import { useEffect, useRef, useState } from "react";
import { getParentPath, isPathInside, pathsEqual } from "../lib/pathUtils";
import type { TreeNode } from "../lib/types";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

/** Pending inline-input operation. */
type PendingAction =
  | { type: "newFile"; parentPath: string }
  | { type: "newFolder"; parentPath: string }
  | { type: "rename"; node: TreeNode };

interface FileTreeCallbacks {
  onSelect: (node: TreeNode) => void;
  onCreateFile: (parentDir: string, name: string) => void;
  onCreateFolder: (parentDir: string, name: string) => void;
  onRename: (oldPath: string, newName: string) => void;
  onDelete: (node: TreeNode) => void;
  onMove: (sourcePath: string, targetFolderPath: string) => void;
}

/** Shared drag state (ref-based to avoid re-renders). */
interface DragState {
  sourcePath: string | null;
}

export function FileTree(props: FileTreeCallbacks & {
  nodes: TreeNode[];
  activeNoteId: string | null;
  vaultPath: string;
}) {
  const { nodes, activeNoteId, vaultPath, ...callbacks } = props;

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const dragRef = useRef<DragState>({ sourcePath: null });

  function openNewMenu(e: React.MouseEvent, parentPath: string) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "New File",
          onClick: () =>
            setPendingAction({ type: "newFile", parentPath }),
        },
        {
          label: "New Folder",
          onClick: () =>
            setPendingAction({ type: "newFolder", parentPath }),
        },
      ],
    });
  }

  function openFolderMenu(e: React.MouseEvent, node: TreeNode) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "New File",
          onClick: () =>
            setPendingAction({ type: "newFile", parentPath: node.path }),
        },
        {
          label: "New Folder",
          onClick: () =>
            setPendingAction({ type: "newFolder", parentPath: node.path }),
        },
        {
          label: "Rename",
          onClick: () => setPendingAction({ type: "rename", node }),
        },
        {
          label: "Delete",
          onClick: () => callbacks.onDelete(node),
        },
      ],
    });
  }

  function openFileMenu(e: React.MouseEvent, node: TreeNode) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Rename",
          onClick: () => setPendingAction({ type: "rename", node }),
        },
        {
          label: "Delete",
          onClick: () => callbacks.onDelete(node),
        },
      ],
    });
  }

  // Right-click empty area → create at vault root
  function handleContainerContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openNewMenu(e, vaultPath);
  }

  // Drop on root area → move to vault root
  function handleRootDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleRootDrop(e: React.DragEvent) {
    e.preventDefault();
    const sourcePath = dragRef.current.sourcePath;
    if (!sourcePath) return;
    // Don't move if already at root
    const sourceParent = getParentPath(sourcePath);
    if (pathsEqual(sourceParent, vaultPath)) return;
    callbacks.onMove(sourcePath, vaultPath);
    dragRef.current.sourcePath = null;
  }

  const showRootInlineInput =
    pendingAction &&
    (pendingAction.type === "newFile" || pendingAction.type === "newFolder") &&
    pendingAction.parentPath === vaultPath;

  return (
    <>
      <ul
        className="file-tree"
        onContextMenu={handleContainerContextMenu}
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        {nodes.map((node) => (
          <FileTreeItem
            key={node.id}
            node={node}
            activeNoteId={activeNoteId}
            vaultPath={vaultPath}
            depth={0}
            pendingAction={pendingAction}
            setPendingAction={setPendingAction}
            onContextMenuFolder={openFolderMenu}
            onContextMenuFile={openFileMenu}
            dragRef={dragRef}
            {...callbacks}
          />
        ))}

        {showRootInlineInput && (
          <li className="file-tree-file">
            <InlineInput
              icon={pendingAction.type === "newFolder" ? "folder" : "file"}
              defaultValue=""
              onConfirm={(name) => {
                if (pendingAction.type === "newFile") {
                  callbacks.onCreateFile(pendingAction.parentPath, name);
                } else {
                  callbacks.onCreateFolder(pendingAction.parentPath, name);
                }
                setPendingAction(null);
              }}
              onCancel={() => setPendingAction(null)}
            />
          </li>
        )}
      </ul>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

/** Inner recursive tree list (no context menu state). */
function InnerTree(props: FileTreeCallbacks & {
  nodes: TreeNode[];
  activeNoteId: string | null;
  vaultPath: string;
  depth: number;
  pendingAction: PendingAction | null;
  setPendingAction: (a: PendingAction | null) => void;
  onContextMenuFolder: (e: React.MouseEvent, node: TreeNode) => void;
  onContextMenuFile: (e: React.MouseEvent, node: TreeNode) => void;
  dragRef: React.MutableRefObject<DragState>;
  /** If set, render an inline input at the end of this list. */
  inlineCreate?: { type: "newFile" | "newFolder"; parentPath: string };
}) {
  const {
    nodes,
    activeNoteId,
    vaultPath,
    depth,
    pendingAction,
    setPendingAction,
    onContextMenuFolder,
    onContextMenuFile,
    dragRef,
    inlineCreate,
    ...callbacks
  } = props;

  return (
    <ul className="file-tree" style={{ paddingLeft: "0.75rem" }}>
      {nodes.map((node) => (
        <FileTreeItem
          key={node.id}
          node={node}
          activeNoteId={activeNoteId}
          vaultPath={vaultPath}
          depth={depth}
          pendingAction={pendingAction}
          setPendingAction={setPendingAction}
          onContextMenuFolder={onContextMenuFolder}
          onContextMenuFile={onContextMenuFile}
          dragRef={dragRef}
          {...callbacks}
        />
      ))}

      {inlineCreate && (
        <li className="file-tree-file">
          <InlineInput
            icon={inlineCreate.type === "newFolder" ? "folder" : "file"}
            defaultValue=""
            onConfirm={(name) => {
              if (inlineCreate.type === "newFile") {
                callbacks.onCreateFile(inlineCreate.parentPath, name);
              } else {
                callbacks.onCreateFolder(inlineCreate.parentPath, name);
              }
              setPendingAction(null);
            }}
            onCancel={() => setPendingAction(null)}
          />
        </li>
      )}
    </ul>
  );
}

function FileTreeItem(props: FileTreeCallbacks & {
  node: TreeNode;
  activeNoteId: string | null;
  vaultPath: string;
  depth: number;
  pendingAction: PendingAction | null;
  setPendingAction: (a: PendingAction | null) => void;
  onContextMenuFolder: (e: React.MouseEvent, node: TreeNode) => void;
  onContextMenuFile: (e: React.MouseEvent, node: TreeNode) => void;
  dragRef: React.MutableRefObject<DragState>;
}) {
  const {
    node,
    activeNoteId,
    vaultPath,
    depth,
    pendingAction,
    setPendingAction,
    onContextMenuFolder,
    onContextMenuFile,
    dragRef,
    ...callbacks
  } = props;
  const [expanded, setExpanded] = useState(depth === 0);
  const [dragOver, setDragOver] = useState(false);

  const isRenaming =
    pendingAction?.type === "rename" &&
    pendingAction.node.path === node.path;

  // Should inline input for new items appear inside this folder's children?
  const inlineCreate =
    pendingAction &&
    (pendingAction.type === "newFile" || pendingAction.type === "newFolder") &&
    node.kind === "folder" &&
    pendingAction.parentPath === node.path
      ? pendingAction
      : undefined;

  // Auto-expand folder when creating inside it
  useEffect(() => {
    if (inlineCreate && !expanded) {
      setExpanded(true);
    }
  }, [inlineCreate, expanded]);

  // -- Drag handlers (on <li> elements) --
  function handleDragStart(e: React.DragEvent) {
    e.stopPropagation();
    dragRef.current.sourcePath = node.path;
    // WebKit requires setData for drag to initiate
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.effectAllowed = "move";
    const li = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => {
      li.classList.add("file-tree-item--dragging");
    });
  }

  function handleDragEnd(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("file-tree-item--dragging");
    dragRef.current.sourcePath = null;
    setDragOver(false);
  }

  function handleDragOver(e: React.DragEvent) {
    if (node.kind !== "folder") return;
    const sourcePath = dragRef.current.sourcePath;
    if (!sourcePath) return;
    // Prevent dropping onto itself or into a descendant
    if (pathsEqual(sourcePath, node.path) || isPathInside(node.path, sourcePath)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const sourcePath = dragRef.current.sourcePath;
    if (!sourcePath || node.kind !== "folder") return;
    // Prevent dropping onto itself or into a descendant
    if (pathsEqual(sourcePath, node.path) || isPathInside(node.path, sourcePath)) return;
    // Skip if already in this folder
    const sourceParent = getParentPath(sourcePath);
    if (pathsEqual(sourceParent, node.path)) return;
    callbacks.onMove(sourcePath, node.path);
    dragRef.current.sourcePath = null;
  }

  if (node.kind === "folder") {
    const folderClasses = `file-tree-item${dragOver ? " file-tree-item--drag-over" : ""}`;

    return (
      <li
        className="file-tree-folder"
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isRenaming ? (
          <InlineInput
            icon="folder"
            defaultValue={node.name}
            onConfirm={(newName) => {
              callbacks.onRename(node.path, newName);
              setPendingAction(null);
            }}
            onCancel={() => setPendingAction(null)}
          />
        ) : (
          <button
            className={folderClasses}
            onClick={() => setExpanded(!expanded)}
            onContextMenu={(e) => onContextMenuFolder(e, node)}
          >
            <span
              className={`file-tree-chevron ${expanded ? "expanded" : ""}`}
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="currentColor"
              >
                <path d="M2 1l4 3-4 3V1z" />
              </svg>
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span className="file-tree-name">{node.name}</span>
          </button>
        )}
        {(expanded || inlineCreate) && (
          <InnerTree
            nodes={node.children ?? []}
            activeNoteId={activeNoteId}
            vaultPath={vaultPath}
            depth={depth + 1}
            pendingAction={pendingAction}
            setPendingAction={setPendingAction}
            onContextMenuFolder={onContextMenuFolder}
            onContextMenuFile={onContextMenuFile}
            dragRef={dragRef}
            inlineCreate={inlineCreate}
            {...callbacks}
          />
        )}
      </li>
    );
  }

  return (
    <li
      className="file-tree-file"
      draggable={!isRenaming}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {isRenaming ? (
        <InlineInput
          icon="file"
          defaultValue={node.name}
          onConfirm={(newName) => {
            callbacks.onRename(node.path, newName);
            setPendingAction(null);
          }}
          onCancel={() => setPendingAction(null)}
        />
      ) : (
        <button
          className={`file-tree-item ${activeNoteId === node.id ? "active" : ""}`}
          onClick={() => callbacks.onSelect(node)}
          onContextMenu={(e) => onContextMenuFile(e, node)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="file-tree-name">{node.name}</span>
        </button>
      )}
    </li>
  );
}

function InlineInput(props: {
  icon: "file" | "folder";
  defaultValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const { icon, defaultValue, onConfirm, onCancel } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = inputRef.current?.value.trim();
      if (value) onConfirm(value);
      else onCancel();
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div className="file-tree-item file-tree-inline-input-wrapper">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon === "folder" ? (
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        ) : (
          <>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </>
        )}
      </svg>
      <input
        ref={inputRef}
        className="file-tree-inline-input"
        type="text"
        defaultValue={defaultValue}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
      />
    </div>
  );
}
