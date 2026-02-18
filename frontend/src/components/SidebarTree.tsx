import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

type SidebarNoteItem = {
  id: string;
  title: string;
};

type SidebarFolderNode = {
  id: string;
  name: string;
  children: SidebarFolderNode[];
  notes: SidebarNoteItem[];
};

type Props = {
  folders: SidebarFolderNode[];
  rootNotes: SidebarNoteItem[];
  currentPath: string;
};

type FolderBranchProps = {
  folder: SidebarFolderNode;
  depth: number;
  activePath: string;
  creatingParentId: string | null;
  creatingNoteParentId: string | null;
  expandedFolderIds: Set<string>;
  onCreateFolder: (parentId: string | null) => void;
  onCreateNote: (parentId: string | null) => void;
  onOpenContextMenu: (event: MouseEvent, target: ContextMenuTarget) => void;
  onToggleFolder: (folderId: string) => void;
  newFolderParentId: string | null | undefined;
  newNoteParentId: string | null | undefined;
  renderNewFolderInput: (depth: number) => JSX.Element;
  renderNewNoteInput: (depth: number) => JSX.Element;
};

type ContextMenuTarget =
  | { kind: 'blank' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'note'; noteId: string };

type SidebarContextMenuState = {
  x: number;
  y: number;
  target: ContextMenuTarget;
};

const EXPANDED_FOLDERS_STORAGE_KEY = 'vessel.sidebar.expandedFolderIds';

function FolderBranch({
  folder,
  depth,
  activePath,
  creatingParentId,
  creatingNoteParentId,
  expandedFolderIds,
  onCreateFolder,
  onCreateNote,
  onOpenContextMenu,
  onToggleFolder,
  newFolderParentId,
  newNoteParentId,
  renderNewFolderInput,
  renderNewNoteInput,
}: FolderBranchProps) {
  const expanded = expandedFolderIds.has(folder.id);
  const showNewFolderInput = newFolderParentId === folder.id;
  const showNewNoteInput = newNoteParentId === folder.id;
  const hasChildren = folder.notes.length > 0 || folder.children.length > 0 || showNewFolderInput || showNewNoteInput;

  return (
    <li className="sidebar-tree-item">
      <div
        className="sidebar-tree-row folder"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onContextMenu={(event) => onOpenContextMenu(event, { kind: 'folder', folderId: folder.id })}
      >
        <button
          type="button"
          className="sidebar-folder-link"
          aria-expanded={expanded}
          onClick={() => onToggleFolder(folder.id)}
        >
          <span className="sidebar-tree-label">
            <span className={`sidebar-folder-glyph ${expanded ? 'expanded' : ''}`} aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 5L13 10L7 15" />
              </svg>
            </span>
            <span>{folder.name}</span>
          </span>
        </button>
        <span className="sidebar-tree-actions">
          <button
            type="button"
            className="sidebar-mini-action"
            title="New note in folder"
            aria-label="New note in folder"
            disabled={creatingNoteParentId !== null}
            onClick={() => onCreateNote(folder.id)}
          >
            +N
          </button>
          <button
            type="button"
            className="sidebar-mini-action"
            title="New subfolder"
            aria-label="New subfolder"
            disabled={creatingParentId !== null}
            onClick={() => onCreateFolder(folder.id)}
          >
            +F
          </button>
        </span>
      </div>

      {expanded && hasChildren && (
        <ul className="sidebar-tree-list">
          {folder.notes.map((note) => {
            const href = `/notes/${note.id}`;
            const active = activePath === href;
            return (
              <li className="sidebar-tree-item" key={note.id}>
                <a
                  className={`sidebar-tree-row note ${active ? 'active' : ''}`}
                  style={{ paddingLeft: `${depth * 14 + 30}px` }}
                  href={href}
                  onContextMenu={(event) => onOpenContextMenu(event, { kind: 'note', noteId: note.id })}
                >
                  <span className="sidebar-tree-label">{note.title || 'Untitled'}</span>
                </a>
              </li>
            );
          })}
          {folder.children.map((child) => (
            <FolderBranch
              key={child.id}
              folder={child}
              depth={depth + 1}
              activePath={activePath}
              creatingParentId={creatingParentId}
              creatingNoteParentId={creatingNoteParentId}
              expandedFolderIds={expandedFolderIds}
              onCreateFolder={onCreateFolder}
              onCreateNote={onCreateNote}
              onOpenContextMenu={onOpenContextMenu}
              onToggleFolder={onToggleFolder}
              newFolderParentId={newFolderParentId}
              newNoteParentId={newNoteParentId}
              renderNewFolderInput={renderNewFolderInput}
              renderNewNoteInput={renderNewNoteInput}
            />
          ))}
          {showNewFolderInput && renderNewFolderInput(depth + 1)}
          {showNewNoteInput && renderNewNoteInput(depth + 1)}
        </ul>
      )}
    </li>
  );
}

