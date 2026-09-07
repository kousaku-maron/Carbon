import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../modules/note-persistence", () => ({
  readNote: vi.fn(),
}));

import { readNote } from "../../modules/note-persistence";
import { useActiveNoteSync } from "../use-active-note-sync";

const readNoteMock = vi.mocked(readNote);
type ActiveNoteSync = ReturnType<typeof useActiveNoteSync>;

function Harness({ onValue }: { onValue: (value: ActiveNoteSync) => void }) {
  const value = useActiveNoteSync({ vaultPath: "/vault" });
  onValue(value);
  return null;
}

async function mountSync(): Promise<{
  getValue: () => ActiveNoteSync;
  renderer: ReactTestRenderer;
}> {
  let current: ActiveNoteSync | null = null;
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Harness onValue={(value) => { current = value; }} />);
  });
  return {
    getValue: () => {
      if (!current) throw new Error("hook value unavailable");
      return current;
    },
    renderer: renderer!,
  };
}

describe("useActiveNoteSync file lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readNoteMock.mockResolvedValue("initial");
  });

  it("redirects a delayed Auto Save to the path produced by a move", async () => {
    const { getValue, renderer } = await mountSync();
    await act(async () => {
      await getValue().handleSelectNote({
        id: "old.md",
        path: "/vault/old.md",
        name: "old",
        kind: "file",
      });
    });
    act(() => {
      getValue().handleEditorBufferChange("/vault/old.md", "updated");
      getValue().onPathsUnavailable(["/vault/old.md"]);
      getValue().onPathsMoved([{ from: "/vault/old.md", to: "/vault/new.md" }]);
    });
    expect(getValue().activeNote?.body).toBe("updated");

    const save = vi.fn(async () => {});
    await act(async () => {
      await getValue().handleSaveWithGuards("/vault/old.md", "updated", save);
    });

    expect(save).toHaveBeenCalledWith("/vault/new.md", "updated");
    expect(getValue().getActiveNoteSnapshot()?.path).toBe("/vault/new.md");
    renderer.unmount();
  });

  it("finishes opening from the destination when the file moves during the read", async () => {
    let rejectInitialRead: (reason?: unknown) => void = () => {};
    readNoteMock
      .mockImplementationOnce(() => new Promise<string>((_resolve, reject) => {
        rejectInitialRead = reject;
      }))
      .mockResolvedValueOnce("moved body");

    const { getValue, renderer } = await mountSync();
    let selection: Promise<Awaited<ReturnType<ActiveNoteSync["handleSelectNote"]>>>;
    act(() => {
      selection = getValue().handleSelectNote({
        id: "old.md",
        path: "/vault/old.md",
        name: "old",
        kind: "file",
      });
      getValue().onPathsMoved([{ from: "/vault/old.md", to: "/vault/new.md" }]);
    });

    await act(async () => {
      rejectInitialRead(new Error("ENOENT"));
      const loaded = await selection!;
      expect(loaded?.path).toBe("/vault/new.md");
      expect(loaded?.id).toBe("new.md");
      expect(loaded?.name).toBe("new");
    });

    expect(readNoteMock).toHaveBeenNthCalledWith(1, "/vault/old.md");
    expect(readNoteMock).toHaveBeenNthCalledWith(2, "/vault/new.md");
    renderer.unmount();
  });

  it("does not finish opening when the file disappears during the read", async () => {
    let resolveRead: (body: string) => void = () => {};
    readNoteMock.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveRead = resolve;
    }));

    const { getValue, renderer } = await mountSync();
    let selection: Promise<Awaited<ReturnType<ActiveNoteSync["handleSelectNote"]>>>;
    act(() => {
      selection = getValue().handleSelectNote({
        id: "note.md",
        path: "/vault/note.md",
        name: "note",
        kind: "file",
      });
      getValue().onPathsRemoved(["/vault/note.md"]);
    });

    await act(async () => {
      resolveRead("last readable body");
      expect(await selection!).toBeNull();
    });
    expect(getValue().activeNote).toBeNull();
    renderer.unmount();
  });

  it("keeps the buffer and pauses Auto Save while the file is missing", async () => {
    const { getValue, renderer } = await mountSync();
    await act(async () => {
      await getValue().handleSelectNote({
        id: "note.md",
        path: "/vault/note.md",
        name: "note",
        kind: "file",
      });
    });
    act(() => {
      getValue().handleEditorBufferChange("/vault/note.md", "in-memory edit");
      getValue().onPathsRemoved(["/vault/note.md"]);
    });

    const save = vi.fn(async () => {});
    await act(async () => {
      await getValue().handleSaveWithGuards("/vault/note.md", "in-memory edit", save);
    });

    expect(save).not.toHaveBeenCalled();
    expect(getValue().getActiveNoteSnapshot()?.body).toBe("in-memory edit");

    act(() => {
      getValue().onPathsAvailable(["/vault/note.md"]);
    });
    await act(async () => {
      await getValue().handleSaveWithGuards("/vault/note.md", "in-memory edit", save);
    });
    expect(save).toHaveBeenCalledWith("/vault/note.md", "in-memory edit");
    renderer.unmount();
  });
});
