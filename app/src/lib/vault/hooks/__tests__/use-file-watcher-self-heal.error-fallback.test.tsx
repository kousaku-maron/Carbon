import type { Dispatch, SetStateAction } from "react";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../../types";
import {
  advanceResyncWindow,
  createFile,
  createFolder,
  fileEntry,
  flattenPaths,
  Harness,
  makeEvent,
  readDirMock,
  setupSelfHealDefaults,
  watchMock,
} from "./use-file-watcher-self-heal.helpers";

describe("use-file-watcher self-heal contract: error fallback", () => {
  beforeEach(() => {
    setupSelfHealDefaults();
  });

  it(
    "directory resync failure should report onError and keep tree unchanged until a successful retry",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") throw new Error("EACCES");
          throw new Error("ENOTDIR");
        });

        let tree: TreeNode[] = [
          createFolder("/vault/docs", [createFile("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1")]),
          createFolder("/vault/notes", [createFile("/vault/notes/keep.md")]),
        ];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };
        const onError = vi.fn();

        await act(async () => {
          create(<Harness vaultPath="/vault" setTree={setTree} onError={onError} />);
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

        expect(onError).toHaveBeenCalled();
        const paths = flattenPaths(tree);
        expect(paths).toContain("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "resync should recover after transient failure and reconcile stale tmp nodes",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        let docsReadCount = 0;
        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") {
            docsReadCount += 1;
            if (docsReadCount === 1) throw new Error("EIO");
            return [fileEntry("CLI-RUNTIME-ARCHITECTURE.md")];
          }
          throw new Error("ENOTDIR");
        });

        let tree: TreeNode[] = [
          createFolder("/vault/docs", [createFile("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1")]),
        ];
        const setTree: Dispatch<SetStateAction<TreeNode[]>> = (next) => {
          tree = typeof next === "function" ? next(tree) : next;
        };
        const onError = vi.fn();

        await act(async () => {
          create(<Harness vaultPath="/vault" setTree={setTree} onError={onError} />);
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
        await act(async () => {
          await callback?.(
            makeEvent(
              { modify: { kind: "rename", mode: "to" } },
              ["/vault/docs/CLI-RUNTIME-ARCHITECTURE.md"],
            ),
          );
        });
        await advanceResyncWindow();

        expect(onError).toHaveBeenCalledTimes(1);
        const paths = flattenPaths(tree);
        expect(paths).toContain("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md");
        expect(paths).not.toContain("/vault/docs/CLI-RUNTIME-ARCHITECTURE.md.tmp.1");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "repeated resync failures should trigger a full-vault fallback scan after threshold",
    async () => {
      vi.useFakeTimers();
      try {
        let callback: ((event: WatchEvent) => Promise<void>) | null = null;
        watchMock.mockImplementationOnce(async (_path, cb) => {
          callback = cb as (event: WatchEvent) => Promise<void>;
          return vi.fn();
        });

        readDirMock.mockImplementation(async (pathArg) => {
          if (pathArg === "/vault/docs") throw new Error("EACCES");
          if (pathArg === "/vault") return [];
          throw new Error("ENOTDIR");
        });

        const onError = vi.fn();
        await act(async () => {
          create(
            <Harness
              vaultPath="/vault"
              setTree={vi.fn() as Dispatch<SetStateAction<TreeNode[]>>}
              onError={onError}
            />,
          );
        });

        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/a.md"]));
        });
        await advanceResyncWindow();
        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/b.md"]));
        });
        await advanceResyncWindow();
        await act(async () => {
          await callback?.(makeEvent({ modify: { kind: "rename", mode: "to" } }, ["/vault/docs/c.md"]));
        });
        await advanceResyncWindow();
        await advanceResyncWindow();

        const fallbackReads = readDirMock.mock.calls.filter(([p]) => p === "/vault").length;
        expect(onError).toHaveBeenCalled();
        expect(fallbackReads).toBeGreaterThan(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

});
