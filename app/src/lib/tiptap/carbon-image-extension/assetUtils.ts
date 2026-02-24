/** Extract the asset ID from a `carbon://asset/{id}` URI. */
export function parseAssetUri(uri: string): string | null {
  const match = uri.match(/^carbon:\/\/asset\/([a-zA-Z0-9_]+)$/);
  return match ? match[1] : null;
}

/** Generate a data-URI SVG placeholder shown while an asset is being resolved. */
export function buildAssetLoadingImage(alt: string): string {
  const label = alt.trim() || "Image";
  const escapedLabel = label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="180" viewBox="0 0 720 180">',
    '<rect x="0" y="0" width="720" height="180" fill="#f7f6f3"/>',
    '<rect x="12" y="12" width="696" height="156" rx="10" fill="none" stroke="#d7d5d1" stroke-width="2" stroke-dasharray="8 6"/>',
    `<text x="24" y="94" font-family="IBM Plex Sans, Noto Sans JP, sans-serif" font-size="18" fill="#a8a6a2">`,
    escapedLabel,
    "</text>",
    "</svg>",
  ].join("");

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** Generate a data-URI SVG placeholder shown when an asset fails to resolve. */
export function buildAssetResolveErrorImage(alt: string): string {
  const label = alt.trim() || "Image";
  const message = `${label}: failed to load`;
  const escapedMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="180" viewBox="0 0 720 180">',
    '<rect x="0" y="0" width="720" height="180" fill="#f7f6f3"/>',
    '<rect x="12" y="12" width="696" height="156" rx="10" fill="none" stroke="#d7d5d1" stroke-width="2" stroke-dasharray="8 6"/>',
    '<text x="24" y="94" font-family="IBM Plex Sans, Noto Sans JP, sans-serif" font-size="18" fill="#787774">',
    escapedMessage,
    "</text>",
    "</svg>",
  ].join("");

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
