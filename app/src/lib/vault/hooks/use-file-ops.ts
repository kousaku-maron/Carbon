import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import { mkdir, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { readNote, writeNote } from "../modules/note-persistence";
import { findNodeByPath } from "../../link-utils";
import {
  getBaseName,
  getParentPath,
  hasInvalidNodeName,
  isPathInside,
  joinPath,
  pathsEqual,
  toVaultRelative,
} from "../../path-utils";
import type { NoteContent, TreeNode } from "../../types";
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
  activeNote: NoteContent | null;
  setTree: Dispatch<SetStateAction<TreeNode[]>>;
  setActiveNote: Dispatch<SetStateAction<NoteContent | null>>;
  onError?: (msg: string) => void;
}

export function useFileOps({
  vaultPath,
  tree,
  activeNote,
  setTree,
  setActiveNote,
  onError,
}: UseFileOpsOptions) {
  const docKeyCounter = useRef(0);

  const handleSelectNote = useCallback(
    async (node: TreeNode) => {
      if (node.kind !== "file") return;
      try {
        const body = await readNote(node.path);
        setActiveNote({
          id: node.id,
          path: node.path,
          name: node.name,
          body,
          docKey: docKeyCounter.current,
        });
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Failed to read note");
      }
    },
    [onError, setActiveNote],
  );

  const handleSaveNote = useCallback(
    async (path: string, content: string) => {
      try {
        await writeNote(path, content);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Failed to save note");
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
        if (activeNote && isPathInside(activeNote.path, oldPath)) {
          const suffix = activeNote.path.substring(oldPath.length);
          const updatedPath = newPath + suffix;
          setActiveNote({
            ...activeNote,
            path: updatedPath,
            name: pathsEqual(activeNote.path, oldPath)
              ? stripped
              : activeNote.name,
            id: vaultPath
              ? toVaultRelative(updatedPath, vaultPath)
              : activeNote.id,
          });
        }
        if (vaultPath) {
          setTree((prev) => relocateInTree(prev, oldPath, newPath, vaultPath));
        }
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Failed to rename");
      }
    },
    [vaultPath, activeNote?.path, activeNote?.name, onError, setActiveNote, setTree],
  );

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      const label = node.kind === "folder" ? "folder" : "file";
      if (!confirm(`Delete ${label} "${node.name}"?`)) return;
      try {
        await remove(node.path, { recursive: node.kind === "folder" });
        if (activeNote && isPathInside(activeNote.path, node.path)) {
          setActiveNote(null);
        }
        setTree((prev) => removeFromTree(prev, node.path));
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Failed to delete");
      }
    },
    [activeNote, setActiveNote, setTree],
  );

  const handleMove = useCallback(
    async (sourcePath: string, targetFolderPath: string) => {
      try {
        const fileName = getBaseName(sourcePath);
        const newPath = joinPath(targetFolderPath, fileName);
        if (sourcePath === newPath) return;
        await rename(sourcePath, newPath);
        if (activeNote && isPathInside(activeNote.path, sourcePath)) {
          const suffix = activeNote.path.substring(sourcePath.length);
          const updatedPath = newPath + suffix;
          setActiveNote({
            ...activeNote,
            path: updatedPath,
            id: vaultPath
              ? toVaultRelative(updatedPath, vaultPath)
              : activeNote.id,
          });
        }
        if (vaultPath) {
          setTree((prev) => relocateInTree(prev, sourcePath, newPath, vaultPath));
        }
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Failed to move");
      }
    },
    [activeNote, vaultPath, setActiveNote, onError, setTree],
  );

  const handleNavigateToNote = useCallback(
    async (absolutePath: string) => {
      const node = findNodeByPath(tree, absolutePath);
      if (!node) {
        onError?.("Link target not found");
        return;
      }
      await handleSelectNote(node);
    },
    [tree, handleSelectNote, onError],
  );

  return {
    handleSelectNote,
    handleSaveNote,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleDelete,
    handleMove,
    handleNavigateToNote,
  } as const;
}
