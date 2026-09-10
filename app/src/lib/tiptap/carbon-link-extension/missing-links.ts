import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const missingLinksKey = new PluginKey<DecorationSet>("carbonMissingLinks");

/** Decorations keep link availability out of the document and undo history. */
export function createMissingLinksPlugin(isMissing: (href: string) => boolean) {
  function decorate(doc: Node): DecorationSet {
    const decorations: Decoration[] = [];
    const missingByHref = new Map<string, boolean>();
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const href = node.marks.find((mark) => mark.type.name === "link")?.attrs.href;
      if (typeof href !== "string") return;
      if (!missingByHref.has(href)) missingByHref.set(href, isMissing(href));
      if (missingByHref.get(href)) {
        decorations.push(Decoration.inline(pos, pos + node.nodeSize, {
          class: "carbon-link--missing",
          title: "Link target not found",
        }));
      }
    });
    return DecorationSet.create(doc, decorations);
  }

  return new Plugin<DecorationSet>({
    key: missingLinksKey,
    state: {
      init: (_, state) => decorate(state.doc),
      apply: (transaction, previous) =>
        transaction.docChanged || transaction.getMeta(missingLinksKey)
          ? decorate(transaction.doc)
          : previous,
    },
    props: {
      decorations: (state) => missingLinksKey.getState(state),
    },
  });
}
