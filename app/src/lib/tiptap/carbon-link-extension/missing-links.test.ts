import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createMissingLinksPlugin, missingLinksKey } from "./missing-links";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
  marks: { link: { attrs: { href: {} } } },
});

function createState(existing: Set<string>) {
  return EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [
      schema.text("Target", [schema.marks.link.create({ href: "./target.md" })]),
      schema.text(" plain text"),
    ])]),
    plugins: [createMissingLinksPlugin((href) => !existing.has(href))],
  });
}

describe("missing internal link decorations", () => {
  it("updates on deletion and restoration without changing the document", () => {
    const existing = new Set(["./target.md"]);
    let state = createState(existing);
    const originalDoc = state.doc.toJSON();
    expect(missingLinksKey.getState(state)?.find()).toHaveLength(0);

    existing.clear();
    const refresh = state.tr.setMeta(missingLinksKey, true);
    expect(refresh.docChanged).toBe(false);
    state = state.apply(refresh);
    const decorations = missingLinksKey.getState(state)!.find();
    expect(decorations).toHaveLength(1);
    expect(decorations[0].from).toBe(1);
    expect(decorations[0].to).toBe(7);
    expect(state.doc.toJSON()).toEqual(originalDoc);

    existing.add("./target.md");
    state = state.apply(state.tr.setMeta(missingLinksKey, true));
    expect(missingLinksKey.getState(state)?.find()).toHaveLength(0);
    expect(state.doc.toJSON()).toEqual(originalDoc);
  });

  it("removes the decoration when the link is edited to an existing target", () => {
    let state = createState(new Set(["./other.md"]));
    expect(missingLinksKey.getState(state)?.find()).toHaveLength(1);
    state = state.apply(state.tr.addMark(1, 7, schema.marks.link.create({ href: "./other.md" })));
    expect(missingLinksKey.getState(state)?.find()).toHaveLength(0);
  });

  it("reuses decorations for selection-only changes", () => {
    let state = createState(new Set());
    const decorations = missingLinksKey.getState(state);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    expect(missingLinksKey.getState(state)).toBe(decorations);
  });
});
