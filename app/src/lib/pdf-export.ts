import {
  buildRenderedMarkdownHtml,
  CARBON_PROSE_CLASS,
  carbonProseCss,
} from "@carbon/rendering";
import { invoke } from "@tauri-apps/api/core";
import { buildPdfRenderDocument, type PdfRenderDocument } from "./pdf-render-document";

export type NotePdfExportRequest = {
  noteId: string;
  notePath: string;
  noteName: string;
  vaultPath: string;
  markdownBody: string;
};

type NativeNotePdfExportRequest = {
  noteName: string;
  vaultPath: string;
  htmlDocument: string;
  outputPath: string;
};

const PDF_DOCUMENT_CSS = `
html {
  background: #ffffff;
}

body {
  margin: 0;
  background: #ffffff;
  color: #37352f;
  font-family: "IBM Plex Sans", "Noto Sans JP", sans-serif;
}

.pdf-export-page {
  min-height: 100vh;
  padding: 24px 0;
  background: #fff;
  color: #37352f;
}

.pdf-export-document {
  width: min(100%, 180mm);
  margin: 0 auto;
  padding: 0;
}

@page {
  size: A4;
  margin: 16mm 14mm 18mm;
}

h1,
h2,
h3,
pre,
blockquote,
table,
figure,
.carbon-file-card,
.carbon-image-node,
.carbon-pdf-node,
.carbon-video-node {
  break-inside: avoid;
  page-break-inside: avoid;
}

pre {
  white-space: pre-wrap;
  overflow: hidden;
}
`;

const PDF_READY_SCRIPT = `
(function () {
  const IMAGE_WAIT_TIMEOUT_MS = 8000;
  const DOCUMENT_WAIT_TIMEOUT_MS = 20000;
  const pendingTasks = [];

  function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function withTimeout(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("PDF preparation timed out")), timeoutMs)),
    ]);
  }

  function trackPromise(promise) {
    const wrapped = Promise.resolve(promise).finally(() => {
      const index = pendingTasks.indexOf(wrapped);
      if (index >= 0) {
        pendingTasks.splice(index, 1);
      }
    });
    pendingTasks.push(wrapped);
    return wrapped;
  }

  window.__carbonPdfPendingTasks = pendingTasks;
  window.__carbonPdfTrackPromise = trackPromise;

  async function waitForRenderableState() {
    await nextTick();
    await nextTick();

    if ("fonts" in document && document.fonts && document.fonts.ready) {
      await withTimeout(document.fonts.ready, IMAGE_WAIT_TIMEOUT_MS);
    }

    const images = Array.from(document.querySelectorAll("img"));
    await Promise.all(images.map(async (image) => {
      if (!image.isConnected) return;
      if (image.complete) {
        await image.decode().catch(() => undefined);
        return;
      }

      await withTimeout(new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      }), IMAGE_WAIT_TIMEOUT_MS);
      await image.decode().catch(() => undefined);
    }));

    if (pendingTasks.length > 0) {
      await withTimeout(Promise.allSettled([...pendingTasks]), DOCUMENT_WAIT_TIMEOUT_MS);
    }

    await nextTick();
  }

  window.__carbonPdfAwaitReady = async function __carbonPdfAwaitReady() {
    await withTimeout(waitForRenderableState(), DOCUMENT_WAIT_TIMEOUT_MS);
    return "ready";
  };
})();
`;

export async function startNotePdfExport(request: NotePdfExportRequest): Promise<string> {
  const renderDocument = buildPdfRenderDocument(request);
  const htmlDocument = buildPdfHtmlDocument(renderDocument);
  return invoke<string>("start_note_pdf_export", {
    request: {
      noteName: request.noteName,
      vaultPath: request.vaultPath,
      htmlDocument,
      outputPath: "",
    } satisfies NativeNotePdfExportRequest,
  });
}

export function formatPdfExportError(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) {
    return cause.message;
  }

  if (typeof cause === "string" && cause.trim()) {
    return cause;
  }

  if (cause && typeof cause === "object") {
    const maybeMessage = Reflect.get(cause, "message");
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }

    const maybeError = Reflect.get(cause, "error");
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError;
    }

    try {
      const serialized = JSON.stringify(cause);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // ignore stringify failures
    }
  }

  return "Failed to export PDF";
}

function buildPdfHtmlDocument(renderDocument: PdfRenderDocument): string {
  const bodyHtml = buildRenderedMarkdownHtml({
    markdownBody: renderDocument.markdownBody,
    assets: renderDocument.assets,
    links: renderDocument.links,
    mode: "pdf",
  });

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(renderDocument.title)}</title>`,
    "<style>",
    carbonProseCss,
    PDF_DOCUMENT_CSS,
    "</style>",
    "<script>",
    PDF_READY_SCRIPT,
    "</script>",
    "</head>",
    "<body>",
    '<div class="pdf-export-page">',
    `<article class="${CARBON_PROSE_CLASS} pdf-export-document">${bodyHtml}</article>`,
    "</div>",
    "</body>",
    "</html>",
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
