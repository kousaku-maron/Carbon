import { Node, createAtomBlockMarkdownSpec, mergeAttributes } from "@tiptap/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { getVideoMimeType, isVideoPath } from "../../file-kind";
import { resolveRelativePath } from "../../link-utils";
import { CarbonVideoNodeView } from "./carbon-video-node-view";

export interface CarbonVideoOptions {
  /** Absolute path of current note. Used to resolve relative local video paths. */
  currentNotePath: string | null;
  onPreviewVideo: ((payload: {
    src: string;
    title: string;
    currentTime: number;
    paused: boolean;
    muted: boolean;
    volume: number;
    playbackRate: number;
    syncBack: (state: {
      currentTime: number;
      paused: boolean;
      muted: boolean;
      volume: number;
      playbackRate: number;
    }) => void;
  }) => void) | null;
}

const localResolvePluginKey = new PluginKey("carbonLocalVideoResolve");

const markdownSpec = createAtomBlockMarkdownSpec({
  nodeName: "video",
  name: "video",
  requiredAttributes: ["src"],
  allowedAttributes: ["src", "title"],
});

function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function hasUriScheme(src: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(src);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || isWindowsAbsolutePath(path);
}

function isLocalVideoSource(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("blob:")) return false;
  if (src.startsWith("data:")) return false;
  if (/^https?:\/\//i.test(src)) return false;
  if (hasUriScheme(src) && !isWindowsAbsolutePath(src)) return false;
  return true;
}

function isLocalVideoPathCandidate(src: string): boolean {
  if (!src || !isLocalVideoSource(src) || !isVideoPath(src)) return false;
  return (
    src.startsWith("./") ||
    src.startsWith("../") ||
    src.startsWith("/") ||
    isWindowsAbsolutePath(src)
  );
}

function getPathLabel(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

export const CarbonVideo = Node.create<CarbonVideoOptions>({
  name: "video",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      currentNotePath: null,
      onPreviewVideo: null,
    } as CarbonVideoOptions;
  },

  addStorage() {
    const extension = this;

    return {
      localPreviewUrls: new Set<string>(),

      async resolveLocalVideos(editor: any): Promise<void> {
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
            if (node.type.name !== "video") return;

            const attrs = node.attrs;
            const src = typeof attrs.src === "string" ? attrs.src : "";
            const localSrcFromAttr =
              typeof attrs["data-local-src"] === "string"
                ? (attrs["data-local-src"] as string)
                : "";
            const localSrc = localSrcFromAttr || src;
            if (!isLocalVideoSource(localSrc)) return;

            if (src.startsWith("blob:") && localSrcFromAttr) return;

            const absolutePath = isAbsolutePath(localSrc)
              ? localSrc
              : resolveRelativePath(currentNotePath, localSrc);
            if (!isVideoPath(absolutePath)) return;

            targets.push({ pos, attrs, localSrc, absolutePath });
          },
        );

        if (targets.length === 0) return;

        const tr = editor.state.tr;
        let changed = false;

        for (const target of targets) {
          try {
            const bytes = await readFile(target.absolutePath);
            const blob = new Blob([bytes], { type: getVideoMimeType(target.absolutePath) });
            const blobUrl = URL.createObjectURL(blob);
            this.localPreviewUrls.add(blobUrl);

            tr.setNodeMarkup(target.pos, undefined, {
              ...target.attrs,
              src: blobUrl,
              title:
                typeof target.attrs.title === "string" && target.attrs.title.length > 0
                  ? target.attrs.title
                  : getPathLabel(target.localSrc),
              "data-local-src": target.localSrc,
              "data-local-error": false,
            });
            changed = true;
          } catch {
            if (target.attrs["data-local-error"] === true) continue;
            tr.setNodeMarkup(target.pos, undefined, {
              ...target.attrs,
              title:
                typeof target.attrs.title === "string" && target.attrs.title.length > 0
                  ? target.attrs.title
                  : getPathLabel(target.localSrc),
              "data-local-src": target.localSrc,
              "data-local-error": true,
            });
            changed = true;
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

  addAttributes() {
    return {
      src: {
        default: null,
      },
      title: {
        default: null,
      },
      "data-local-src": {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-local-src"),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes["data-local-src"]) return {};
          return { "data-local-src": attributes["data-local-src"] };
        },
      },
      "data-local-error": {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-local-error") === "true",
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes["data-local-error"]) return {};
          return { "data-local-error": "true" };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "video" }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = {
      ...HTMLAttributes,
      controls: "",
      preload: "metadata",
      playsinline: "",
      disablepictureinpicture: "",
    };

    return ["video", mergeAttributes(attrs)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CarbonVideoNodeView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: localResolvePluginKey,
        view: () => {
          const resolve = () => {
            void this.storage.resolveLocalVideos(this.editor);
          };
          resolve();
          return {
            update: (view, prevState) => {
              if (view.state.doc.eq(prevState.doc)) return;
              resolve();
            },
          };
        },
        props: {
          handlePaste: (view, event) => {
            const files = event.clipboardData?.files;
            if (files && files.length > 0) return false;

            const text = event.clipboardData?.getData("text/plain")?.trim();
            if (!text || text.includes("\n")) return false;
            if (!isLocalVideoPathCandidate(text)) return false;

            event.preventDefault();
            const title = getPathLabel(text);
            const node = this.type.create({
              src: text,
              title,
              "data-local-src": text,
              "data-local-error": false,
            });
            view.dispatch(view.state.tr.replaceSelectionWith(node, false));
            return true;
          },
        },
      }),
    ];
  },

  onDestroy() {
    for (const blobUrl of this.storage.localPreviewUrls as Set<string>) {
      URL.revokeObjectURL(blobUrl);
    }
    (this.storage.localPreviewUrls as Set<string>).clear();
  },

  markdownTokenName: "video",
  markdownTokenizer: markdownSpec.markdownTokenizer,

  parseMarkdown(token, helpers) {
    const src = typeof token.attributes?.src === "string" ? token.attributes.src : "";
    if (!src) return [];

    return helpers.createNode("video", {
      src,
      title:
        typeof token.attributes?.title === "string" && token.attributes.title.length > 0
          ? token.attributes.title
          : getPathLabel(src),
      "data-local-src": isLocalVideoSource(src) ? src : null,
      "data-local-error": false,
    });
  },

  renderMarkdown(node) {
    const attrs = node.attrs ?? {};
    const localSrc =
      typeof attrs["data-local-src"] === "string"
        ? (attrs["data-local-src"] as string)
        : "";
    const src = localSrc || (typeof attrs.src === "string" ? attrs.src : "");
    if (!src || src.startsWith("blob:")) return "";

    const title = typeof attrs.title === "string" ? attrs.title : "";
    const markdown = markdownSpec.renderMarkdown({
      type: "video",
      attrs: {
        src,
        ...(title ? { title } : {}),
      },
    });

    return `${markdown}\n\n`;
  },
});
