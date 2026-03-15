import { readFile } from "@tauri-apps/plugin-fs";
import type { ShareAnalysis } from "./types";
import { renderPdfPreviewBlob } from "./render-pdf-preview";
import { renderShareOgImageBlob } from "./render-share-og-image";

export async function buildShareFormData(analysis: ShareAnalysis): Promise<FormData> {
  const formData = new FormData();
  const metadata = structuredClone(analysis.metadata);
  const fileBytesByField = new Map<string, Uint8Array>();

  for (const upload of analysis.localUploads) {
    const bytes = await readFile(upload.absolutePath);
    fileBytesByField.set(upload.fieldName, bytes);
    const blob = new Blob([bytes], { type: upload.mimeType });
    formData.append(upload.fieldName, blob, upload.fileName);
  }

  for (const asset of metadata.assetManifest) {
    if (asset.kind !== "pdf" || asset.sourceType !== "local-file" || !asset.uploadField) {
      continue;
    }

    const bytes = fileBytesByField.get(asset.uploadField);
    if (!bytes) continue;

    const previewBlob = await renderPdfPreviewBlob(bytes);
    if (!previewBlob) continue;

    const previewUploadField = `preview_${asset.clientAssetId}`;
    asset.previewUploadField = previewUploadField;
    asset.previewMimeType = previewBlob.type || "image/png";
    formData.append(previewUploadField, previewBlob, `${asset.clientAssetId}.png`);
  }

  try {
    const ogImageBlob = await renderShareOgImageBlob({
      title: metadata.title?.trim() || "Untitled",
      markdownBody: metadata.markdownBody,
    });
    metadata.ogImageUploadField = "og_image";
    metadata.ogImageMimeType = ogImageBlob.type || "image/png";
    formData.append(metadata.ogImageUploadField, ogImageBlob, "share-og-image.png");
  } catch (error) {
    console.warn("[share] failed to render og image", error);
  }

  formData.append("metadata", JSON.stringify(metadata));

  return formData;
}
