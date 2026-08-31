import { getMarkRange } from "@tiptap/core";
import { isAllowedUri } from "@tiptap/extension-link";
import type { Mark, MarkType, ResolvedPos } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export type LinkReference = {
  from: number;
  to: number;
  href: string;
  label: string;
};

function findLinkMarkAtPosition(
  $position: ResolvedPos,
  linkType: MarkType,
): Mark | null {
  const after = $position.parent.childAfter($position.parentOffset).node;
  const before = $position.parent.childBefore($position.parentOffset).node;

  return (
    after?.marks.find((mark) => mark.type === linkType) ??
    before?.marks.find((mark) => mark.type === linkType) ??
    null
  );
}

export function getLinkAtPosition(
  state: EditorState,
  position: number,
): LinkReference | null {
  const linkType = state.schema.marks.link;
  if (!linkType || position < 0 || position > state.doc.content.size) return null;

  const $position = state.doc.resolve(position);
  const linkMark = findLinkMarkAtPosition($position, linkType);
  if (!linkMark) return null;

  const range = getMarkRange($position, linkType, linkMark.attrs);
  const href = linkMark.attrs.href;
  if (!range || typeof href !== "string" || !href) return null;

  return {
    ...range,
    href,
    label: state.doc.textBetween(range.from, range.to, "", ""),
  };
}

function resolveLinkReference(
  state: EditorState,
  reference: LinkReference,
): LinkReference | null {
  const positions = [
    reference.from,
    Math.min(reference.from + 1, state.doc.content.size),
    Math.min(reference.to, state.doc.content.size),
  ];

  for (const position of positions) {
    const link = getLinkAtPosition(state, position);
    if (link?.href === reference.href) return link;
  }

  return null;
}

export function isEditableLinkHref(href: string): boolean {
  return Boolean(href.trim() && isAllowedUri(href.trim()));
}

export function createLinkEditTransaction(
  state: EditorState,
  reference: LinkReference,
  hrefInput: string,
  labelInput: string,
): Transaction | null {
  const activeLink = resolveLinkReference(state, reference);
  const href = hrefInput.trim();
  if (!activeLink || !isEditableLinkHref(href)) return null;

  const linkType = state.schema.marks.link;
  const $position = state.doc.resolve(activeLink.from);
  const linkMark = findLinkMarkAtPosition($position, linkType);
  if (!linkMark) return null;

  const label = labelInput.trim() || href;
  const updatedLinkMark = linkType.create({ ...linkMark.attrs, href });
  const transaction = state.tr;

  if (label !== activeLink.label) {
    const preservedMarks = linkMark
      .removeFromSet($position.nodeAfter?.marks ?? [])
      .filter((mark) => mark.type !== linkType);
    transaction.replaceWith(
      activeLink.from,
      activeLink.to,
      state.schema.text(label, [...preservedMarks, updatedLinkMark]),
    );
  } else if (href !== activeLink.href) {
    transaction
      .removeMark(activeLink.from, activeLink.to, linkType)
      .addMark(activeLink.from, activeLink.to, updatedLinkMark);
  }

  return transaction.docChanged ? transaction : null;
}

export function createRemoveLinkTransaction(
  state: EditorState,
  reference: LinkReference,
): Transaction | null {
  const activeLink = resolveLinkReference(state, reference);
  const linkType = state.schema.marks.link;
  if (!activeLink || !linkType) return null;

  return state.tr.removeMark(activeLink.from, activeLink.to, linkType);
}
