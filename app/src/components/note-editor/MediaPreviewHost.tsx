import { PdfDeck } from "../PdfDeck";
import type { MediaPreview } from "./use-media-preview";

type MediaPreviewHostProps = {
  notePath: string;
  preview: MediaPreview;
  videoPreviewRef: { current: HTMLVideoElement | null };
  onClose: () => void;
  onPdfPageChange: (page: number) => void;
};

export function MediaPreviewHost(props: MediaPreviewHostProps) {
  const { notePath, preview, videoPreviewRef, onClose, onPdfPageChange } = props;

  if (!preview) return null;

  if (preview.kind === "image") {
    return (
      <div
        className="note-editor-image-preview"
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
        onClick={onClose}
      >
        <div
          className="note-editor-image-preview-content"
          onClick={(event) => event.stopPropagation()}
        >
          <img
            className="note-editor-image-preview-image"
            src={preview.src}
            alt={preview.alt}
            draggable={false}
          />
        </div>
      </div>
    );
  }

  if (preview.kind === "pdf") {
    return (
      <div
        className="note-editor-pdf-preview"
        role="dialog"
        aria-modal="true"
        aria-label={`PDF preview: ${preview.title}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <div
          className="note-editor-pdf-preview-content"
          onClick={(event) => event.stopPropagation()}
        >
          <PdfDeck
            sourcePath={preview.src}
            currentNotePath={notePath}
            compact
            compactPage={preview.currentPage}
            onCompactPageChange={onPdfPageChange}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="note-editor-video-preview"
      role="dialog"
      aria-modal="true"
      aria-label={`Video preview: ${preview.title}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="note-editor-video-preview-content"
        onClick={(event) => event.stopPropagation()}
      >
        <video
          ref={(node) => {
            videoPreviewRef.current = node;
          }}
          className="note-editor-video-preview-video"
          src={preview.src}
          controls
          autoPlay={!preview.paused}
          preload="metadata"
          playsInline
          disablePictureInPicture
          autoFocus
        />
      </div>
    </div>
  );
}
