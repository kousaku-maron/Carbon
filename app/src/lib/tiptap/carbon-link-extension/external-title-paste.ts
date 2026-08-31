import type { MarkType, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export type ExternalTitleResolver = (href: string) => Promise<string | null>;

type PendingTitlePaste = {
  id: number;
  from: number;
  to: number;
  href: string;
};

type PendingTitlePasteState = Map<number, PendingTitlePaste>;

type PendingTitlePasteMeta =
  | { type: "track"; pending: PendingTitlePaste }
  | { type: "finish"; id: number };

let nextPendingTitlePasteId = 0;

const externalTitlePasteKey = new PluginKey<PendingTitlePasteState>(
  "carbonExternalTitlePaste",
);

export function getPastedHttpUrl(text: string): string | null {
  const href = text.trim();
  if (!href || /\s/.test(href)) return null;

  try {
    const url = new URL(href);
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) return null;
    if (!url.hostname) return null;
    return href;
  } catch {
    return null;
  }
}

function normalizeResolvedTitle(title: string | null): string | null {
  if (!title) return null;
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function mapPendingTitlePastes(
  transaction: Transaction,
  pendingById: PendingTitlePasteState,
): PendingTitlePasteState {
  const mapped = new Map<number, PendingTitlePaste>();

  for (const pending of pendingById.values()) {
    const from = transaction.mapping.map(pending.from, 1);
    const to = transaction.mapping.map(pending.to, -1);
    if (from < to) {
      mapped.set(pending.id, { ...pending, from, to });
    }
  }

  const meta = transaction.getMeta(externalTitlePasteKey) as
    | PendingTitlePasteMeta
    | undefined;
  if (meta?.type === "track") {
    mapped.set(meta.pending.id, meta.pending);
  } else if (meta?.type === "finish") {
    mapped.delete(meta.id);
  }

  return mapped;
}

function rangeStillMatchesLink(
  doc: ProseMirrorNode,
  pending: PendingTitlePaste,
  linkType: MarkType,
): boolean {
  if (doc.textBetween(pending.from, pending.to) !== pending.href) return false;

  let coveredCharacters = 0;
  let marksMatch = true;
  doc.nodesBetween(pending.from, pending.to, (node, position) => {
    if (!node.isText) return;

    const overlapFrom = Math.max(pending.from, position);
    const overlapTo = Math.min(pending.to, position + node.nodeSize);
    if (overlapFrom >= overlapTo) return;

    coveredCharacters += overlapTo - overlapFrom;
    const link = linkType.isInSet(node.marks);
    if (link?.attrs.href !== pending.href) {
      marksMatch = false;
    }
  });

  return marksMatch && coveredCharacters === pending.to - pending.from;
}

function finishTitleResolution(
  view: EditorView,
  id: number,
  resolvedTitle: string | null,
) {
  if (view.isDestroyed) return;

  const pending = externalTitlePasteKey.getState(view.state)?.get(id);
  if (!pending) return;

  const title = normalizeResolvedTitle(resolvedTitle);
  const linkType = view.state.schema.marks.link;
  const transaction = view.state.tr.setMeta(externalTitlePasteKey, {
    type: "finish",
    id,
  } satisfies PendingTitlePasteMeta);

  if (
    title &&
    title !== pending.href &&
    linkType &&
    rangeStillMatchesLink(view.state.doc, pending, linkType)
  ) {
    transaction
      .replaceWith(
        pending.from,
        pending.to,
        view.state.schema.text(title, [linkType.create({ href: pending.href })]),
      )
      .setMeta("addToHistory", false);
  }

  view.dispatch(transaction);
}

export function createExternalTitlePastePlugin(
  resolveTitle: ExternalTitleResolver,
): Plugin<PendingTitlePasteState> {
  return new Plugin<PendingTitlePasteState>({
    key: externalTitlePasteKey,
    state: {
      init: () => new Map(),
      apply: mapPendingTitlePastes,
    },
    props: {
      handlePaste: (view, event) => {
        if (!view.state.selection.empty) return false;

        const href = getPastedHttpUrl(
          event.clipboardData?.getData("text/plain") ?? "",
        );
        if (!href) return false;

        const linkType = view.state.schema.marks.link;
        if (
          !linkType ||
          !view.state.selection.$from.parent.type.allowsMarkType(linkType)
        ) {
          return false;
        }

        event.preventDefault();
        const id = ++nextPendingTitlePasteId;
        const from = view.state.selection.from;
        const pending: PendingTitlePaste = {
          id,
          from,
          to: from + href.length,
          href,
        };
        const link = linkType.create({ href });
        const transaction = view.state.tr
          .replaceSelectionWith(view.state.schema.text(href, [link]), false)
          .setMeta(externalTitlePasteKey, {
            type: "track",
            pending,
          } satisfies PendingTitlePasteMeta);
        view.dispatch(transaction);

        void Promise.resolve()
          .then(() => resolveTitle(href))
          .then(
            (title) => finishTitleResolution(view, id, title),
            () => finishTitleResolution(view, id, null),
          );
        return true;
      },
    },
  });
}
