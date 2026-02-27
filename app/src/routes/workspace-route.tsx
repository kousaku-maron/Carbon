import { useNavigate } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { useCallback, useEffect, useState } from "react";
import { FileTree } from "../components/FileTree";
import { NoteEditor } from "../components/NoteEditor";
import { VaultSelector } from "../components/VaultSelector";
import { signOut } from "../lib/api";
import { pickVaultFolder, useVault } from "../lib/vault";

export function WorkspaceRoute() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const {
    vaultPath,
    vaultHistory,
    tree,
    activeNote,
    loading,
    switchVault,
    handleRemoveFromHistory,
    handleSelectNote,
    handleSaveNote,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleDelete,
    handleMove,
    handleNavigateToNote,
  } = useVault({ onError: setMessage });

  const handleVaultSwitch = useCallback(
    async (path: string) => {
      setMessage("");
      await switchVault(path);
    },
    [switchVault],
  );

  async function handleBrowse(): Promise<void> {
    const path = await pickVaultFolder();
    if (!path) return;
    await handleVaultSwitch(path);
  }

  async function handleSignOut(): Promise<void> {
    await signOut();
    await navigate({ to: "/login" });
  }

  useEffect(() => {
    let cancelled = false;

    void getVersion()
      .then((version) => {
        if (!cancelled) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppVersion(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
            <img src="/icon.png" alt="Carbon" className="sidebar-brand-icon" />
            <span className="sidebar-brand-text">
              Carbon
              {appVersion ? (
                <span className="sidebar-brand-version">v{appVersion}</span>
              ) : null}
            </span>
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
            onSelect={handleVaultSwitch}
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
        {activeNote && vaultPath ? (
          <NoteEditor
            key={activeNote.docKey}
            note={activeNote}
            onSave={handleSaveNote}
            vaultPath={vaultPath}
            tree={tree}
            onNavigateToNote={handleNavigateToNote}
            onLinkError={(msg) => setMessage(msg)}
          />
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
