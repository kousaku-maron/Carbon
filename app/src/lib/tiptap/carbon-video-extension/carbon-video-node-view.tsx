import { NodeViewWrapper } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import type { CarbonVideoOptions } from "./carbon-video-extension";

type CarbonVideoNodeViewProps = {
  extension: { options: CarbonVideoOptions };
  node: { attrs: Record<string, unknown> };
  selected: boolean;
};

function getPathLabel(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

export function CarbonVideoNodeView(props: CarbonVideoNodeViewProps) {
  const src = typeof props.node.attrs.src === "string" ? props.node.attrs.src : "";
  const title =
    typeof props.node.attrs.title === "string" && props.node.attrs.title.length > 0
      ? props.node.attrs.title
      : getPathLabel(src);
  const hasError = props.node.attrs["data-local-error"] === true;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPaused, setIsPaused] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncPausedState = () => {
      setIsPaused(video.paused);
    };

    syncPausedState();
    video.addEventListener("play", syncPausedState);
    video.addEventListener("pause", syncPausedState);
    video.addEventListener("loadedmetadata", syncPausedState);
    video.addEventListener("emptied", syncPausedState);

    return () => {
      video.removeEventListener("play", syncPausedState);
      video.removeEventListener("pause", syncPausedState);
      video.removeEventListener("loadedmetadata", syncPausedState);
      video.removeEventListener("emptied", syncPausedState);
    };
  }, [src]);

  const syncVideoState = (state: {
    currentTime: number;
    paused: boolean;
    muted: boolean;
    volume: number;
    playbackRate: number;
  }) => {
    const video = videoRef.current;
    if (!video) return;

    const applyState = () => {
      video.currentTime = state.currentTime;
      video.muted = state.muted;
      video.volume = state.volume;
      video.playbackRate = state.playbackRate;
      if (state.paused) {
        video.pause();
        return;
      }
      void video.play().catch(() => undefined);
    };

    if (video.readyState >= 1) {
      applyState();
      return;
    }

    video.addEventListener("loadedmetadata", applyState, { once: true });
  };

  return (
    <NodeViewWrapper className={`carbon-video-node${props.selected ? " ProseMirror-selectednode" : ""}`}>
      <div className={`carbon-video-frame${isPaused ? " is-paused" : ""}`}>
        <video
          ref={videoRef}
          className="carbon-video-embed"
          src={src}
          controls
          preload="metadata"
          playsInline
          disablePictureInPicture
          data-local-error={hasError ? "true" : undefined}
        />
        {!hasError && src ? (
          <button
            type="button"
            className="carbon-video-expand-btn"
            aria-label={`Expand video: ${title}`}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const video = videoRef.current;
              if (!video) return;

              const payload = {
                src,
                title,
                currentTime: video.currentTime,
                paused: video.paused,
                muted: video.muted,
                volume: video.volume,
                playbackRate: video.playbackRate,
                syncBack: syncVideoState,
              };

              if (!video.paused) {
                video.pause();
              }

              props.extension.options.onPreviewVideo?.(payload);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6.25 3.75H3.75V6.25M9.75 12.25H12.25V9.75M3.75 3.75L6.4 6.4M12.25 12.25L9.6 9.6"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
