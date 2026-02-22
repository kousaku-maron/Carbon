/** A node in the file tree (file or folder). */
export type TreeNode = {
  /** Normalized vault-relative path, used as unique identifier. */
  id: string;
  /** Display name (file name without extension, or folder name). */
  name: string;
  /** Absolute path on disk. */
  path: string;
  kind: "file" | "folder";
  /** Children, only present for folders. Sorted: folders first, then files, alphabetical. */
  children?: TreeNode[];
};

/** Represents the currently active note. */
export type NoteContent = {
  /** Vault-relative path. */
  id: string;
  /** Absolute path. */
  path: string;
  /** File name without .md extension. */
  name: string;
  /** Raw Markdown content. */
  body: string;
};
