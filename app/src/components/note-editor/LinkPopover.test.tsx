import type { Editor } from "@tiptap/core";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { LinkPopover } from "./LinkPopover";

describe("LinkPopover", () => {
  it("does not access the Tiptap view while the editor root is mounting", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const editorRoot = {
      addEventListener,
      removeEventListener,
      contains: vi.fn(() => false),
    } as unknown as HTMLDivElement;
    const editor = {
      get view() {
        throw new Error("editor view is not mounted");
      },
    } as unknown as Editor;
    let renderer: ReactTestRenderer | null = null;

    expect(() => {
      act(() => {
        renderer = create(
          <LinkPopover
            editor={editor}
            editorRootRef={{ current: editorRoot }}
          />,
        );
      });
    }).not.toThrow();

    expect(addEventListener).toHaveBeenCalledWith(
      "pointerover",
      expect.any(Function),
    );
    expect(addEventListener).toHaveBeenCalledWith(
      "pointerout",
      expect.any(Function),
    );

    act(() => renderer?.unmount());
    expect(removeEventListener).toHaveBeenCalledTimes(2);
  });
});
