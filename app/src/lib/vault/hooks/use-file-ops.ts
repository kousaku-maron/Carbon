import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { mkdir, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { writeNote } from "../modules/note-persistence";
import { findNodeByPath } from "../../link-utils";
import {
  getBaseName,
  getParentPath,
  hasInvalidNodeName,
  joinPath,
} from "../../path-utils";
import type { TreeNode } from "../../types";
import { addToTree, relocateInTree, removeFromTree } from "../modules/note-index";

function validateNodeName(raw: string): string {
  const name = raw.trim();
  if (!name) return "Name cannot be empty";
  if (hasInvalidNodeName(name)) {
    return "Name cannot contain path separators or '..'";
  }
  return "";
}

interface UseFileOpsOptions {
  vaultPath: string | null;
  tree: TreeNode[];
  setTree: Dispatch<SetStateAction<TreeNode[]>>;
  onSelectNote?: (node: TreeNode) => Promise<void>;
  onPathsRemoved?: (removedPaths: string[]) => void;
  onPathsMoved?: (moves: Array<{ from: string; to: string }>) => void;
  onError?: (msg: string) => void;
}

export function useFileOps({
  vaultPath,
  tree,
  setTree,
  onSelectNote,
  onPathsRemoved,
  onPathsMoved,
  onError,
}: UseFileOpsOptions) {
  const handleSaveNote = useCallback(
    async (path: string, content: string) => {
      try {
        await writeNote(path, content);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Failed to save note");
        throw err;
      }
    },
    [onError],
  );

  const handleCreateFile = useCallback(
    async (parentDir: string, rawName: string) => {
      const stripped = rawName.trim().replace(/\.md$/i, "");
      const validation = validateNodeName(stripped);
      if (validation) {
        onError?.(validation);
        return;
      }
      try {
        const filePath = joinPath(parentDir, `${stripped}.md`);
        await writeTextFile(filePath, "");
        if (vaultPath) {
          setTree((prev) => addToTree(prev, filePath, vaultPath, "file"));
        }
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Failed to create file");
      }
    },
    [vaultPath, onError, setTree],
  );

  const handleCreateFolder = useCallback(
    async (parentDir: string, rawName: string) => {
      const name = rawName.trim();
      const validation = validateNodeName(name);
      if (validation) {
        onError?.(validation);
        return;
      }
      try {
        const folderPath = joinPath(parentDir, name);
        await mkdir(folderPath);
        if (vaultPath) {
          setTree((prev) => addToTree(prev, folderPath, vaultPath, "folder"));
        }
      } catch (err) {
        onError?.(
          err instanceof Error ? err.message : "Failed to create folder",
        );
      }
    },
    [vaultPath, onError, setTree],
  );

  const handleRename = useCallback(
    async (oldPath: string, rawName: string) => {
      const parentDir = getParentPath(oldPath);
      const currentBaseName = getBaseName(oldPath);
      const isMarkdown = /\.md$/i.test(currentBaseName);
      const stripped = isMarkdown
        ? rawName.trim().replace(/\.md$/i, "")
        : rawName.trim();
      const validation = validateNodeName(stripped);
      if (validation) {
        onError?.(validation);
        return;
      }
      try {
        const newPath = joinPath(
          parentDir,
          `${stripped}${isMarkdown ? ".md" : ""}`,
        );
        await rename(oldPath, newPath);
        if (vaultPath) {
          setTree((prev) => relocateInTree(prev, oldPath, newPath, vaultPath));
        }
        onPathsMoved?.([{ from: oldPath, to: newPath }]);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Failed to rename");
      }
    },
    [vaultPath, onError, onPathsMoved, setTree],
  );

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      const label = node.kind === "folder" ? "folder" : "file";
      if (!confirm(`Delete ${label} "${node.name}"?`)) return;
      try {
        await remove(node.path, { recursive: node.kind === "folder" });
        setTree((prev) => removeFromTree(prev, node.path));
        onPathsRemoved?.([node.path]);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Failed to delete");
      }
    },
    [onError, onPathsRemoved, setTree],
  );

  const handleMove = useCallback(
    async (sourcePath: string, targetFolderPath: string) => {
      try {
        const fileName = getBaseName(sourcePath);
        const newPath = joinPath(targetFolderPath, fileName);
        if (sourcePath === newPath) return;
        await rename(sourcePath, newPath);
        if (vaultPath) {
          setTree((prev) => relocateInTree(prev, sourcePath, newPath, vaultPath));
        }
        onPathsMoved?.([{ from: sourcePath, to: newPath }]);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Failed to move");
      }
    },
    [onError, onPathsMoved, setTree, vaultPath],
  );

  const handleNavigateToNote = useCallback(
    async (absolutePath: string) => {
      const node = findNodeByPath(tree, absolutePath);
      if (!node) {
        onError?.("Link target not found");
        return;
      }
      if (!onSelectNote) {
        onError?.("Failed to open note");
        return;
      }
      await onSelectNote(node);
    },
    [tree, onSelectNote, onError],
  );

  return {
    handleSaveNote,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleDelete,
    handleMove,
    handleNavigateToNote,
  } as const;
}
