import type { Editor } from "@tiptap/core";
import { isImagePath, isPdfPath, isVideoPath } from "../file-kind";

type ImageAssetStorage = {
  canUpload?: () => boolean;
  prepareUploadFile?: (file: File) => Promise<File>;
  uploadImage?: (editor: Editor, file: File, pos?: number) => Promise<void>;
};

type VideoAssetStorage = {
  canInsertAsset?: () => boolean;
  insertVideoAsset?: (editor: Editor, file: File, pos?: number) => Promise<void>;
};

type PdfAssetStorage = {
  canInsertAsset?: () => boolean;
  insertPdfAsset?: (editor: Editor, file: File, pos?: number) => Promise<void>;
};

function isImageAssetFile(file: File): boolean {
  return file.type.startsWith("image/") || isImagePath(file.name);
}

function isVideoAssetFile(file: File): boolean {
  return file.type.startsWith("video/") || isVideoPath(file.name);
}

function isPdfAssetFile(file: File): boolean {
  return file.type === "application/pdf" || isPdfPath(file.name);
}

export function getDroppedAssetFiles(
  files: ArrayLike<File> | Iterable<File> | null | undefined,
): File[] {
  if (!files) return [];
  return Array.from(files).filter(
    (file) => isImageAssetFile(file) || isVideoAssetFile(file) || isPdfAssetFile(file),
  );
}

export function hasDroppedAssetFiles(
  dataTransfer: Pick<DataTransfer, "files"> | null | undefined,
): boolean {
  return getDroppedAssetFiles(dataTransfer?.files).length > 0;
}

export async function appendDroppedAssets(
  editor: Editor,
  files: ArrayLike<File> | Iterable<File> | null | undefined,
  insertPos?: number,
): Promise<boolean> {
  const assetFiles = getDroppedAssetFiles(files);
  if (assetFiles.length === 0) return false;

  const imageStorage = (editor.storage as { image?: ImageAssetStorage }).image;
  const videoStorage = (editor.storage as { video?: VideoAssetStorage }).video;
  const pdfStorage = (editor.storage as { pdf?: PdfAssetStorage }).pdf;
  let handled = false;

  for (const file of assetFiles) {
    const targetPos = insertPos ?? editor.state.doc.content.size;

    if (isImageAssetFile(file)) {
      if (!imageStorage?.canUpload?.() || !imageStorage.uploadImage) continue;
      const prepareUploadFile =
        imageStorage.prepareUploadFile ?? ((input: File) => Promise.resolve(input));
      const preparedFile = await prepareUploadFile(file);
      await imageStorage.uploadImage(editor, preparedFile, targetPos);
      handled = true;
      continue;
    }

    if (isVideoAssetFile(file)) {
      if (!videoStorage?.canInsertAsset?.() || !videoStorage.insertVideoAsset) continue;
      await videoStorage.insertVideoAsset(editor, file, targetPos);
      handled = true;
      continue;
    }

    if (isPdfAssetFile(file)) {
      if (!pdfStorage?.canInsertAsset?.() || !pdfStorage.insertPdfAsset) continue;
      await pdfStorage.insertPdfAsset(editor, file, targetPos);
      handled = true;
    }
  }

  return handled;
}
