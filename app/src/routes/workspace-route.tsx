import { useNavigate } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { useCallback, useEffect, useState } from "react";
import { AboutCarbonDialog } from "../components/AboutCarbonDialog";
import { ActivityBar } from "../components/ActivityBar";
import { FileTree } from "../components/FileTree";
import { ImageViewer } from "../components/ImageViewer";
import { NoteEditor } from "../components/note-editor";
import { PlainTextEditor } from "../components/plaintext-editor";
import { PdfViewer } from "../components/PdfViewer";
import { SharePanel } from "../components/share/SharePanel";
import { Toast } from "../components/Toast";
import { UnsupportedFileViewer } from "../components/UnsupportedFileViewer";
import { VideoViewer } from "../components/VideoViewer";
import { VaultSelector } from "../components/VaultSelector";
import { signOut } from "../lib/api";
import { ENABLE_CLOUD_IMAGE_UPLOAD } from "../lib/app-config";
import { isImagePath, isPdfPath, isVideoPath } from "../lib/file-kind";
import type { NoteViewMode } from "../lib/types";
import { pickVaultFolder, useVault } from "../lib/vault";

export function WorkspaceRoute() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarView, setSidebarView] = useState<"explorer" | "shares">("explorer");
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [activeNoteViewMode, setActiveNoteViewMode] = useState<NoteViewMode>("visual");
  const [noteMenuOpen, setNoteMenuOpen] = useState(false);
  const handleError = useCallback((msg: string) => {
    console.error("[workspace-error]", msg);
    setMessage(msg);
  }, []);

  const {
    vaultPath,
    vaultHistory,
    tree,
    noteIndex,
    activeNote,
    getActiveNoteSnapshot,
    commitActiveNoteBufferToState,
    activeNonMarkdownFile,
    loading,
    switchVault,
    handleRemoveFromHistory,
    handleSelectNote,
    handleLoadFolder,
    handleEditorBufferChange,
    handleSaveNote,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleDelete,
    handleMove,
    handleNavigateToNote,
  } = useVault({ onError: handleError });

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

  useEffect(() => {
    const suppressExternalFileDrop = (e: DragEvent) => {
      const hasFiles = Array.from(e.dataTransfer?.types ?? []).includes("Files");
      if (!hasFiles) return;

      const target = e.target;
      if (
        ENABLE_CLOUD_IMAGE_UPLOAD &&
        target instanceof Element &&
        target.closest(".tiptap, .ProseMirror")
      ) {
        return;
      }

      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "none";
      }
    };

    window.addEventListener("dragover", suppressExternalFileDrop);
    window.addEventListener("drop", suppressExternalFileDrop);

    return () => {
      window.removeEventListener("dragover", suppressExternalFileDrop);
      window.removeEventListener("drop", suppressExternalFileDrop);
    };
  }, []);

  useEffect(() => {
    setNoteMenuOpen(false);
  }, [activeNote?.path]);

  const handleViewModeChange = useCallback((mode: NoteViewMode) => {
    if (mode === "visual") {
      commitActiveNoteBufferToState();
    }
    setActiveNoteViewMode(mode);
  }, [commitActiveNoteBufferToState]);

  const activeNoteSnapshot = getActiveNoteSnapshot();
  const showSidebar = sidebarView === "explorer";

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
      <ActivityBar
        active={sidebarView}
        onChange={setSidebarView}
        onAbout={() => setAboutOpen(true)}
        onSignOut={() => void handleSignOut()}
      />

      {/* ---- Sidebar ---- */}
      {showSidebar ? (
        <aside className={`sidebar ${sidebarOpen ? "" : "sidebar--closed"}`}>
          <div className="sidebar-top">
            <div className="sidebar-toolbar">
              <VaultSelector
                currentPath={vaultPath}
                history={vaultHistory}
                onSelect={handleVaultSwitch}
                onBrowse={handleBrowse}
                onRemove={handleRemoveFromHistory}
              />
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

            {vaultPath ? (
              <nav className="file-tree-container">
                <FileTree
                  nodes={tree}
                  activeNoteId={activeNote?.id ?? activeNonMarkdownFile?.id ?? null}
                  vaultPath={vaultPath}
                  onSelect={handleSelectNote}
                  onExpandFolder={handleLoadFolder}
                  onCreateFile={handleCreateFile}
                  onCreateFolder={handleCreateFolder}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  onMove={handleMove}
                />
              </nav>
            ) : null}
          </div>
        </aside>
      ) : null}

      {/* ---- Main Content ---- */}
      <main className="main-content">
        {showSidebar && !sidebarOpen && (
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
        {sidebarView === "shares" ? (
          <SharePanel vaultPath={vaultPath} noteIndex={noteIndex} onError={handleError} />
        ) : activeNote && vaultPath ? (
          activeNoteViewMode === "plaintext" ? (
            <PlainTextEditor
              key={`plaintext-${activeNote.docKey}`}
              note={activeNoteSnapshot ?? activeNote}
              onSave={handleSaveNote}
              onBufferChange={handleEditorBufferChange}
              viewMode={activeNoteViewMode}
              onViewModeChange={handleViewModeChange}
              menuOpen={noteMenuOpen}
              onMenuOpenChange={setNoteMenuOpen}
            />
          ) : (
            <NoteEditor
              key={`visual-${activeNote.docKey}`}
              note={activeNote}
              onSave={handleSaveNote}
              onBufferChange={handleEditorBufferChange}
              vaultPath={vaultPath}
              noteIndex={noteIndex}
              onNavigateToNote={handleNavigateToNote}
              onLinkError={handleError}
              viewMode={activeNoteViewMode}
              onViewModeChange={handleViewModeChange}
              menuOpen={noteMenuOpen}
              onMenuOpenChange={setNoteMenuOpen}
            />
          )
        ) : activeNonMarkdownFile && isImagePath(activeNonMarkdownFile.path) ? (
          <ImageViewer file={activeNonMarkdownFile} />
        ) : activeNonMarkdownFile && isVideoPath(activeNonMarkdownFile.path) ? (
          <VideoViewer file={activeNonMarkdownFile} />
        ) : activeNonMarkdownFile && isPdfPath(activeNonMarkdownFile.path) ? (
          <PdfViewer file={activeNonMarkdownFile} />
        ) : activeNonMarkdownFile ? (
          <UnsupportedFileViewer file={activeNonMarkdownFile} />
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

      {message && <Toast message={message} onClose={() => setMessage("")} />}
      {aboutOpen ? (
        <AboutCarbonDialog version={appVersion} onClose={() => setAboutOpen(false)} />
      ) : null}
    </div>
  );
}
