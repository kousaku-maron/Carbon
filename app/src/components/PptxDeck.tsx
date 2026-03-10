import { readFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useState } from "react";
import { resolveRelativePath } from "../lib/link-utils";
import { type PptxPresentation, type PptxRenderable, loadPptxPresentation } from "../lib/pptx/pptx-parser";

type PptxDeckProps = {
  sourcePath: string;
  currentNotePath?: string | null;
  compact?: boolean;
  title?: string | null;
};

function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || isWindowsAbsolutePath(path);
}

function resolveSourcePath(sourcePath: string, currentNotePath: string | null | undefined): string | null {
  if (!sourcePath) return null;
  if (isAbsolutePath(sourcePath)) return sourcePath;
  if (!currentNotePath) return null;
  return resolveRelativePath(currentNotePath, sourcePath);
}

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function renderTextVerticalAlign(value: PptxRenderable["verticalAlign"]): "flex-start" | "center" | "flex-end" {
  if (value === "middle") return "center";
  if (value === "bottom") return "flex-end";
  return "flex-start";
}

function renderSlideElement(
  element: PptxRenderable,
  slideWidth: number,
  slideHeight: number,
  isThumbnail = false,
) {
  const style = {
    left: percent(element.x, slideWidth),
    top: percent(element.y, slideHeight),
    width: percent(element.width, slideWidth),
    height: percent(element.height, slideHeight),
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    zIndex: element.zIndex,
  };

  if (element.kind === "image" && element.src) {
    return (
      <img
        key={element.id}
        className="pptx-slide-element pptx-slide-image"
        style={style}
        src={element.src}
        alt=""
        draggable={false}
      />
    );
  }

  if (element.kind === "video" && element.src) {
    if (isThumbnail) {
      return (
        <div
          key={element.id}
          className="pptx-slide-element pptx-slide-video-thumb"
          style={{
            ...style,
            background: "linear-gradient(135deg, rgba(17, 24, 39, 0.92), rgba(55, 65, 81, 0.86))",
          }}
        />
      );
    }

    return (
      <video
        key={element.id}
        className="pptx-slide-element pptx-slide-video"
        style={style}
        src={element.src}
        controls
        preload="metadata"
      />
    );
  }

  const textSize = Math.max(10, element.fontSizePx);
  return (
    <div
      key={element.id}
      className="pptx-slide-element pptx-slide-shape"
      style={{
        ...style,
        background: element.fill ?? "transparent",
        borderColor: element.stroke ?? "transparent",
        borderRadius: element.borderRadius,
        color: element.textColor,
        justifyContent: renderTextVerticalAlign(element.verticalAlign),
        textAlign: element.textAlign,
        fontSize: `${(textSize / slideWidth) * 100}cqw`,
      }}
    >
      {element.text ? <span>{element.text}</span> : null}
    </div>
  );
}

function slideLabel(index: number, presentation: PptxPresentation): string {
  return `${index + 1} / ${presentation.slides.length}`;
}

export function PptxDeck(props: PptxDeckProps) {
  const { sourcePath, currentNotePath = null, compact = false, title = null } = props;
  const resolvedPath = useMemo(
    () => resolveSourcePath(sourcePath, currentNotePath),
    [currentNotePath, sourcePath],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<PptxPresentation | null>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    let dispose: (() => void) | null = null;

    setLoading(true);
    setError(null);
    setPresentation(null);
    setActiveSlideIndex(0);

    if (!resolvedPath) {
      setLoading(false);
      setError("PPTX path could not be resolved.");
      return;
    }

    void readFile(resolvedPath)
      .then((bytes) => loadPptxPresentation(bytes))
      .then((result) => {
        if (!alive) {
          result.dispose();
          return;
        }
        dispose = result.dispose;
        setPresentation(result.presentation);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError("PPTXを読み込めませんでした。");
        setLoading(false);
      });

    return () => {
      alive = false;
      dispose?.();
    };
  }, [resolvedPath]);

  useEffect(() => {
    if (!presentation) return;
    setActiveSlideIndex((current) => Math.min(current, Math.max(0, presentation.slides.length - 1)));
  }, [presentation]);

  if (loading) {
    return <p className="pptx-deck-status">PPTXを解析中...</p>;
  }

  if (error) {
    return <p className="pptx-deck-status pptx-deck-status--error">{error}</p>;
  }

  if (!presentation || presentation.slides.length === 0) {
    return <p className="pptx-deck-status">表示できるスライドがありません。</p>;
  }

  const activeSlide = presentation.slides[activeSlideIndex];

  return (
    <div className={`pptx-deck${compact ? " pptx-deck--compact" : ""}`}>
      <div className="pptx-deck-toolbar">
        <div className="pptx-deck-title-group">
          {title ? <span className="pptx-deck-title">{title}</span> : null}
          <span className="pptx-deck-counter">{slideLabel(activeSlideIndex, presentation)}</span>
        </div>
        <div className="pptx-deck-controls">
          <button
            type="button"
            className="pptx-deck-nav-btn"
            onClick={() => setActiveSlideIndex((value) => Math.max(0, value - 1))}
            disabled={activeSlideIndex === 0}
          >
            Prev
          </button>
          <button
            type="button"
            className="pptx-deck-nav-btn"
            onClick={() => setActiveSlideIndex((value) => Math.min(presentation.slides.length - 1, value + 1))}
            disabled={activeSlideIndex >= presentation.slides.length - 1}
          >
            Next
          </button>
        </div>
      </div>

      <div className="pptx-slide-frame">
        <div
          className="pptx-slide"
          style={{
            aspectRatio: `${presentation.widthEmu} / ${presentation.heightEmu}`,
            background: activeSlide.backgroundColor,
          }}
        >
          {activeSlide.elements.map((element) =>
            renderSlideElement(element, presentation.widthEmu, presentation.heightEmu),
          )}
        </div>
      </div>

      {presentation.slides.length > 1 ? (
        <div className="pptx-deck-thumbnails" role="tablist" aria-label="Slides">
          {presentation.slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={activeSlideIndex === index}
              className={`pptx-thumb${activeSlideIndex === index ? " is-active" : ""}`}
              onClick={() => setActiveSlideIndex(index)}
              title={`Slide ${index + 1}`}
            >
              <div
                className="pptx-thumb-canvas"
                style={{
                  aspectRatio: `${presentation.widthEmu} / ${presentation.heightEmu}`,
                  background: slide.backgroundColor,
                }}
              >
                {slide.elements.slice(0, compact ? 12 : 20).map((element) =>
                  renderSlideElement(element, presentation.widthEmu, presentation.heightEmu, true),
                )}
              </div>
              <span className="pptx-thumb-label">{index + 1}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
