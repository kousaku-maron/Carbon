import { readFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { resolveRelativePath } from "../lib/link-utils";

type PdfDeckProps = {
  sourcePath: string;
  currentNotePath?: string | null;
  compact?: boolean;
  darkBackground?: boolean;
  onDarkBackgroundChange?: (value: boolean) => void;
  onPreviewRequest?: () => void;
  compactPage?: number;
  onCompactPageChange?: (page: number) => void;
};

const PDF_ZOOM_STORAGE_KEY = "carbon.pdf.zoom";
const DEFAULT_PDF_ZOOM = 1;
const MIN_PDF_ZOOM = 0.6;
const MAX_PDF_ZOOM = 1;
const PDF_ZOOM_STEP = 0.1;
const ZOOM_INDICATOR_DISPLAY_MS = 2000;
const PDFJS_PUBLIC_DIR = "pdfjs";

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

function clampPdfZoom(value: number): number {
  return Math.min(MAX_PDF_ZOOM, Math.max(MIN_PDF_ZOOM, value));
}

function parseStoredPdfZoom(value: string | null): number {
  if (!value) return DEFAULT_PDF_ZOOM;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PDF_ZOOM;
  return clampPdfZoom(parsed);
}

function joinPublicAssetPath(...segments: string[]): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const normalizedSegments = segments.map((segment) => segment.replace(/^\/+|\/+$/g, ""));
  return `${base}${normalizedSegments.join("/")}/`;
}

function renderFrameClassName(darkBackground: boolean, compact: boolean): string {
  if (compact) return "pdf-canvas-frame pdf-canvas-frame--compact";
  return `pdf-canvas-frame${darkBackground ? " pdf-canvas-frame--dark" : " pdf-canvas-frame--light"}`;
}

let pdfRuntimePromise: Promise<{
  getDocument: typeof import("pdfjs-dist")["getDocument"];
}> | null = null;

function loadPdfRuntime() {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs"),
    ]).then(([pdfjs, workerModule]) => {
      // Force PDF.js into the fake-worker path. This avoids Web Worker startup
      // differences across Tauri WebViews while keeping the parsing stack intact.
      (globalThis as typeof globalThis & {
        pdfjsWorker?: { WorkerMessageHandler?: unknown };
      }).pdfjsWorker = workerModule as { WorkerMessageHandler?: unknown };
      return {
        getDocument: pdfjs.getDocument,
      };
    });
  }

  return pdfRuntimePromise;
}

