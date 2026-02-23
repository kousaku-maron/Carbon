const MAX_COMPRESSED_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_DIMENSION = 2560;
const QUALITY_STEPS = [0.85, 0.7, 0.5, 0.3];
const PREFERRED_TYPE = "image/webp";
const FALLBACK_TYPE = "image/jpeg";

export type CompressedImage = {
  blob: Blob;
  width: number;
  height: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function calcDimensions(
  origW: number,
  origH: number,
  maxDim: number,
): { width: number; height: number } {
  if (origW <= maxDim && origH <= maxDim) return { width: origW, height: origH };
  const ratio = Math.min(maxDim / origW, maxDim / origH);
  return {
    width: Math.round(origW * ratio),
    height: Math.round(origH * ratio),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      type,
      quality,
    );
  });
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = calcDimensions(img.naturalWidth, img.naturalHeight, MAX_DIMENSION);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2d context unavailable");
    ctx.drawImage(img, 0, 0, width, height);

    // Try preferred format at each quality step, then fallback format
    for (const type of [PREFERRED_TYPE, FALLBACK_TYPE]) {
      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, type, quality);
        if (blob.size <= MAX_COMPRESSED_BYTES) {
          return { blob, width, height };
        }
      }
    }

    throw new Error(
      `Image too large after compression (minimum size exceeds ${MAX_COMPRESSED_BYTES / 1024 / 1024}MB)`,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function isImageFile(file: File): boolean {
  return ["image/png", "image/jpeg", "image/webp"].includes(file.type);
}
