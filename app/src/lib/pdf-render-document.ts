import type { RenderedAssetItem, RenderedLinkItem } from "@carbon/rendering";
import { analyzeShareInput } from "./share/analyze-share-input";
import { transformMarkdownForPdfExport } from "./tiptap/markdown";

export type BuildPdfRenderDocumentInput = {
  noteId: string;
  notePath: string;
  noteName: string;
  vaultPath: string;
  markdownBody: string;
};

export type PdfRenderDocument = {
  title: string;
  markdownBody: string;
  assets: RenderedAssetItem[];
  links: RenderedLinkItem[];
};

export function buildPdfRenderDocument(input: BuildPdfRenderDocumentInput): PdfRenderDocument {
  const transformedMarkdown = transformMarkdownForPdfExport({
    markdown: input.markdownBody,
    currentNotePath: input.notePath,
    vaultPath: input.vaultPath,
  });
  const analysis = analyzeShareInput({
    noteId: input.noteId,
    notePath: input.notePath,
    vaultPath: input.vaultPath,
    markdownBody: transformedMarkdown,
    title: input.noteName,
  });
  const localUploadByField = new Map(
    analysis.localUploads.map((upload) => [upload.fieldName, upload] as const),
  );

  const assets: RenderedAssetItem[] = analysis.metadata.assetManifest.map((asset) => {
    let publicUrl: string | null = null;

    if (asset.kind === "image" && asset.sourceType === "local-file" && asset.uploadField) {
      const upload = localUploadByField.get(asset.uploadField);
      if (upload) {
        publicUrl = toFileUrl(upload.absolutePath);
      }
    }

    if (asset.kind === "image" && asset.sourceType === "carbon-asset") {
      // TODO: Support carbon://asset image export via a dedicated authenticated resource path.
      publicUrl = null;
    }

    return {
      kind: asset.kind,
      sourceRef: asset.sourceRef,
      title: asset.title ?? null,
      publicUrl,
      previewImageUrl: null,
    };
  });

  const links: RenderedLinkItem[] = analysis.metadata.linkManifest.map((link) => (
    link.kind === "external-link"
      ? { ...link, publicUrl: link.href }
      : link
  ));

  return {
    title: analysis.metadata.title ?? input.noteName,
    markdownBody: transformedMarkdown,
    assets,
    links,
  };
}

function toFileUrl(absolutePath: string): string {
  if (/^[A-Za-z]:[\\/]/.test(absolutePath)) {
    const normalized = absolutePath.replace(/\\/g, "/");
    return `file:///${encodePathForFileUrl(normalized)}`;
  }

  if (absolutePath.startsWith("/")) {
    return `file://${encodePathForFileUrl(absolutePath)}`;
  }

  return `file://${encodePathForFileUrl(absolutePath.replace(/\\/g, "/"))}`;
}

function encodePathForFileUrl(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
    .replace(/%3A/g, ":");
}
