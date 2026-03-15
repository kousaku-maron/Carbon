import type { PDFDocumentProxy } from "pdfjs-dist";

const PDFJS_PUBLIC_DIR = "pdfjs";
const PREVIEW_WIDTH = 320;

function joinPublicAssetPath(...segments: string[]): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const normalizedSegments = segments.map((segment) => segment.replace(/^\/+|\/+$/g, ""));
  return `${base}${normalizedSegments.join("/")}/`;
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
      (
        globalThis as typeof globalThis & {
          pdfjsWorker?: { WorkerMessageHandler?: unknown };
        }
      ).pdfjsWorker = workerModule as { WorkerMessageHandler?: unknown };

      return {
        getDocument: pdfjs.getDocument,
      };
    });
  }

  return pdfRuntimePromise;
}

async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const { getDocument } = await loadPdfRuntime();
  return getDocument({
    data: bytes,
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
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Failed to render PDF preview"));
    }, "image/png");
  });
}

export async function renderPdfPreviewBlob(bytes: Uint8Array): Promise<Blob | null> {
  let pdf: PDFDocumentProxy | null = null;

  try {
    pdf = await loadPdfDocument(bytes);
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = PREVIEW_WIDTH / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    return await canvasToBlob(canvas);
  } catch (error) {
    console.warn("[share] failed to render pdf preview", error);
    return null;
  } finally {
    if (pdf) {
      await pdf.destroy();
    }
  }
}
