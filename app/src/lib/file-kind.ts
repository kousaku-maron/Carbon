const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".avif",
  ".ico",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".ogv",
]);

function getLowerCaseExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "";
  return path.slice(dot).toLowerCase();
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getLowerCaseExtension(path));
}

export function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSIONS.has(getLowerCaseExtension(path));
}

export function getImageMimeType(path: string): string {
  const ext = getLowerCaseExtension(path);
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".avif") return "image/avif";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

export function getVideoMimeType(path: string): string {
  const ext = getLowerCaseExtension(path);
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".ogv") return "video/ogg";
  return "application/octet-stream";
}
