import Image from "@tiptap/extension-image";
import type { ImageOptions } from "@tiptap/extension-image";
import type { Editor } from "@tiptap/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { getImageMimeType, isImagePath } from "../../file-kind";
import { resolveRelativePath } from "../../link-utils";
import { CarbonImageNodeView } from "./carbon-image-node-view";
import { compressImage } from "./image-compression";
import { parseAssetUri, buildAssetLoadingImage, buildAssetResolveErrorImage } from "./asset-utils";
import { uploadAsset, cacheUrl, resolveAndCache } from "./asset-client";

export interface CarbonImageOptions extends ImageOptions {
  /** Enable built-in image compression before upload. */
  compress: boolean;
  /** API base URL. When set, upload and resolve are handled internally. */
  apiUrl: string | null;
  /** Allow image upload via drag-and-drop / paste. */
  uploadEnabled: boolean;
  /** Absolute path of current note. Used to resolve relative local image paths. */
  currentNotePath: string | null;
  /** Interval (ms) for periodic re-resolve of signed URLs. 0 to disable. */
  resolveInterval: number;
  /** Open a preview modal for the rendered image. */
  onPreviewImage: ((payload: { src: string; alt: string }) => void) | null;
}

const uploadDecoPluginKey = new PluginKey<Set<string>>("carbonImageUploadDeco");
const localResolvePluginKey = new PluginKey("carbonLocalImageResolve");

type ImageEditorStorage = {
  canUpload?: () => boolean;
  prepareUploadFile?: (file: File) => Promise<File>;
  uploadImage?: (editor: Editor, file: File, pos?: number) => Promise<void>;
};

