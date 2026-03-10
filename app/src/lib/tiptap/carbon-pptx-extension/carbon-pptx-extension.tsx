import { Node, createAtomBlockMarkdownSpec, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { PptxDeck } from "../../../components/PptxDeck";
import { isPptxPath } from "../../file-kind";

export interface CarbonPptxOptions {
  currentNotePath: string | null;
}

const localPastePluginKey = new PluginKey("carbonLocalPptxPaste");

const markdownSpec = createAtomBlockMarkdownSpec({
  nodeName: "pptx",
  name: "pptx",
  requiredAttributes: ["src"],
  allowedAttributes: ["src", "title"],
});

function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function hasUriScheme(src: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(src);
}

function isLocalPptxSource(src: string): boolean {
  if (!src) return false;
  if (/^https?:\/\//i.test(src)) return false;
  if (hasUriScheme(src) && !isWindowsAbsolutePath(src)) return false;
  return true;
}

function isLocalPptxPathCandidate(src: string): boolean {
  if (!src || !isLocalPptxSource(src) || !isPptxPath(src)) return false;
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

function CarbonPptxNodeView(props: {
  extension: { options: CarbonPptxOptions };
  node: { attrs: Record<string, unknown> };
  selected: boolean;
}) {
  const src = typeof props.node.attrs.src === "string" ? props.node.attrs.src : "";
  const title =
    typeof props.node.attrs.title === "string" && props.node.attrs.title.length > 0
      ? props.node.attrs.title
      : getPathLabel(src);

  return (
    <NodeViewWrapper className={`carbon-pptx-node${props.selected ? " ProseMirror-selectednode" : ""}`}>
      <PptxDeck
        sourcePath={src}
        currentNotePath={props.extension.options.currentNotePath}
        compact
        title={title}
      />
    </NodeViewWrapper>
  );
}

export const CarbonPptx = Node.create<CarbonPptxOptions>({
  name: "pptx",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      currentNotePath: null,
    } as CarbonPptxOptions;
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      title: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-carbon-pptx]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-carbon-pptx": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CarbonPptxNodeView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: localPastePluginKey,
        props: {
          handlePaste: (view, event) => {
            const files = event.clipboardData?.files;
            if (files && files.length > 0) return false;

            const text = event.clipboardData?.getData("text/plain")?.trim();
            if (!text || text.includes("\n")) return false;
            if (!isLocalPptxPathCandidate(text)) return false;

            event.preventDefault();
            const title = getPathLabel(text);
            const node = this.type.create({
              src: text,
              title,
            });
            view.dispatch(view.state.tr.replaceSelectionWith(node, false));
            return true;
          },
        },
      }),
    ];
  },

  addStorage() {
    return {};
  },

  markdownTokenName: "pptx",
  markdownTokenizer: markdownSpec.markdownTokenizer,

  parseMarkdown(token, helpers) {
    const src = typeof token.attributes?.src === "string" ? token.attributes.src : "";
    if (!src) return [];

    return helpers.createNode("pptx", {
      src,
      title:
        typeof token.attributes?.title === "string" && token.attributes.title.length > 0
          ? token.attributes.title
          : getPathLabel(src),
    });
  },

  renderMarkdown(node) {
    const attrs = node.attrs ?? {};
    const src = typeof attrs.src === "string" ? attrs.src : "";
    if (!src) return "";

    const title = typeof attrs.title === "string" ? attrs.title : "";
    const markdown = markdownSpec.renderMarkdown({
      type: "pptx",
      attrs: {
        src,
        ...(title ? { title } : {}),
      },
    });

    return `${markdown}\n\n`;
  },
});
