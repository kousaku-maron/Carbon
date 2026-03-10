import { readFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { resolveRelativePath } from "../lib/link-utils";

type PdfDeckProps = {
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

function clampZoom(value: number): number {
  return Math.min(2.5, Math.max(0.5, value));
}

let pdfRuntimePromise: Promise<{
  getDocument: typeof import("pdfjs-dist")["getDocument"];
}> | null = null;

function loadPdfRuntime() {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return {
        getDocument: pdfjs.getDocument,
      };
    });
  }

  return pdfRuntimePromise;
}

export function PdfDeck(props: PdfDeckProps) {
  const { sourcePath, currentNotePath = null, compact = false, title = null } = props;
  const resolvedPath = useMemo(
    () => resolveSourcePath(sourcePath, currentNotePath),
    [currentNotePath, sourcePath],
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [zoom, setZoom] = useState(compact ? 0.9 : 1.2);

  useEffect(() => {
    let alive = true;

    setLoading(true);
    setError(null);
    setPageCount(0);
    setActivePage(1);
    setZoom(compact ? 0.9 : 1.2);

    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
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
        return getDocument({ data }).promise;
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
      .catch(() => {
        if (!alive) return;
        setLoading(false);
        setError("PDFを読み込めませんでした。");
      });

    return () => {
      alive = false;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      if (documentRef.current) {
        void documentRef.current.destroy();
        documentRef.current = null;
      }
    };
  }, [compact, resolvedPath]);

  useEffect(() => {
    const pdf = documentRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || pageCount === 0) return;

    let alive = true;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("PDF canvas を初期化できませんでした。");
      return;
    }

    setRendering(true);
    setError(null);
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;

    void pdf
      .getPage(activePage)
      .then((page) => {
        if (!alive) return;
        const viewport = page.getViewport({ scale: zoom });
        const devicePixelRatio = window.devicePixelRatio || 1;
        const outputScale = compact ? 1 : Math.min(2, devicePixelRatio);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

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
        renderTaskRef.current = task;
        return task.promise;
      })
      .then(() => {
        if (!alive) return;
        setRendering(false);
      })
      .catch((renderError: { name?: string } | null) => {
        if (!alive || renderError?.name === "RenderingCancelledException") return;
        setRendering(false);
        setError("PDFページを描画できませんでした。");
      });

    return () => {
      alive = false;
      renderTaskRef.current?.cancel();
    };
  }, [activePage, pageCount, zoom, compact]);

  useEffect(() => {
    setActivePage((current) => Math.min(Math.max(1, current), Math.max(1, pageCount)));
  }, [pageCount]);

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
      <div className="pdf-deck-toolbar">
        <div className="pdf-deck-title-group">
          {title ? <span className="pdf-deck-title">{title}</span> : null}
          <span className="pdf-deck-counter">
            {activePage} / {pageCount}
          </span>
        </div>
        <div className="pdf-deck-controls">
          {!compact ? (
            <>
              <button
                type="button"
                className="pdf-deck-nav-btn"
                onClick={() => setZoom((value) => clampZoom(value - 0.1))}
                disabled={zoom <= 0.5}
              >
                -
              </button>
              <span className="pdf-deck-zoom-label">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="pdf-deck-nav-btn"
                onClick={() => setZoom((value) => clampZoom(value + 0.1))}
                disabled={zoom >= 2.5}
              >
                +
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="pdf-deck-nav-btn"
            onClick={() => setActivePage((value) => Math.max(1, value - 1))}
            disabled={activePage <= 1}
          >
            Prev
          </button>
          <button
            type="button"
            className="pdf-deck-nav-btn"
            onClick={() => setActivePage((value) => Math.min(pageCount, value + 1))}
            disabled={activePage >= pageCount}
          >
            Next
          </button>
        </div>
      </div>

      <div className="pdf-canvas-frame">
        <canvas ref={canvasRef} className="pdf-canvas" />
        {rendering ? <div className="pdf-canvas-overlay">Rendering...</div> : null}
      </div>

      {pageCount > 1 ? (
        <div className="pdf-page-strip" role="tablist" aria-label="Pages">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              role="tab"
              aria-selected={activePage === pageNumber}
              className={`pdf-page-chip${activePage === pageNumber ? " is-active" : ""}`}
              onClick={() => setActivePage(pageNumber)}
            >
              {pageNumber}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
