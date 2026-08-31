import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
  createLinkEditTransaction,
  createRemoveLinkTransaction,
  getLinkAtPosition,
  isEditableLinkHref,
} from "../tiptap/carbon-link-extension/link-editing";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
    },
  },
});

function createLinkState(options?: {
  href?: string;
  label?: string;
  bold?: boolean;
}) {
  const href = options?.href ?? "https://example.com/original";
  const label = options?.label ?? "Original label";
  const prefix = "Before ";
  const link = schema.marks.link.create({ href, title: "Original title attr" });
  const marks = options?.bold ? [schema.marks.bold.create(), link] : [link];
  const paragraph = schema.nodes.paragraph.create(null, [
    schema.text(prefix),
    schema.text(label, marks),
    schema.text(" after"),
  ]);
  const doc = schema.nodes.doc.create(null, paragraph);
  const from = 1 + prefix.length;
  const to = from + label.length;
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from + 1),
  });

  return { state, from, to, href, label };
}

describe("link editing", () => {
  it("finds the complete link range from a position inside the link", () => {
    const { state, from, to, href, label } = createLinkState();

    expect(getLinkAtPosition(state, from + 2)).toEqual({
      from,
      to,
      href,
      label,
    });
    expect(getLinkAtPosition(state, to + 1)).toBeNull();
  });

  it("updates the href without changing the visible label", () => {
    const { state, from } = createLinkState();
    const reference = getLinkAtPosition(state, from);
    expect(reference).not.toBeNull();

    const transaction = createLinkEditTransaction(
      state,
      reference!,
      "https://example.com/updated",
      reference!.label,
    );
    const nextState = state.apply(transaction!);
    const updated = getLinkAtPosition(nextState, from);

    expect(updated?.href).toBe("https://example.com/updated");
    expect(updated?.label).toBe("Original label");
  });

  it("updates the visible label while preserving other text marks", () => {
    const { state, from } = createLinkState({ bold: true });
    const reference = getLinkAtPosition(state, from)!;
    const transaction = createLinkEditTransaction(
      state,
      reference,
      reference.href,
      "Renamed link",
    );
    const nextState = state.apply(transaction!);
    const textNode = nextState.doc.nodeAt(from);

    expect(getLinkAtPosition(nextState, from)?.label).toBe("Renamed link");
    expect(textNode?.marks.some((mark) => mark.type === schema.marks.bold)).toBe(
      true,
    );
    expect(
      textNode?.marks.find((mark) => mark.type === schema.marks.link)?.attrs,
    ).toMatchObject({
      href: reference.href,
      title: "Original title attr",
    });
  });

  it("falls back to the href when the edited label is empty", () => {
    const { state, from } = createLinkState();
    const reference = getLinkAtPosition(state, from)!;
    const transaction = createLinkEditTransaction(
      state,
      reference,
      "https://example.com/fallback",
      "   ",
    );
    const nextState = state.apply(transaction!);

    expect(getLinkAtPosition(nextState, from)?.label).toBe(
      "https://example.com/fallback",
    );
  });

  it("removes only the link mark", () => {
    const { state, from, label } = createLinkState({ bold: true });
    const reference = getLinkAtPosition(state, from)!;
    const transaction = createRemoveLinkTransaction(state, reference);
    const nextState = state.apply(transaction!);
    const textNode = nextState.doc.nodeAt(from);

    expect(nextState.doc.textContent).toContain(label);
    expect(getLinkAtPosition(nextState, from)).toBeNull();
    expect(textNode?.marks.some((mark) => mark.type === schema.marks.bold)).toBe(
      true,
    );
  });

  it("rejects unsafe hrefs while accepting web and relative links", () => {
    expect(isEditableLinkHref("https://example.com")).toBe(true);
    expect(isEditableLinkHref("../another-note.md")).toBe(true);
    expect(isEditableLinkHref("javascript:alert(1)")).toBe(false);
  });
});
