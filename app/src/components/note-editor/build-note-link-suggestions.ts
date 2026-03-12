import { flattenTreeNodes, getRelativePath } from "../../lib/link-utils";
import type { TreeNode } from "../../lib/types";
import type { NoteLinkSuggestionItem } from "../../lib/tiptap/carbon-link-extension";

export function buildNoteLinkSuggestions(
  tree: TreeNode[],
  currentPath: string,
  query: string,
): NoteLinkSuggestionItem[] {
  const lower = query.toLowerCase();

  return flattenTreeNodes(tree)
    .filter((file) => file.path !== currentPath)
    .filter((file) => /\.md$/i.test(file.path))
    .filter(
      (file) =>
        !query ||
        file.name.toLowerCase().includes(lower) ||
        file.id.toLowerCase().includes(lower),
    )
    .slice(0, 20)
    .map((file) => ({
      id: file.id,
      name: file.name,
      path: file.path,
      relativePath: getRelativePath(currentPath, file.path),
    }));
}