export function PdfDeck(props: PdfDeckProps) {
  const {
    sourcePath,
    currentNotePath = null,
    compact = false,
    darkBackground: controlledDarkBackground,
    onDarkBackgroundChange,
    onPreviewRequest,
    compactPage,
    onCompactPageChange,
  } = props;
  const resolvedPath = useMemo(
    () => resolveSourcePath(sourcePath, currentNotePath),
    [currentNotePath, sourcePath],
  );
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const renderTasksRef = useRef(new Map<number, RenderTask>());
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [activeCompactPage, setActiveCompactPage] = useState(1);
  const [localDarkBackground, setLocalDarkBackground] = useState(false);
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_PDF_ZOOM;
    return parseStoredPdfZoom(window.localStorage.getItem(PDF_ZOOM_STORAGE_KEY));
  });
  const [zoomIndicatorVisible, setZoomIndicatorVisible] = useState(false);
  const darkBackground = controlledDarkBackground ?? localDarkBackground;
  const effectiveCompactPage = compactPage ?? activeCompactPage;
  const zoomRef = useRef(zoom);
  const zoomIndicatorTimeoutRef = useRef<number | null>(null);
  const visiblePages = useMemo(
    () => (compact ? [effectiveCompactPage] : Array.from({ length: pageCount }, (_, index) => index + 1)),
    [compact, effectiveCompactPage, pageCount],
  );

  const setCompactPageValue = (nextPage: number | ((current: number) => number)) => {
    const resolvedCurrent = effectiveCompactPage;
    const nextValue =
      typeof nextPage === "function"
        ? nextPage(resolvedCurrent)
        : nextPage;
    const boundedValue = pageCount > 0
      ? Math.min(Math.max(1, nextValue), pageCount)
      : Math.max(1, nextValue);

    if (compactPage == null) {
      setActiveCompactPage(boundedValue);
    }
    onCompactPageChange?.(boundedValue);
  };

  useEffect(() => {
    let alive = true;

    setLoading(true);
    setError(null);
    setPageCount(0);
    setActiveCompactPage(1);
    setLocalDarkBackground(false);

    for (const task of renderTasksRef.current.values()) {
      task.cancel();
    }
    renderTasksRef.current.clear();
    void documentRef.current?.destroy();
    documentRef.current = null;

    if (!resolvedPath) {
      setLoading(false);
      setError("PDF path could not be resolved.");
      return;
    }

    void readFile(resolvedPath)
      .then(async (bytes) => {
        const { getDocument } = await loadPdfRuntime();
        const data = new Uint8Array(bytes.byteLength);
        data.set(bytes);
        return getDocument({
          data,
          cMapUrl: joinPublicAssetPath(PDFJS_PUBLIC_DIR, "cmaps"),
          cMapPacked: true,
          standardFontDataUrl: joinPublicAssetPath(PDFJS_PUBLIC_DIR, "standard_fonts"),
          wasmUrl: joinPublicAssetPath(PDFJS_PUBLIC_DIR, "wasm"),
          useSystemFonts: true,
          disableFontFace: false,
          useWorkerFetch: false,
          isOffscreenCanvasSupported: false,
          isImageDecoderSupported: false,
        }).promise;
      })
      .then((pdf) => {
        if (!alive) {
          void pdf.destroy();
          return;
        }
        documentRef.current = pdf;
        setPageCount(pdf.numPages);
        setLoading(false);
      })
      .catch((loadError) => {
        if (!alive) return;
        console.error("[PdfDeck] load failed", loadError);
        setLoading(false);
        setError("PDFを読み込めませんでした。");
      });

    return () => {
      alive = false;
      for (const task of renderTasksRef.current.values()) {
        task.cancel();
      }
      renderTasksRef.current.clear();
      if (documentRef.current) {
        void documentRef.current.destroy();
        documentRef.current = null;
      }
    };
  }, [compact, resolvedPath]);

  useEffect(() => {
    if (pageCount === 0) return;
    if (compactPage != null) {
      onCompactPageChange?.(Math.min(Math.max(1, compactPage), pageCount));
      return;
    }
    setActiveCompactPage((current) => Math.min(Math.max(1, current), pageCount));
  }, [compactPage, onCompactPageChange, pageCount]);

  useEffect(() => {
    const pdf = documentRef.current;
    if (!pdf || visiblePages.length === 0) return;

    let alive = true;
    setRendering(true);
    setError(null);

    for (const task of renderTasksRef.current.values()) {
      task.cancel();
    }
    renderTasksRef.current.clear();

    const renderPages = async () => {
      try {
        for (const pageNumber of visiblePages) {
          if (!alive) return;

          const canvas = canvasRefs.current.get(pageNumber);
          if (!canvas) continue;

          const context = canvas.getContext("2d");
          if (!context) {
            throw new Error("PDF canvas could not be initialized");
          }

          const page = await pdf.getPage(pageNumber);
          if (!alive) return;

          const viewport = page.getViewport({ scale: compact ? 0.9 : zoom });
          const devicePixelRatio = window.devicePixelRatio || 1;
          const outputScale = compact ? 1 : Math.min(2, devicePixelRatio);
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.height = "auto";
          if (compact) {
            canvas.style.width = "100%";
            canvas.style.maxWidth = "100%";
          } else {
            canvas.style.width = `${Math.round(zoom * 100)}%`;
            canvas.style.maxWidth = "100%";
          }

          const transform =
            outputScale !== 1
              ? [outputScale, 0, 0, outputScale, 0, 0] as [number, number, number, number, number, number]
              : undefined;

          const task = page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform,
          });
          renderTasksRef.current.set(pageNumber, task);
          await task.promise;
          renderTasksRef.current.delete(pageNumber);
        }

        if (!alive) return;
        setRendering(false);
      } catch (renderError) {
        if (
          !alive ||
          (typeof renderError === "object" &&
            renderError !== null &&
            "name" in renderError &&
            renderError.name === "RenderingCancelledException")
        ) {
          return;
        }
        console.error("[PdfDeck] render failed", renderError);
        setRendering(false);
        setError("PDFページを描画できませんでした。");
      }
    };

    void renderPages();

    return () => {
      alive = false;
      for (const task of renderTasksRef.current.values()) {
        task.cancel();
      }
      renderTasksRef.current.clear();
    };
  }, [visiblePages, compact, zoom]);

  useEffect(() => {
    zoomRef.current = zoom;
    if (!compact) {
      window.localStorage.setItem(PDF_ZOOM_STORAGE_KEY, zoom.toFixed(1));
    }
  }, [zoom, compact]);

  useEffect(() => {
    return () => {
      if (zoomIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(zoomIndicatorTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (compact) return;

    const showZoomIndicator = () => {
      if (zoomIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(zoomIndicatorTimeoutRef.current);
        zoomIndicatorTimeoutRef.current = null;
      }
      setZoomIndicatorVisible(true);
      zoomIndicatorTimeoutRef.current = window.setTimeout(() => {
        setZoomIndicatorVisible(false);
        zoomIndicatorTimeoutRef.current = null;
      }, ZOOM_INDICATOR_DISPLAY_MS);
    };

    const updateZoom = (delta: number) => {
      const nextZoom = clampPdfZoom(Math.round((zoomRef.current + delta) * 10) / 10);
      if (nextZoom === zoomRef.current) return;
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      showZoomIndicator();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const hasPrimaryModifier = e.metaKey || e.ctrlKey;
      if (!hasPrimaryModifier || !e.shiftKey || e.altKey) return;
      if (e.isComposing) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      const isZoomIn = e.code === "Equal" || e.code === "NumpadAdd" || e.key === "+";
      const isZoomOut = e.code === "Minus" || e.code === "NumpadSubtract" || e.key === "-" || e.key === "_";
      if (!isZoomIn && !isZoomOut) return;
      e.preventDefault();
      if (isZoomIn) {
        updateZoom(PDF_ZOOM_STEP);
      } else {
        updateZoom(-PDF_ZOOM_STEP);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [compact]);

  if (loading) {
    return <p className="pdf-deck-status">PDFを読み込み中...</p>;
  }

  if (error) {
    return <p className="pdf-deck-status pdf-deck-status--error">{error}</p>;
  }

  if (!pageCount) {
    return <p className="pdf-deck-status">表示できるページがありません。</p>;
  }

  return (
    <div className={`pdf-deck${compact ? " pdf-deck--compact" : ""}`}>
      {!compact ? (
        <div className="pdf-deck-toolbar">
          <span className="pdf-deck-counter">{`${pageCount} pages`}</span>
          <div className="pdf-deck-controls">
            <div className="pdf-viewer-bg-switcher">
              <button
                type="button"
                className={`pdf-viewer-bg-toggle${darkBackground ? " is-on" : ""}`}
                role="switch"
                aria-checked={darkBackground}
                aria-label="Toggle PDF background between white and black"
                onClick={() => {
                  const next = !darkBackground;
                  onDarkBackgroundChange?.(next);
                  if (controlledDarkBackground == null) {
                    setLocalDarkBackground(next);
                  }
                }}
              >
                <span className="pdf-viewer-bg-toggle-track">
                  <span className="pdf-viewer-bg-toggle-thumb" />
                </span>
              </button>
              <span className={`pdf-viewer-bg-switcher-label${darkBackground ? " is-active" : ""}`}>
                Black
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <div className={renderFrameClassName(darkBackground, compact)}>
        <div className="pdf-canvas-stack">
          {visiblePages.map((pageNumber) => (
            <div key={pageNumber} className="pdf-canvas-page">
              <canvas
                ref={(node) => {
                  if (node) {
                    canvasRefs.current.set(pageNumber, node);
                  } else {
                    canvasRefs.current.delete(pageNumber);
                  }
                }}
                className="pdf-canvas"
              />
            </div>
          ))}
        </div>
        {rendering ? <div className="pdf-canvas-overlay">Rendering...</div> : null}
        {compact && onPreviewRequest ? (
          <button
            type="button"
            className="pdf-compact-expand-btn"
            aria-label="Expand PDF preview"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPreviewRequest();
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
        {compact ? (
          <div className="pdf-compact-footer" aria-label="PDF page controls">
            <button
              type="button"
              className="pdf-compact-footer-btn"
              onClick={() => setCompactPageValue((current) => current - 1)}
              disabled={effectiveCompactPage <= 1}
              aria-label="Previous PDF page"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M10 3.5L5.5 8L10 12.5"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <span className="pdf-compact-footer-counter">
              {effectiveCompactPage} / {pageCount}
            </span>
            <button
              type="button"
              className="pdf-compact-footer-btn"
              onClick={() => setCompactPageValue((current) => current + 1)}
              disabled={effectiveCompactPage >= pageCount}
              aria-label="Next PDF page"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M6 3.5L10.5 8L6 12.5"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
      {!compact ? (
        <div className={`pdf-viewer-zoom-indicator${zoomIndicatorVisible ? " is-visible" : ""}`}>
          {Math.round(zoom * 100)}%
        </div>
      ) : null}
    </div>
  );
}
