/** A node in the file tree (file or folder). */
export type TreeNode = {
  /** Normalized vault-relative path, used as unique identifier. */
  id: string;
  /** Display name (folder name, or file name; .md extension is hidden). */
  name: string;
  /** Absolute path on disk. */
  path: string;
  kind: "file" | "folder";
  /** Children, only present for folders. Sorted: folders first, then files, alphabetical. */
  children?: TreeNode[];
  /** Whether a folder's direct children have been loaded into memory. */
  loaded?: boolean;
  /** Whether a folder should be refreshed before its children are trusted. */
  dirty?: boolean;
};

export type NoteIndexEntry = {
  id: string;
  name: string;
  path: string;
};

export type NoteViewMode = "visual" | "plaintext";

export type NoteTabStatus = "ready" | "missing";

/** A Markdown note kept open in the workspace tab strip. */
export type OpenNoteTab = {
  /** Stable only for the lifetime of this tab. */
  tabKey: number;
  /** Current vault-relative path. Changes on move/rename. */
  id: string;
  /** Current absolute path on disk. Changes on move/rename. */
  path: string;
  /** File name without .md extension. */
  name: string;
  /** Missing tabs keep their place while external file operations settle. */
  status: NoteTabStatus;
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
  /** Stable identity key. Changes only when a different note is selected, NOT on move/rename. */
  docKey: number;
};
