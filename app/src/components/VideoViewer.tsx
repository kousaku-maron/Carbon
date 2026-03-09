import { readFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useState } from "react";
import { getVideoMimeType } from "../lib/file-kind";
import { useCopyFeedback } from "../lib/hooks/use-copy-feedback";
import { buildNotePathClipboardItem } from "../lib/tiptap/carbon-link-extension";
import type { TreeNode } from "../lib/types";
import { Toast } from "./Toast";

type VideoViewerProps = {
  file: TreeNode;
};

export function VideoViewer(props: VideoViewerProps) {
  const { file } = props;
  const [hasError, setHasError] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [darkBackground, setDarkBackground] = useState(true);
  const { copied, showCopied, dismissCopied } = useCopyFeedback<"path">(1500);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;

    setHasError(false);
    setLoading(true);
    setVideoSrc(null);

    void readFile(file.path)
      .then((bytes) => {
        if (!alive) return;
        const blob = new Blob([bytes], { type: getVideoMimeType(file.path) });
        objectUrl = URL.createObjectURL(blob);
        setVideoSrc(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setHasError(true);
        setLoading(false);
      });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.path]);

  const handleCopyPath = useCallback(() => {
    const item = buildNotePathClipboardItem(file.path, file.id);
    navigator.clipboard
      .write([item])
      .catch(() => navigator.clipboard.writeText(file.path))
      .then(() => {
        showCopied("path");
      })
      .catch(() => undefined);
  }, [file.path, file.id, showCopied]);

  return (
    <div className="video-viewer">
      <header className="video-viewer-header">
        <span className="video-viewer-title">{file.name}</span>
        <button
          type="button"
          className="note-editor-copy-btn"
          onClick={handleCopyPath}
          title="Copy path"
        >
          {copied === "path" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6.75 9.25L9.25 6.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M8.5 10L7.25 11.25C6.28 12.22 4.72 12.22 3.75 11.25C2.78 10.28 2.78 8.72 3.75 7.75L5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M7.5 6L8.75 4.75C9.72 3.78 11.28 3.78 12.25 4.75C13.22 5.72 13.22 7.28 12.25 8.25L11 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          )}
        </button>
      </header>
      <div
        className={`video-viewer-content ${
          darkBackground ? "video-viewer-content--dark" : "video-viewer-content--light"
        }`}
      >
        <div className="video-viewer-bg-switcher video-viewer-bg-switcher--floating">
          <button
            type="button"
            className={`video-viewer-bg-toggle${darkBackground ? " is-on" : ""}`}
            role="switch"
            aria-checked={darkBackground}
            aria-label="Toggle video background between white and black"
            onClick={() => setDarkBackground((prev) => !prev)}
          >
            <span className="video-viewer-bg-toggle-track">
              <span className="video-viewer-bg-toggle-thumb" />
            </span>
          </button>
          <span className={`video-viewer-bg-switcher-label${darkBackground ? " is-active" : ""}`}>
            Black
          </span>
        </div>
        {hasError ? (
          <p className="video-viewer-error">
            動画を表示できませんでした: <code>{file.name}</code>
          </p>
        ) : loading || !videoSrc ? (
          <p className="video-viewer-loading">動画を読み込み中...</p>
        ) : (
          <video
            className="video-viewer-video"
            src={videoSrc}
            controls
            preload="metadata"
            playsInline
            onError={() => setHasError(true)}
          />
        )}
      </div>
      {copied && <Toast message="Path copied" onClose={dismissCopied} />}
    </div>
  );
}
