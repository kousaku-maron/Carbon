import { Node, createAtomBlockMarkdownSpec, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useState } from "react";
import { PdfDeck } from "../../../components/PdfDeck";
import { isPdfPath } from "../../file-kind";
import { saveFileToVaultAssets } from "../vault-asset-storage";

export interface CarbonPdfOptions {
  uploadEnabled: boolean;
  vaultPath: string | null;
  currentNotePath: string | null;
  onPersistMarkdown: ((markdown: string) => void) | null;
  onPreviewPdf: ((payload: {
    src: string;
    title: string;
    currentPage: number;
    syncBack: (page: number) => void;
  }) => void) | null;
}

const localPastePluginKey = new PluginKey("carbonLocalPdfPaste");

const markdownSpec = createAtomBlockMarkdownSpec({
  nodeName: "pdf",
  name: "pdf",
  requiredAttributes: ["src"],
  allowedAttributes: ["src", "title"],
});

function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function hasUriScheme(src: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(src);
}

function isLocalPdfSource(src: string): boolean {
  if (!src) return false;
  if (/^https?:\/\//i.test(src)) return false;
  if (hasUriScheme(src) && !isWindowsAbsolutePath(src)) return false;
  return true;
}

function isLocalPdfPathCandidate(src: string): boolean {
  if (!src || !isLocalPdfSource(src) || !isPdfPath(src)) return false;
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

function CarbonPdfNodeView(props: {
  extension: { options: CarbonPdfOptions };
  node: { attrs: Record<string, unknown> };
  selected: boolean;
}) {
  const src = typeof props.node.attrs.src === "string" ? props.node.attrs.src : "";
  const [currentPage, setCurrentPage] = useState(1);
  const title =
    typeof props.node.attrs.title === "string" && props.node.attrs.title.length > 0
      ? props.node.attrs.title
      : getPathLabel(src);

  return (
    <NodeViewWrapper className={`carbon-pdf-node${props.selected ? " ProseMirror-selectednode" : ""}`}>
      <div className="carbon-pdf-frame">
        <PdfDeck
          sourcePath={src}
          currentNotePath={props.extension.options.currentNotePath}
          vaultPath={props.extension.options.vaultPath}
          compact
          compactPage={currentPage}
          onCompactPageChange={setCurrentPage}
          onPreviewRequest={
            src
              ? () => {
                  props.extension.options.onPreviewPdf?.({
                    src,
                    title,
                    currentPage,
                    syncBack: setCurrentPage,
                  });
                }
              : undefined
          }
        />
      </div>
    </NodeViewWrapper>
  );
}

export const CarbonPdf = Node.create<CarbonPdfOptions>({
  name: "pdf",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      uploadEnabled: true,
      vaultPath: null,
      currentNotePath: null,
      onPersistMarkdown: null,
      onPreviewPdf: null,
    } as CarbonPdfOptions;
  },

  addStorage() {
    const extension = this;

    return {
      canInsertAsset(): boolean {
        return Boolean(
          extension.options.uploadEnabled &&
          extension.options.vaultPath &&
          extension.options.currentNotePath,
        );
      },

      async insertPdfAsset(
        editor: any,
        file: File,
        insertPos?: number,
      ): Promise<void> {
        const { uploadEnabled, vaultPath } = extension.options;
        if (!uploadEnabled || !vaultPath) return;

        try {
          const result = await saveFileToVaultAssets({
            file,
            vaultPath,
          });

          const title = file.name || getPathLabel(result.markdownPath);
          const pos = insertPos ?? editor.state.selection.anchor;
          editor
            .chain()
            .focus()
            .insertContentAt(pos, {
              type: "pdf",
              attrs: {
                src: result.markdownPath,
                title,
              },
            })
            .run();

          const markdown = typeof editor.getMarkdown === "function" ? editor.getMarkdown() : "";
          if (markdown) {
            extension.options.onPersistMarkdown?.(markdown);
          }
        } catch (err) {
          console.error("PDF save failed:", err);
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
    };
  },

  parseHTML() {
    return [{ tag: "div[data-carbon-pdf]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-carbon-pdf": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CarbonPdfNodeView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: localPastePluginKey,
        props: {
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;

            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return false;

            const pdfFiles = Array.from(files).filter((file) =>
              file.type === "application/pdf" || isPdfPath(file.name),
            );
            if (pdfFiles.length === 0) return false;
            if (!this.storage.canInsertAsset()) {
              event.preventDefault();
              return true;
            }

            event.preventDefault();
            const dropPos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })?.pos;
            for (const file of pdfFiles) {
              void this.storage.insertPdfAsset(this.editor, file, dropPos);
            }
            return true;
          },
          handlePaste: (view, event) => {
            const files = event.clipboardData?.files;
            if (files && files.length > 0) {
              const pdfFiles = Array.from(files).filter((file) =>
                file.type === "application/pdf" || isPdfPath(file.name),
              );
              if (pdfFiles.length === 0) return false;
              if (!this.storage.canInsertAsset()) {
                event.preventDefault();
                return true;
              }

              event.preventDefault();
              for (const file of pdfFiles) {
                void this.storage.insertPdfAsset(this.editor, file);
              }
              return true;
            }

            const text = event.clipboardData?.getData("text/plain")?.trim();
            if (!text || text.includes("\n")) return false;
            if (!isLocalPdfPathCandidate(text)) return false;

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

  markdownTokenName: "pdf",
  markdownTokenizer: markdownSpec.markdownTokenizer,

  parseMarkdown(token, helpers) {
    const src = typeof token.attributes?.src === "string" ? token.attributes.src : "";
    if (!src) return [];

    return helpers.createNode("pdf", {
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
      type: "pdf",
      attrs: {
        src,
        ...(title ? { title } : {}),
      },
    });

    return `${markdown}\n\n`;
  },
});
