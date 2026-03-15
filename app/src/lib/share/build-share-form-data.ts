import { readFile } from "@tauri-apps/plugin-fs";
import type { ShareAnalysis } from "./types";

export async function buildShareFormData(analysis: ShareAnalysis): Promise<FormData> {
  const formData = new FormData();
  formData.append("metadata", JSON.stringify(analysis.metadata));

  for (const upload of analysis.localUploads) {
    const bytes = await readFile(upload.absolutePath);
    const blob = new Blob([bytes], { type: upload.mimeType });
    formData.append(upload.fieldName, blob, upload.fileName);
  }

  return formData;
}