export function SidebarTree({ folders, rootNotes, currentPath }: Props) {
  const [treeFolders, setTreeFolders] = useState<SidebarFolderNode[]>(folders);
  const [treeRootNotes, setTreeRootNotes] = useState<SidebarNoteItem[]>(rootNotes);
  const [creatingParentId, setCreatingParentId] = useState<string | null>(null);
  const [creatingNoteParentId, setCreatingNoteParentId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activePath, setActivePath] = useState(currentPath);
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set<string>());

  const hasContent = useMemo(() => treeFolders.length > 0 || treeRootNotes.length > 0, [treeFolders.length, treeRootNotes.length]);

  useEffect(() => {
    const syncFromLocation = () => {
      const url = new URL(window.location.href);
      setActivePath(url.pathname);
    };

    syncFromLocation();
    document.addEventListener('astro:page-load', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      document.removeEventListener('astro:page-load', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => setContextMenu(null);
    const closeOnPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) return;
      close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('mousedown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  const persistExpandedFolderIds = (ids: Set<string>) => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(EXPANDED_FOLDERS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  };

  const sortNodes = (nodes: SidebarFolderNode[]): SidebarFolderNode[] =>
    [...nodes]
      .map((node) => ({
        ...node,
        children: sortNodes(node.children),
        notes: [...node.notes].sort((a, b) => a.title.localeCompare(b.title, 'ja')),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const sortNoteItems = (items: SidebarNoteItem[]): SidebarNoteItem[] => [...items].sort((a, b) => a.title.localeCompare(b.title, 'ja'));

  const addFolderToTree = (
    nodes: SidebarFolderNode[],
    folder: { id: string; name: string; parent_id: string | null }
  ): SidebarFolderNode[] => {
    if (!folder.parent_id) {
      return sortNodes([...nodes, { id: folder.id, name: folder.name, children: [], notes: [] }]);
    }

    const append = (items: SidebarFolderNode[]): SidebarFolderNode[] =>
      items.map((item) => {
        if (item.id === folder.parent_id) {
          return {
            ...item,
            children: sortNodes([...item.children, { id: folder.id, name: folder.name, children: [], notes: [] }]),
          };
        }
        return {
          ...item,
          children: append(item.children),
        };
      });

    return append(nodes);
  };

  const addNoteToTree = (nodes: SidebarFolderNode[], note: SidebarNoteItem, parentId: string | null): SidebarFolderNode[] => {
    if (!parentId) {
      return nodes;
    }

    const append = (items: SidebarFolderNode[]): SidebarFolderNode[] =>
      items.map((item) => {
        if (item.id === parentId) {
          return {
            ...item,
            notes: sortNoteItems([...item.notes, note]),
          };
        }
        return {
          ...item,
          children: append(item.children),
        };
      });

    return append(nodes);
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const nextExpanded = new Set(prev);
      if (nextExpanded.has(folderId)) {
        nextExpanded.delete(folderId);
      } else {
        nextExpanded.add(folderId);
      }
      persistExpandedFolderIds(nextExpanded);
      return nextExpanded;
    });
  };

  const [newFolderParentId, setNewFolderParentId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const [newNoteParentId, setNewNoteParentId] = useState<string | null | undefined>(undefined);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const newNoteInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingFolderRef = useRef(false);
  const isSubmittingNoteRef = useRef(false);
  const skipNextFolderBlurSubmitRef = useRef(false);
  const skipNextNoteBlurSubmitRef = useRef(false);
  const folderCreateSessionRef = useRef(0);
  const folderSubmittedSessionRef = useRef<number | null>(null);
  const noteCreateSessionRef = useRef(0);
  const noteSubmittedSessionRef = useRef<number | null>(null);

  useEffect(() => {
    if (newFolderParentId !== undefined) {
      newFolderInputRef.current?.focus();
    }
  }, [newFolderParentId]);

  useEffect(() => {
    if (newNoteParentId !== undefined) {
      newNoteInputRef.current?.focus();
    }
  }, [newNoteParentId]);

  const startCreateFolder = (parentId: string | null) => {
    setContextMenu(null);
    skipNextFolderBlurSubmitRef.current = false;
    skipNextNoteBlurSubmitRef.current = false;
    folderCreateSessionRef.current += 1;
    folderSubmittedSessionRef.current = null;
    setNewNoteParentId(undefined);
    setNewNoteTitle('');
    setNewFolderParentId(parentId);
    setNewFolderName('');
    if (parentId) {
      setExpandedFolderIds((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        persistExpandedFolderIds(next);
        return next;
      });
    }
  };

  const cancelCreateFolder = () => {
    skipNextFolderBlurSubmitRef.current = false;
    setNewFolderParentId(undefined);
    setNewFolderName('');
  };

  const startCreateNote = (parentId: string | null) => {
    setContextMenu(null);
    skipNextFolderBlurSubmitRef.current = false;
    skipNextNoteBlurSubmitRef.current = false;
    noteCreateSessionRef.current += 1;
    noteSubmittedSessionRef.current = null;
    setNewFolderParentId(undefined);
    setNewFolderName('');
    setNewNoteParentId(parentId);
    setNewNoteTitle('');
    if (parentId) {
      setExpandedFolderIds((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        persistExpandedFolderIds(next);
        return next;
      });
    }
  };

  const cancelCreateNote = () => {
    skipNextNoteBlurSubmitRef.current = false;
    setNewNoteParentId(undefined);
    setNewNoteTitle('');
  };

  const openContextMenu = (event: MouseEvent, targetMenu: ContextMenuTarget) => {
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      target: targetMenu,
    });
  };

  const contextFolderId = contextMenu?.target.kind === 'folder' ? contextMenu.target.folderId : null;

  const handleContextCreateFolder = () => {
    startCreateFolder(contextFolderId);
  };

  const handleContextCreateNote = () => {
    startCreateNote(contextFolderId);
  };

  const handleContextDelete = async () => {
    const targetMenu = contextMenu?.target;
    if (!targetMenu || targetMenu.kind === 'blank') return;

    const confirmMessage =
      targetMenu.kind === 'note'
        ? 'このノートを削除しますか？'
        : 'このフォルダを削除しますか？\n配下のフォルダも削除されます。';
    if (!window.confirm(confirmMessage)) return;

    setContextMenu(null);
    try {
      setIsDeleting(true);
      const endpoint =
        targetMenu.kind === 'note'
          ? `/api/notes/${encodeURIComponent(targetMenu.noteId)}`
          : `/api/folders/${encodeURIComponent(targetMenu.folderId)}`;
      const res = await fetch(endpoint, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to delete');
      }

      if (targetMenu.kind === 'note' && activePath === `/notes/${targetMenu.noteId}`) {
        window.location.assign('/');
        return;
      }

      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete';
      window.alert(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const submitCreateFolder = async () => {
    if (isSubmittingFolderRef.current) return;
    if (newFolderParentId === undefined) return;
    const sessionId = folderCreateSessionRef.current;
    if (folderSubmittedSessionRef.current === sessionId) return;

    const trimmed = newFolderName.trim();
    if (!trimmed) {
      cancelCreateFolder();
      return;
    }

    const parentId = newFolderParentId ?? null;

    try {
      folderSubmittedSessionRef.current = sessionId;
      isSubmittingFolderRef.current = true;
      setCreatingParentId(parentId ?? '__root__');
      const res = await fetch('/api/folders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          parent_id: parentId,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to create folder');
      }

      const json = await res.json();
      const created = json?.data;
      if (created?.id && created?.name) {
        setTreeFolders((prev) =>
          addFolderToTree(prev, {
            id: created.id,
            name: created.name,
            parent_id: created.parent_id ?? null,
          })
        );

        setExpandedFolderIds((prev) => {
          const nextExpanded = new Set(prev);
          nextExpanded.add(created.id);
          if (parentId) {
            nextExpanded.add(parentId);
          }
          persistExpandedFolderIds(nextExpanded);
          return nextExpanded;
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create folder';
      window.alert(message);
    } finally {
      isSubmittingFolderRef.current = false;
      setCreatingParentId(null);
      setNewFolderParentId(undefined);
      setNewFolderName('');
    }
  };

  const handleNewFolderKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      skipNextFolderBlurSubmitRef.current = true;
      submitCreateFolder();
    } else if (e.key === 'Escape') {
      cancelCreateFolder();
    }
  };

  const handleNewFolderBlur = () => {
    if (skipNextFolderBlurSubmitRef.current) {
      skipNextFolderBlurSubmitRef.current = false;
      return;
    }
    submitCreateFolder();
  };

  const newFolderInput = (depth: number) => (
    <li className="sidebar-tree-item">
      <div className="sidebar-tree-row" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        <input
          ref={newFolderInputRef}
          type="text"
          className="sidebar-inline-input"
          placeholder="Folder name"
          value={newFolderName}
          onInput={(e) => setNewFolderName((e.target as HTMLInputElement).value)}
          onKeyDown={handleNewFolderKeyDown}
          onBlur={handleNewFolderBlur}
        />
      </div>
    </li>
  );

  const submitCreateNote = async () => {
    if (isSubmittingNoteRef.current) return;
    if (newNoteParentId === undefined) return;
    const sessionId = noteCreateSessionRef.current;
    if (noteSubmittedSessionRef.current === sessionId) return;

    const trimmed = newNoteTitle.trim();
    if (!trimmed) {
      cancelCreateNote();
      return;
    }

    const parentId = newNoteParentId ?? null;
    try {
      noteSubmittedSessionRef.current = sessionId;
      isSubmittingNoteRef.current = true;
      setCreatingNoteParentId(parentId ?? '__root__');
      const res = await fetch('/api/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmed,
          content: '',
          folder_id: parentId,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to create note');
      }

      const json = await res.json();
      const created = json?.data;
      if (created?.id) {
        const note: SidebarNoteItem = {
          id: created.id,
          title: (created.title as string) || trimmed || 'Untitled',
        };

        if (parentId) {
          setTreeFolders((prev) => addNoteToTree(prev, note, parentId));
          setExpandedFolderIds((prev) => {
            const next = new Set(prev);
            next.add(parentId);
            persistExpandedFolderIds(next);
            return next;
          });
        } else {
          setTreeRootNotes((prev) => sortNoteItems([...prev, note]));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create note';
      window.alert(message);
    } finally {
      isSubmittingNoteRef.current = false;
      setCreatingNoteParentId(null);
      setNewNoteParentId(undefined);
      setNewNoteTitle('');
    }
  };

  const handleNewNoteKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      skipNextNoteBlurSubmitRef.current = true;
      submitCreateNote();
    } else if (e.key === 'Escape') {
      cancelCreateNote();
    }
  };

  const handleNewNoteBlur = () => {
    if (skipNextNoteBlurSubmitRef.current) {
      skipNextNoteBlurSubmitRef.current = false;
      return;
    }
    submitCreateNote();
  };

  const newNoteInput = (depth: number) => (
    <li className="sidebar-tree-item">
      <div className="sidebar-tree-row" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
        <input
          ref={newNoteInputRef}
          type="text"
          className="sidebar-inline-input"
          placeholder="Note title"
          value={newNoteTitle}
          onInput={(e) => setNewNoteTitle((e.target as HTMLInputElement).value)}
          onKeyDown={handleNewNoteKeyDown}
          onBlur={handleNewNoteBlur}
        />
      </div>
    </li>
  );

  return (
    <div className="sidebar-tree" onContextMenu={(event) => openContextMenu(event, { kind: 'blank' })}>
      {!hasContent ? <p className="sidebar-empty">No notes yet.</p> : null}

      {hasContent && (
        <ul className="sidebar-tree-list">
          {treeFolders.map((folder) => (
            <FolderBranch
              key={folder.id}
              folder={folder}
              depth={0}
              activePath={activePath}
              creatingParentId={creatingParentId}
              creatingNoteParentId={creatingNoteParentId}
              expandedFolderIds={expandedFolderIds}
              onCreateFolder={startCreateFolder}
              onCreateNote={startCreateNote}
              onOpenContextMenu={openContextMenu}
              onToggleFolder={toggleFolder}
              newFolderParentId={newFolderParentId}
              newNoteParentId={newNoteParentId}
              renderNewFolderInput={newFolderInput}
              renderNewNoteInput={newNoteInput}
            />
          ))}
          {newFolderParentId === null && newFolderInput(0)}
          {newNoteParentId === null && newNoteInput(0)}
          {treeRootNotes.map((note) => {
            const href = `/notes/${note.id}`;
            const active = activePath === href;
            return (
              <li className="sidebar-tree-item" key={note.id}>
                <a
                  className={`sidebar-tree-row note ${active ? 'active' : ''}`}
                  style={{ paddingLeft: '8px' }}
                  href={href}
                  onContextMenu={(event) => openContextMenu(event, { kind: 'note', noteId: note.id })}
                >
                  <span className="sidebar-tree-label">{note.title || 'Untitled'}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="sidebar-context-menu"
          role="menu"
          aria-label="Sidebar context menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          {contextMenu.target.kind !== 'note' && (
            <>
              <button
                type="button"
                className="sidebar-context-menu-item"
                role="menuitem"
                disabled={creatingParentId !== null || creatingNoteParentId !== null || isDeleting}
                onClick={handleContextCreateFolder}
              >
                フォルダ作成
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                role="menuitem"
                disabled={creatingParentId !== null || creatingNoteParentId !== null || isDeleting}
                onClick={handleContextCreateNote}
              >
                ノート作成
              </button>
            </>
          )}
          <button
            type="button"
            className="sidebar-context-menu-item"
            role="menuitem"
            disabled={contextMenu.target.kind === 'blank' || isDeleting}
            onClick={handleContextDelete}
          >
            削除
          </button>
        </div>
      )}
    </div>
  );
}
