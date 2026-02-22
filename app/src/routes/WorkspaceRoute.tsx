import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { mkdir, remove, rename, watch, writeTextFile } from "@tauri-apps/plugin-fs";
import { FileTree } from "../components/FileTree";
import { NoteEditor } from "../components/NoteEditor";
import { VaultSelector } from "../components/VaultSelector";
import { request, setSessionToken } from "../lib/api";
import { scanVault } from "../lib/noteIndex";
import { readNote, writeNote } from "../lib/notePersistence";
import {
  getBaseName,
  getParentPath,
  hasInvalidNodeName,
  joinPath,
  toVaultRelative,
} from "../lib/pathUtils";
import type { NoteContent, TreeNode } from "../lib/types";
import {
  getVaultHistory,
  getVaultPath,
  pickVaultFolder,
  removeFromHistory,
  setVaultPath,
} from "../lib/vault";

export function WorkspaceRoute() {
  const navigate = useNavigate();
  const [vaultPath, setVaultPathState] = useState<string | null>(null);
  const [vaultHistory, setVaultHistory] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [activeNote, setActiveNote] = useState<NoteContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const unwatchRef = useRef<(() => void) | null>(null);

  function validateNodeName(raw: string): string {
    const name = raw.trim();
    if (!name) return "Name cannot be empty";
    if (hasInvalidNodeName(name)) {
      return "Name cannot contain path separators or '..'";
    }
    return "";
  }

  // Rescan vault and update tree
  const refreshTree = useCallback(async (path: string) => {
    try {
      const nodes = await scanVault(path);
      setTree(nodes);
    } catch {
      // Silently ignore refresh errors from file watcher
    }
  }, []);

  // Start watching a vault directory for changes
  const startWatching = useCallback(
    async (path: string) => {
      if (unwatchRef.current) {
        unwatchRef.current();
        unwatchRef.current = null;
      }
      try {
        const unwatch = await watch(
          path,
          () => refreshTree(path),
          { recursive: true, delayMs: 500 },
        );
        unwatchRef.current = unwatch;
      } catch {
        // Watching is best-effort
      }
    },
    [refreshTree],
  );

  // Cleanup watcher on unmount
  useEffect(() => {
    return () => {
      if (unwatchRef.current) {
        unwatchRef.current();
        unwatchRef.current = null;
      }
    };
  }, []);

  // On mount: restore persisted vault path and history
  useEffect(() => {
    let active = true;
    (async () => {
      const [path, history] = await Promise.all([
        getVaultPath(),
        getVaultHistory(),
      ]);
      if (active) setVaultHistory(history);
      if (active && path) {
        setVaultPathState(path);
        try {
          const nodes = await scanVault(path);
          if (active) setTree(nodes);
        } catch (err) {
          if (active)
            setMessage(
              err instanceof Error ? err.message : "Failed to scan vault",
            );
        }
        if (active) startWatching(path);
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [startWatching]);

  // Switch to a vault (from selector or browse)
  const switchVault = useCallback(
    async (path: string) => {
      await setVaultPath(path);
      setVaultPathState(path);
      setActiveNote(null);
      setVaultHistory(await getVaultHistory());
      try {
        const nodes = await scanVault(path);
        setTree(nodes);
        setMessage("");
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Failed to scan vault",
        );
      }
      startWatching(path);
    },
    [startWatching],
  );

  async function handleBrowse(): Promise<void> {
    const path = await pickVaultFolder();
    if (!path) return;
    await switchVault(path);
  }

  async function handleRemoveFromHistory(path: string): Promise<void> {
    await removeFromHistory(path);
    setVaultHistory(await getVaultHistory());
  }

  const handleSelectNote = useCallback(async (node: TreeNode) => {
    if (node.kind !== "file") return;
    try {
      const body = await readNote(node.path);
      setActiveNote({
        id: node.id,
        path: node.path,
        name: node.name,
        body,
      });
      setMessage("");
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Failed to read note",
      );
    }
  }, []);

  const handleSaveNote = useCallback(
    async (path: string, content: string) => {
      try {
        await writeNote(path, content);
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Failed to save note",
        );
        throw err instanceof Error ? err : new Error("Failed to save note");
      }
    },
    [],
  );

  const handleCreateFile = useCallback(
    async (parentDir: string, rawName: string) => {
      const stripped = rawName.trim().replace(/\.md$/i, "");
      const validation = validateNodeName(stripped);
      if (validation) {
        setMessage(validation);
        return;
      }
      try {
        const filePath = joinPath(parentDir, `${stripped}.md`);
        await writeTextFile(filePath, "");
        if (vaultPath) await refreshTree(vaultPath);
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Failed to create file",
        );
      }
    },
    [vaultPath, refreshTree],
  );

  const handleCreateFolder = useCallback(
    async (parentDir: string, rawName: string) => {
      const name = rawName.trim();
      const validation = validateNodeName(name);
      if (validation) {
        setMessage(validation);
        return;
      }
      try {
        await mkdir(joinPath(parentDir, name));
        if (vaultPath) await refreshTree(vaultPath);
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Failed to create folder",
        );
      }
    },
    [vaultPath, refreshTree],
  );

  const handleRename = useCallback(
    async (oldPath: string, rawName: string) => {
      const parentDir = getParentPath(oldPath);
      const currentBaseName = getBaseName(oldPath);
      const isMarkdown = /\.md$/i.test(currentBaseName);
      const stripped = isMarkdown ? rawName.trim().replace(/\.md$/i, "") : rawName.trim();
      const validation = validateNodeName(stripped);
      if (validation) {
        setMessage(validation);
        return;
      }
      try {
        const newPath = joinPath(parentDir, `${stripped}${isMarkdown ? ".md" : ""}`);
        await rename(oldPath, newPath);
        if (activeNote && activeNote.path === oldPath) {
          setActiveNote({
            ...activeNote,
            path: newPath,
            name: stripped,
            id: vaultPath ? toVaultRelative(newPath, vaultPath) : activeNote.id,
          });
        }
        if (vaultPath) await refreshTree(vaultPath);
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Failed to rename",
        );
      }
    },
    [activeNote, vaultPath, refreshTree],
  );

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      const label = node.kind === "folder" ? "folder" : "file";
      if (!confirm(`Delete ${label} "${node.name}"?`)) return;
      try {
        await remove(node.path, { recursive: node.kind === "folder" });
        if (activeNote && activeNote.path.startsWith(node.path)) {
          setActiveNote(null);
        }
        if (vaultPath) await refreshTree(vaultPath);
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Failed to delete",
        );
      }
    },
    [activeNote, vaultPath, refreshTree],
  );

  const handleMove = useCallback(
    async (sourcePath: string, targetFolderPath: string) => {
      try {
        const fileName = getBaseName(sourcePath);
        const newPath = joinPath(targetFolderPath, fileName);
        if (sourcePath === newPath) return;
        await rename(sourcePath, newPath);
        if (activeNote && activeNote.path.startsWith(sourcePath)) {
          const suffix = activeNote.path.substring(sourcePath.length);
          const updatedPath = newPath + suffix;
          setActiveNote({
            ...activeNote,
            path: updatedPath,
            id: vaultPath ? toVaultRelative(updatedPath, vaultPath) : activeNote.id,
          });
        }
        if (vaultPath) await refreshTree(vaultPath);
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Failed to move",
        );
      }
    },
    [activeNote, vaultPath, refreshTree],
  );

  async function handleSignOut(): Promise<void> {
    try {
      await request("/api/auth/sign-out", { method: "POST", body: "{}" });
    } catch {
      /* ignore sign-out errors */
    }
    await setSessionToken(null);
    await navigate({ to: "/login" });
  }

  if (loading) {
    return (
      <div className="app-layout">
        <main className="main-content">
          <p style={{ padding: "2rem", color: "#666" }}>Loading...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* ---- Sidebar ---- */}
      <aside className={`sidebar ${sidebarOpen ? "" : "sidebar--closed"}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="sidebar-brand-icon">C</span>
            <span className="sidebar-brand-text">Carbon</span>
            <button
              className="sidebar-toggle-btn"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          </div>

          <VaultSelector
            currentPath={vaultPath}
            history={vaultHistory}
            onSelect={switchVault}
            onBrowse={handleBrowse}
            onRemove={handleRemoveFromHistory}
          />

          {vaultPath && (
            <nav className="file-tree-container">
              <FileTree
                nodes={tree}
                activeNoteId={activeNote?.id ?? null}
                vaultPath={vaultPath}
                onSelect={handleSelectNote}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onRename={handleRename}
                onDelete={handleDelete}
                onMove={handleMove}
              />
            </nav>
          )}
        </div>

        <div className="sidebar-bottom">
          <button className="sidebar-signout" onClick={handleSignOut}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ---- Main Content ---- */}
      <main className="main-content">
        {!sidebarOpen && (
          <button
            className="sidebar-open-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        )}
        {activeNote ? (
          <NoteEditor note={activeNote} onSave={handleSaveNote} />
        ) : (
          <div className="workspace-empty">
            <p>
              {vaultPath
                ? "Select a note from the sidebar"
                : "Select a vault to get started"}
            </p>
          </div>
        )}
      </main>

      {message && (
        <div className="toast" onClick={() => setMessage("")}>
          {message}
        </div>
      )}
    </div>
  );
}
