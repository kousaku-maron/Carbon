import { Schema, Slice } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { describe, expect, it, vi } from "vitest";
import {
  createExternalTitlePastePlugin,
  getPastedHttpUrl,
} from "../tiptap/carbon-link-extension/external-title-paste";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    link: {
      attrs: { href: {} },
      inclusive: false,
    },
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness(
  resolver: (href: string) => Promise<string | null>,
  initialText = "",
) {
  const plugin = createExternalTitlePastePlugin(resolver);
  const paragraph = initialText
    ? schema.nodes.paragraph.create(null, schema.text(initialText))
    : schema.nodes.paragraph.create();
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, paragraph),
    plugins: [plugin],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = state.apply(transaction);
    },
    isDestroyed: false,
  } as unknown as EditorView;

  const paste = (text: string) => {
    const preventDefault = vi.fn();
    const event = {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? text : ""),
      },
      preventDefault,
    } as unknown as ClipboardEvent;
    const handled = plugin.props.handlePaste?.call(
      plugin,
      view,
      event,
      Slice.empty,
    );
    return { handled, preventDefault };
  };

  return {
    view,
    paste,
    setSelection(from: number, to = from) {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)),
      );
    },
  };
}

async function flushTitleResolution<T>(
  request: ReturnType<typeof deferred<T>>,
  value: T,
) {
  await Promise.resolve();
  request.resolve(value);
  await request.promise;
  await Promise.resolve();
}

describe("getPastedHttpUrl", () => {
  it("accepts only standalone HTTP and HTTPS URLs", () => {
    expect(getPastedHttpUrl("https://example.com/page?q=1")).toBe(
      "https://example.com/page?q=1",
    );
    expect(getPastedHttpUrl("  http://example.com  ")).toBe("http://example.com");
    expect(getPastedHttpUrl("mailto:hello@example.com")).toBeNull();
    expect(getPastedHttpUrl("https://example.com one")).toBeNull();
    expect(getPastedHttpUrl("example.com")).toBeNull();
  });
});

describe("external title paste plugin", () => {
  it("inserts the URL immediately, then replaces its label with the page title", async () => {
    const request = deferred<string | null>();
    const resolver = vi.fn(() => request.promise);
    const harness = createHarness(resolver);

    const result = harness.paste("https://example.com/article");

    expect(result.handled).toBe(true);
    expect(result.preventDefault).toHaveBeenCalledOnce();
    expect(harness.view.state.doc.textContent).toBe("https://example.com/article");
    expect(resolver).not.toHaveBeenCalled();

    await flushTitleResolution(request, "  Example   Article  ");

    expect(resolver).toHaveBeenCalledWith("https://example.com/article");
    expect(harness.view.state.doc.textContent).toBe("Example Article");
    expect(
      harness.view.state.doc.firstChild?.firstChild?.marks[0]?.attrs.href,
    ).toBe("https://example.com/article");
  });

  it("tracks the pasted link when text is inserted before it", async () => {
    const request = deferred<string | null>();
    const harness = createHarness(() => request.promise);

    harness.paste("https://example.com");
    harness.view.dispatch(harness.view.state.tr.insertText("Before ", 1));
    await flushTitleResolution(request, "Example");

    expect(harness.view.state.doc.textContent).toBe("Before Example");
  });

  it("does not overwrite a pasted URL that the user edited while loading", async () => {
    const request = deferred<string | null>();
    const harness = createHarness(() => request.promise);

    harness.paste("https://example.com");
    harness.view.dispatch(harness.view.state.tr.insertText("edited-", 9));
    const editedText = harness.view.state.doc.textContent;
    await flushTitleResolution(request, "Example");

    expect(harness.view.state.doc.textContent).toBe(editedText);
  });

  it("keeps the URL label when title resolution fails", async () => {
    const request = deferred<string | null>();
    const harness = createHarness(() => request.promise);

    harness.paste("https://example.com");
    await flushTitleResolution(request, null);

    expect(harness.view.state.doc.textContent).toBe("https://example.com");
  });

  it("leaves non-empty selections to the existing link-on-paste behavior", () => {
    const resolver = vi.fn(async () => "Example");
    const harness = createHarness(resolver, "selected label");
    harness.setSelection(1, "selected label".length + 1);

    const result = harness.paste("https://example.com");

    expect(result.handled).toBe(false);
    expect(result.preventDefault).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    expect(harness.view.state.doc.textContent).toBe("selected label");
  });
});
