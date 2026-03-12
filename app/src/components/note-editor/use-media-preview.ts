import { useCallback, useEffect, useRef, useState } from "react";

export type ImagePreviewPayload = {
  src: string;
  alt: string;
};

export type PdfPreviewPayload = {
  src: string;
  title: string;
  currentPage: number;
  syncBack: (page: number) => void;
};

export type VideoPreviewPayload = {
  src: string;
  title: string;
  currentTime: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
  syncBack: (state: {
    currentTime: number;
    paused: boolean;
    muted: boolean;
    volume: number;
    playbackRate: number;
  }) => void;
};

export type MediaPreview =
  | ({ kind: "image" } & ImagePreviewPayload)
  | ({ kind: "pdf" } & PdfPreviewPayload)
  | ({ kind: "video" } & VideoPreviewPayload)
  | null;

function readVideoPlaybackState(video: HTMLVideoElement) {
  return {
    currentTime: video.currentTime,
    paused: video.paused,
    muted: video.muted,
    volume: video.volume,
    playbackRate: video.playbackRate,
  };
}

export function useMediaPreview() {
  const [preview, setPreview] = useState<MediaPreview>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  const openImagePreview = useCallback((payload: ImagePreviewPayload) => {
    setPreview({ kind: "image", ...payload });
  }, []);

  const openPdfPreview = useCallback((payload: PdfPreviewPayload) => {
    setPreview({ kind: "pdf", ...payload });
  }, []);

  const openVideoPreview = useCallback((payload: VideoPreviewPayload) => {
    setPreview({ kind: "video", ...payload });
  }, []);

  const updatePdfPreviewPage = useCallback((page: number) => {
    setPreview((current) => {
      if (!current || current.kind !== "pdf") return current;
      return { ...current, currentPage: page };
    });
  }, []);

  const closePreview = useCallback(() => {
    setPreview((current) => {
      if (!current) return current;

      if (current.kind === "pdf") {
        current.syncBack(current.currentPage);
        return null;
      }

      if (current.kind === "video" && videoPreviewRef.current) {
        current.syncBack(readVideoPlaybackState(videoPreviewRef.current));
        return null;
      }

      return null;
    });
  }, []);

  useEffect(() => {
    if (!preview) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePreview();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closePreview, preview]);

  useEffect(() => {
    const video = videoPreviewRef.current;
    if (!preview || preview.kind !== "video" || !video) return;

    const applyPreviewState = () => {
      video.currentTime = preview.currentTime;
      video.muted = preview.muted;
      video.volume = preview.volume;
      video.playbackRate = preview.playbackRate;
      if (preview.paused) {
        video.pause();
        return;
      }
      void video.play().catch(() => undefined);
    };

    if (video.readyState >= 1) {
      applyPreviewState();
      return;
    }

    video.addEventListener("loadedmetadata", applyPreviewState, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", applyPreviewState);
    };
  }, [preview]);

  return {
    preview,
    videoPreviewRef,
    openImagePreview,
    openPdfPreview,
    openVideoPreview,
    updatePdfPreviewPage,
    closePreview,
  };
}