export function getDroppedImageFiles(
  files: ArrayLike<File> | Iterable<File> | null | undefined,
): File[] {
  if (!files) return [];
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

export function hasDroppedImageFiles(
  dataTransfer: Pick<DataTransfer, "files"> | null | undefined,
): boolean {
  return getDroppedImageFiles(dataTransfer?.files).length > 0;
}

export async function appendDroppedImages(
  editor: Editor,
  files: ArrayLike<File> | Iterable<File> | null | undefined,
): Promise<boolean> {
  const imageFiles = getDroppedImageFiles(files);
  if (imageFiles.length === 0) return false;

  const imageStorage = (editor.storage as { image?: ImageEditorStorage }).image;
  if (!imageStorage?.canUpload?.()) return false;
  if (!imageStorage?.uploadImage) return false;

  const insertPos = editor.state.doc.content.size;
  const prepareUploadFile =
    imageStorage.prepareUploadFile ?? ((file: File) => Promise.resolve(file));

  for (const file of imageFiles) {
    const preparedFile = await prepareUploadFile(file);
    await imageStorage.uploadImage(editor, preparedFile, insertPos);
  }

  return true;
}

function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function hasUriScheme(src: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(src);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || isWindowsAbsolutePath(path);
}

function isLocalImageSource(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("blob:")) return false;
  if (src.startsWith("data:")) return false;
  if (src.startsWith("carbon://asset/")) return false;
  if (/^https?:\/\//i.test(src)) return false;
  if (hasUriScheme(src) && !isWindowsAbsolutePath(src)) return false;
  return true;
}

/**
 * Extended TipTap Image node that stores `data-asset-uri` for permanent
 * `carbon://asset/...` references. The `src` is a short-lived signed URL
 * for display only.
 *
 * When `apiUrl` is set the extension handles image upload, URL resolution,
 * and periodic signed-URL refresh internally.
 *
 * Includes custom Markdown parse/serialize rules so that `@tiptap/markdown`
 * can round-trip `carbon://asset/...` URIs without loss.
 */
export const CarbonImage = Image.extend<CarbonImageOptions>({
  // ── 1. Options ──────────────────────────────────────────────

  addOptions() {
    return {
      ...this.parent?.(),
      compress: true,
      apiUrl: null,
      uploadEnabled: true,
      currentNotePath: null,
      resolveInterval: 4 * 60 * 1000,
      onPreviewImage: null,
    } as CarbonImageOptions;
  },

  addNodeView() {
    return ReactNodeViewRenderer(CarbonImageNodeView);
  },

  // ── 2. Storage ──────────────────────────────────────────────

  addStorage() {
    const extension = this;

    return {
      resolveTimer: null as ReturnType<typeof setInterval> | null,
      localPreviewUrls: new Set<string>(),
      canUpload(): boolean {
        return Boolean(extension.options.apiUrl && extension.options.uploadEnabled);
      },

      async prepareUploadFile(file: File): Promise<File> {
        if (!extension.options.compress) return file;
        try {
          const result = await compressImage(file);
          return new File([result.blob], file.name, { type: result.blob.type });
        } catch {
          return file;
        }
      },

      /** Insert preview, upload to API, replace with signed URL. */
      async uploadImage(
        editor: any,
        file: File,
        insertPos?: number,
      ): Promise<void> {
        const { apiUrl, uploadEnabled } = extension.options;
        if (!apiUrl || !uploadEnabled) return;

        const blobUrl = URL.createObjectURL(file);

        // Insert preview image immediately.
        const pos = insertPos ?? editor.state.selection.anchor;
        editor
          .chain()
          .focus()
          .insertContentAt(pos, {
            type: "image",
            attrs: {
              src: blobUrl,
              alt: file.name,
              "data-asset-uri": null,
              "data-asset-error": false,
            },
          })
          .run();

        // Mark this blobUrl as uploading so the decoration plugin shows the overlay.
        {
          const tr = editor.state.tr;
          tr.setMeta(uploadDecoPluginKey, { type: "add", blobUrl });
          tr.setMeta("addToHistory", false);
          editor.view.dispatch(tr);
        }

        try {
          const result = await uploadAsset(apiUrl, file);

          // Cache the signed URL for future resolve cycles.
          cacheUrl(result.assetId, result.signedUrl, result.expiresAt);

          // Replace blob URL with signed URL + set data-asset-uri.
          // The decoration disappears automatically because src no longer matches.
          const { doc } = editor.state;
          let found = false;
          doc.descendants((node: any, nodePos: number) => {
            if (found) return false;
            if (node.type.name === "image" && node.attrs.src === blobUrl) {
              found = true;
              const tr = editor.state.tr.setNodeMarkup(nodePos, undefined, {
                ...node.attrs,
                src: result.signedUrl,
                "data-asset-uri": result.assetUri,
                "data-asset-error": false,
              });
              tr.setMeta(uploadDecoPluginKey, { type: "remove", blobUrl });
              editor.view.dispatch(tr);
              return false;
            }
          });
        } catch (err) {
          console.error("Image upload failed:", err);

          // Remove the failed placeholder image.
          const { doc } = editor.state;
          doc.descendants((node: any, nodePos: number) => {
            if (node.type.name === "image" && node.attrs.src === blobUrl) {
              const tr = editor.state.tr.delete(nodePos, nodePos + node.nodeSize);
              tr.setMeta("addToHistory", false);
              tr.setMeta(uploadDecoPluginKey, { type: "remove", blobUrl });
              editor.view.dispatch(tr);
              return false;
            }
          });
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      },

      /** Scan the document for carbon://asset images and resolve their URLs. */
      async resolveImages(editor: any): Promise<void> {
        await this.resolveLocalImages(editor);

        const { apiUrl } = extension.options;
        if (!apiUrl) return;

        const targets: Array<{
          pos: number;
          attrs: Record<string, unknown>;
          assetId: string;
          assetUri: string;
        }> = [];

        editor.state.doc.descendants(
          (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => {
            if (node.type.name !== "image") return;

            const attrs = node.attrs;
            const src = typeof attrs.src === "string" ? attrs.src : "";
            const dataAssetUri =
              typeof attrs["data-asset-uri"] === "string"
                ? (attrs["data-asset-uri"] as string)
                : "";

            const idFromData = dataAssetUri ? parseAssetUri(dataAssetUri) : null;
            const idFromSrc = src ? parseAssetUri(src) : null;
            const assetId = idFromData ?? idFromSrc;
            if (!assetId) return;

            targets.push({
              pos,
              attrs,
              assetId,
              assetUri: idFromData ? dataAssetUri : `carbon://asset/${assetId}`,
            });
          },
        );

        if (targets.length === 0) return;

        try {
          const uniqueAssetIds = Array.from(new Set(targets.map((t) => t.assetId)));
          const urlMap = await resolveAndCache(apiUrl, uniqueAssetIds);

          const tr = editor.state.tr;
          let changed = false;
          for (const target of targets) {
            const newUrl = urlMap.get(target.assetId);
            const alt = typeof target.attrs.alt === "string" ? target.attrs.alt : "Image";

            const nextAttrs = {
              ...target.attrs,
              src: newUrl ?? buildAssetResolveErrorImage(alt),
              "data-asset-uri": target.assetUri,
              "data-asset-loading": false,
              "data-asset-error": !newUrl,
            };

            if (
              nextAttrs.src !== target.attrs.src ||
              nextAttrs["data-asset-uri"] !== target.attrs["data-asset-uri"] ||
              nextAttrs["data-asset-loading"] !== target.attrs["data-asset-loading"] ||
              nextAttrs["data-asset-error"] !== target.attrs["data-asset-error"]
            ) {
              tr.setNodeMarkup(target.pos, undefined, nextAttrs);
              changed = true;
            }
          }

          if (changed) {
            tr.setMeta("addToHistory", false);
            tr.setMeta("skipPersistence", true);
            editor.view.dispatch(tr);
          }
        } catch (err) {
          console.error("Failed to resolve asset image URLs", err);

          const tr = editor.state.tr;
          let changed = false;

          for (const target of targets) {
            const alt = typeof target.attrs.alt === "string" ? target.attrs.alt : "Image";
            const nextAttrs = {
              ...target.attrs,
              src: buildAssetResolveErrorImage(alt),
              "data-asset-uri": target.assetUri,
              "data-asset-loading": false,
              "data-asset-error": true,
            };

            if (
              nextAttrs.src !== target.attrs.src ||
              nextAttrs["data-asset-loading"] !== target.attrs["data-asset-loading"] ||
              nextAttrs["data-asset-error"] !== target.attrs["data-asset-error"]
            ) {
              tr.setNodeMarkup(target.pos, undefined, nextAttrs);
              changed = true;
            }
          }

          if (changed) {
            tr.setMeta("addToHistory", false);
            tr.setMeta("skipPersistence", true);
            editor.view.dispatch(tr);
          }
        }
      },

      async resolveLocalImages(editor: any): Promise<void> {
        const { currentNotePath } = extension.options;
        if (!currentNotePath) return;

        const targets: Array<{
          pos: number;
          attrs: Record<string, unknown>;
          localSrc: string;
          absolutePath: string;
        }> = [];

        editor.state.doc.descendants(
          (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => {
            if (node.type.name !== "image") return;

            const attrs = node.attrs;
            const src = typeof attrs.src === "string" ? attrs.src : "";
            const localSrcFromAttr =
              typeof attrs["data-local-src"] === "string"
                ? (attrs["data-local-src"] as string)
                : "";
            const localSrc = localSrcFromAttr || src;
            if (!isLocalImageSource(localSrc)) return;

            // Already resolved to local blob preview.
            if (src.startsWith("blob:") && localSrcFromAttr) return;

            const absolutePath = isAbsolutePath(localSrc)
              ? localSrc
              : resolveRelativePath(currentNotePath, localSrc);
            if (!isImagePath(absolutePath)) return;

            targets.push({ pos, attrs, localSrc, absolutePath });
          },
        );

        if (targets.length === 0) return;

        const tr = editor.state.tr;
        let changed = false;

        for (const target of targets) {
          try {
            const bytes = await readFile(target.absolutePath);
            const blob = new Blob([bytes], { type: getImageMimeType(target.absolutePath) });
            const blobUrl = URL.createObjectURL(blob);
            this.localPreviewUrls.add(blobUrl);

            tr.setNodeMarkup(target.pos, undefined, {
              ...target.attrs,
              src: blobUrl,
              "data-local-src": target.localSrc,
            });
            changed = true;
          } catch {
            // Keep original src if local read fails.
          }
        }

        if (changed) {
          tr.setMeta("addToHistory", false);
          tr.setMeta("skipPersistence", true);
          editor.view.dispatch(tr);
        }
      },
    };
  },

  // ── 3. Attributes ───────────────────────────────────────────

  addAttributes() {
    return {
      ...this.parent?.(),
      "data-asset-uri": {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-asset-uri"),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes["data-asset-uri"]) return {};
          return { "data-asset-uri": attributes["data-asset-uri"] };
        },
      },
      "data-asset-loading": {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-asset-loading") === "true",
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes["data-asset-loading"]) return {};
          return { "data-asset-loading": "true" };
        },
      },
      "data-asset-error": {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-asset-error") === "true",
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes["data-asset-error"]) return {};
          return { "data-asset-error": "true" };
        },
      },
      "data-local-src": {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-local-src"),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes["data-local-src"]) return {};
          return { "data-local-src": attributes["data-local-src"] };
        },
      },
};
  },

  // ── 4. Plugins ──────────────────────────────────────────────

  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];

    plugins.push(
      new Plugin({
        key: localResolvePluginKey,
        view: () => {
          const resolve = () => {
            void this.storage.resolveLocalImages(this.editor);
          };
          resolve();
          return {
            update: (view, prevState) => {
              if (view.state.doc.eq(prevState.doc)) return;
              resolve();
            },
          };
        },
      }),
    );

    if (this.options.apiUrl) {
      const handleImageInsert = (file: File, pos?: number) => {
        void this.storage.uploadImage(this.editor, file, pos);
      };

      // Drop / paste interception.
      plugins.push(
        new Plugin({
          key: new PluginKey("carbonImageUpload"),
          props: {
            handleDrop: (view, event, _slice, moved) => {
              if (moved) return false;
              if (!this.options.apiUrl) return false;

              const files = event.dataTransfer?.files;
              if (!files || files.length === 0) return false;

              const imageFiles = Array.from(files).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (imageFiles.length === 0) return false;
              if (!this.options.uploadEnabled) {
                event.preventDefault();
                return true;
              }

              event.preventDefault();
              const dropPos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              })?.pos;
              for (const file of imageFiles) {
                void this.storage
                  .prepareUploadFile(file)
                  .then((f: File) => handleImageInsert(f, dropPos));
              }
              return true;
            },
            handlePaste: (_view, event) => {
              if (!this.options.apiUrl) return false;

              const files = event.clipboardData?.files;
              if (!files || files.length === 0) return false;

              const imageFiles = Array.from(files).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (imageFiles.length === 0) return false;
              if (!this.options.uploadEnabled) {
                event.preventDefault();
                return true;
              }

              event.preventDefault();
              for (const file of imageFiles) {
                void this.storage.prepareUploadFile(file).then((f: File) => handleImageInsert(f));
              }
              return true;
            },
          },
        }),
      );

      // Upload progress decoration.
      plugins.push(
        new Plugin({
          key: uploadDecoPluginKey,
          state: {
            init() {
              return new Set<string>();
            },
            apply(tr, prev) {
              const meta = tr.getMeta(uploadDecoPluginKey) as
                | { type: "add" | "remove"; blobUrl: string }
                | undefined;
              if (!meta) return prev;
              const next = new Set(prev);
              if (meta.type === "add") next.add(meta.blobUrl);
              if (meta.type === "remove") next.delete(meta.blobUrl);
              return next;
            },
          },
          props: {
            decorations(state) {
              const blobUrls = uploadDecoPluginKey.getState(state);
              if (!blobUrls || blobUrls.size === 0) return DecorationSet.empty;
              const decos: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (
                  node.type.name === "image" &&
                  typeof node.attrs.src === "string" &&
                  blobUrls.has(node.attrs.src)
                ) {
                  decos.push(
                    Decoration.node(pos, pos + node.nodeSize, {
                      class: "carbon-image-uploading",
                    }),
                  );
                }
              });
              return DecorationSet.create(state.doc, decos);
            },
          },
        }),
      );
    }

    return plugins;
  },

  // ── 5. Lifecycle ────────────────────────────────────────────

  onCreate() {
    void this.storage.resolveImages(this.editor);
    if (this.options.apiUrl && this.options.resolveInterval > 0) {
      this.storage.resolveTimer = setInterval(() => {
        void this.storage.resolveImages(this.editor);
      }, this.options.resolveInterval);
    }
  },

  onDestroy() {
    if (this.storage.resolveTimer) {
      clearInterval(this.storage.resolveTimer);
      this.storage.resolveTimer = null;
    }
    for (const blobUrl of this.storage.localPreviewUrls as Set<string>) {
      URL.revokeObjectURL(blobUrl);
    }
    (this.storage.localPreviewUrls as Set<string>).clear();
  },

  // ── 6. Markdown ─────────────────────────────────────────────

  /**
   * Markdown → TipTap JSON (parse).
   *
   * When the Markdown `image` token carries a `carbon://asset/…` href,
   * store it as both `src` and `data-asset-uri` so that the editor can
   * later replace `src` with a signed URL while preserving the permanent
   * reference.
   */
  parseMarkdown(token, helpers) {
    const src = token.href ?? token.src ?? "";
    const alt = token.text ?? "";
    const isAsset = src.startsWith("carbon://asset/");
    const isLocal = !isAsset && isLocalImageSource(src);
    return helpers.createNode("image", {
      src: isAsset ? buildAssetLoadingImage(alt) : src,
      alt,
      title: token.title ?? null,
      "data-asset-uri": isAsset ? src : null,
      "data-asset-loading": isAsset,
      "data-asset-error": false,
      "data-local-src": isLocal ? src : null,
    });
  },

  /**
   * TipTap JSON → Markdown (serialize).
   *
   * If `data-asset-uri` is set, emit that as the image source so we never
   * persist a short-lived signed URL.
   */
  renderMarkdown(
    node: { attrs?: Record<string, unknown> },
  ) {
    const attrs = node.attrs ?? {};
    const assetUri =
      typeof attrs["data-asset-uri"] === "string"
        ? (attrs["data-asset-uri"] as string)
        : "";
    const localSrc =
      typeof attrs["data-local-src"] === "string"
        ? (attrs["data-local-src"] as string)
        : "";
    const src = assetUri || localSrc || (typeof attrs.src === "string" ? attrs.src : "");
    const alt = typeof attrs.alt === "string" ? attrs.alt : "";
    const title = typeof attrs.title === "string" ? attrs.title : "";
    // Never persist temporary preview images.
    if (!assetUri && src.startsWith("blob:")) return "";
    if (!src) return "";
    if (title) return `![${alt}](${src} "${title}")\n\n`;
    return `![${alt}](${src})\n\n`;
  },
});
