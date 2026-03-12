import { NodeViewWrapper } from "@tiptap/react";
import type { CarbonImageOptions } from "./carbon-image-extension";

type CarbonImageNodeViewProps = {
  extension: { options: CarbonImageOptions };
  node: { attrs: Record<string, unknown> };
  selected: boolean;
};

export function CarbonImageNodeView(props: CarbonImageNodeViewProps) {
  const src = typeof props.node.attrs.src === "string" ? props.node.attrs.src : "";
  const alt = typeof props.node.attrs.alt === "string" && props.node.attrs.alt.length > 0
    ? props.node.attrs.alt
    : "Image";
  const isLoading = props.node.attrs["data-asset-loading"] === true;
  const hasError = props.node.attrs["data-asset-error"] === true;
  const localSrc = typeof props.node.attrs["data-local-src"] === "string"
    ? props.node.attrs["data-local-src"]
    : undefined;
  const assetUri = typeof props.node.attrs["data-asset-uri"] === "string"
    ? props.node.attrs["data-asset-uri"]
    : undefined;

  return (
    <NodeViewWrapper className={`carbon-image-node${props.selected ? " ProseMirror-selectednode" : ""}`}>
      <div className="carbon-image-frame">
        <img
          className="carbon-image-embed"
          src={src}
          alt={alt}
          data-asset-loading={isLoading ? "true" : undefined}
          data-asset-error={hasError ? "true" : undefined}
          data-local-src={localSrc}
          data-asset-uri={assetUri}
          draggable={false}
        />
        {!isLoading && !hasError && src ? (
          <button
            type="button"
            className="carbon-image-expand-btn"
            aria-label={`Expand image: ${alt}`}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.extension.options.onPreviewImage?.({ src, alt });
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6.25 3.75H3.75V6.25M9.75 12.25H12.25V9.75M3.75 3.75L6.4 6.4M12.25 12.25L9.6 9.6"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
