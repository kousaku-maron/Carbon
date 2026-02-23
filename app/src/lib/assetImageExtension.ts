import Image from "@tiptap/extension-image";

/**
 * Extended TipTap Image node that stores `data-asset-uri` for permanent
 * `carbon://asset/...` references. The `src` is a short-lived signed URL
 * for display only.
 */
export const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-asset-uri": {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-asset-uri"),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes["data-asset-uri"]) return {};
          return { "data-asset-uri": attributes["data-asset-uri"] };
        },
      },
    };
  },
});
