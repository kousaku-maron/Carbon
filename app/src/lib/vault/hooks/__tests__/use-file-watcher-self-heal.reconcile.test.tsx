import type { Dispatch, SetStateAction } from "react";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../../types";
import {
  advanceResyncWindow,
  createFile,
  createFolder,
  dirEntry,
  fileEntry,
  flattenPaths,
  Harness,
  makeEvent,
  readDirMock,
  setupSelfHealDefaults,
  watchMock,
} from "./use-file-watcher-self-heal.helpers";

describe("use-file-watcher self-heal contract: reconcile", () => {
  beforeEach(() => {
    setupSelfHealDefaults();
  });

  it(
    "rename.to-only should eventually converge to final file-only state (stale tmp removed by directory resync)",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });
        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault") return [fileEntry("CLI-RUNTIME-ARCHITECTURE.md")];
          throw new Error("ENOTDIR");
        });

        let tree: TreeNode[] = [createFile("/vault/CLI-RUNTIME-ARCHITECTURE.md.tmp.1")];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };

        await act(async () => {
          create(<Harness vaultPath="/vault" setTree={setTree} />);
        });

        await act(async () => {
          await callback?.(
            makeEvent(
              { modify: { kind: "rename", mode: "to" } },
              ["/vault/CLI-RUNTIME-ARCHITECTURE.md"],
            ),
          );
        });
        await advanceResyncWindow();

        expect(tree.map((n) => n.path).sort()).toEqual([
          "/vault/CLI-RUNTIME-ARCHITECTURE.md",
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "tmp create + rename.to atomic-write sequence should converge to final file-only state",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });
        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault") return [fileEntry("CLI-RUNTIME-ARCHITECTURE.md")];
          throw new Error("ENOTDIR");
        });

        let tree: TreeNode[] = [];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };

        await act(async () => {
          create(<Harness vaultPath="/vault" setTree={setTree} />);
        });

        await act(async () => {
          await callback?.(
            makeEvent(
              { create: { kind: "any" } },
              ["/vault/CLI-RUNTIME-ARCHITECTURE.md.tmp.1"],
            ),
          );
        });
        await act(async () => {
          await callback?.(
            makeEvent(
              { modify: { kind: "rename", mode: "to" } },
              ["/vault/CLI-RUNTIME-ARCHITECTURE.md"],
            ),
          );
        });
        await advanceResyncWindow();

        expect(tree.map((n) => n.path).sort()).toEqual([
          "/vault/CLI-RUNTIME-ARCHITECTURE.md",
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "reconciliation should not emit duplicate callbacks for stale tmp cleanup",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });
        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") return [fileEntry("CLI-RUNTIME-ARCHITECTURE.md")];
          throw new Error("ENOTDIR");
        });

        const onPathsRemoved = vi.fn();
        const onFileChange = vi.fn(async () => {});
        let tree: TreeNode[] = [
          createFolder("/vault/docs", [createFile("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1")]),
        ];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };

        await act(async () => {
          create(
            <Harness
              vaultPath="/vault"
              setTree={setTree}
              onPathsRemoved={onPathsRemoved}
              onFileChange={onFileChange}
            />,
          );
        });

        await act(async () => {
          await callback?.(
            makeEvent(
              { create: { kind: "any" } },
              ["/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1"],
            ),
          );
        });

        await act(async () => {
          await callback?.(
            makeEvent(
              { modify: { kind: "rename", mode: "to" } },
              ["/vault/docs/CLI-RUNTIME-ARCHITECTURE.md"],
            ),
          );
        });
        await advanceResyncWindow();

        expect(flattenPaths(tree)).not.toContain("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1");
        expect(onPathsRemoved).toHaveBeenCalledTimes(1);
        expect(onPathsRemoved).toHaveBeenCalledWith([
          "/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1",
        ]);
        expect(onFileChange).toHaveBeenCalledTimes(1);
        expect(onFileChange).toHaveBeenCalledWith([
          "/vault/docs/CLI-RUNTIME-ARCHITECTURE.md",
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "markdown reload callback should include markdown paths only",
    async () => {
      let callback: ((event: WatchEvent) => Promise<void>) | null = null;
      watchMock.mockImplementationOnce(async (_path, cb) => {
        callback = cb as (event: WatchEvent) => Promise<void>;
        return vi.fn();
      });

      const onFileChange = vi.fn(async () => {});
      await act(async () => {
        create(
          <Harness
            vaultPath="/vault"
            setTree={vi.fn() as Dispatch<SetStateAction<TreeNode[]>>}
            onFileChange={onFileChange}
          />,
        );
      });

      await act(async () => {
        await callback?.(makeEvent({ modify: { kind: "data", mode: "any" } }, ["/vault/docs/a.txt"]));
      });
      await act(async () => {
        await callback?.(makeEvent({ modify: { kind: "data", mode: "any" } }, ["/vault/docs/a.md"]));
      });

      expect(onFileChange).toHaveBeenCalledTimes(1);
      expect(onFileChange).toHaveBeenCalledWith(["/vault/docs/a.md"]);
    },
  );

  it(
    "external folder delete should remove the stale subtree after impacted-directory resync",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") throw new Error("ENOENT");
          throw new Error("ENOTDIR");
        });

        let tree: TreeNode[] = [
          createFolder("/vault/docs", [createFile("/vault/docs/a.md")]),
          createFolder("/vault/notes", [createFile("/vault/notes/keep.md")]),
        ];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };

        await act(async () => {
          create(<Harness vaultPath="/vault" setTree={setTree} />);
        });

        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/new.md"]));
        });
        await advanceResyncWindow();

        const paths = flattenPaths(tree);
        expect(paths).not.toContain("/vault/docs");
        expect(paths).not.toContain("/vault/docs/a.md");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "external folder rename should reconcile descendants without leaving old subtree orphans",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs-renamed") return [fileEntry("a.md")];
          if (pathArg === "/vault") return [dirEntry("docs-renamed")];
          throw new Error("ENOTDIR");
        });

        let tree: TreeNode[] = [
          createFolder("/vault/docs", [createFile("/vault/docs/a.md")]),
        ];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };

        await act(async () => {
          create(<Harness vaultPath="/vault" setTree={setTree} />);
        });

        await act(async () => {
          await callback?.(
            makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs-renamed"]),
          );
        });
        await advanceResyncWindow();

        const paths = flattenPaths(tree);
        expect(paths).not.toContain("/vault/docs");
        expect(paths).not.toContain("/vault/docs/a.md");
        expect(paths).toContain("/vault/docs-renamed");
        expect(paths).toContain("/vault/docs-renamed/a.md");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "self-heal reconciliation should preserve callback order contract",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });
        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") return [fileEntry("CLI-RUNTIME-ARCHITECTURE.md")];
          throw new Error("ENOTDIR");
        });

        let tree: TreeNode[] = [
          createFolder("/vault/docs", [createFile("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1")]),
        ];
        const order: string[] = [];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          order.push("setTree");
          tree = typeof next === "function" ? next(tree) : next;
        };
        const onPathsRemoved = vi.fn(() => {
          order.push("onPathsRemoved");
        });
        const onFileChange = vi.fn(async () => {
          order.push("onFileChange");
        });

        await act(async () => {
          create(
            <Harness
              vaultPath="/vault"
              setTree={setTree}
              onPathsRemoved={onPathsRemoved}
              onFileChange={onFileChange}
            />,
          );
        });

        await act(async () => {
          await callback?.(
            makeEvent(
              { modify: { kind: "rename", mode: "to" } },
              ["/vault/docs/new.txt"],
            ),
          );
        });
        await advanceResyncWindow();

        expect(flattenPaths(tree)).toContain("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md");
        expect(flattenPaths(tree)).not.toContain("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1");
        expect(onPathsRemoved).toHaveBeenCalledWith(expect.arrayContaining([
          "/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1",
        ]));
        const removedIndex = order.indexOf("onPathsRemoved");
        const changedIndex = order.indexOf("onFileChange");
        expect(removedIndex).toBeGreaterThan(0);
        expect(changedIndex).toBeGreaterThan(removedIndex);
        expect(order[removedIndex - 1]).toBe("setTree");
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
