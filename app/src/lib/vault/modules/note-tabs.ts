import type { OpenNoteTab, TreeNode } from "../../types";
import {
  getBaseName,
  isPathInside,
  pathsEqual,
  toVaultRelative,
} from "../../path-utils";

export type PathMove = { from: string; to: string };

export function createOpenNoteTab(node: TreeNode, tabKey: number): OpenNoteTab {
  return {
    tabKey,
    id: node.id,
    path: node.path,
    name: node.name,
    status: "ready",
  };
}

export function findOpenNoteTabByPath(
  tabs: OpenNoteTab[],
  path: string,
): OpenNoteTab | undefined {
  return tabs.find((tab) => pathsEqual(tab.path, path));
}

export function rebasePath(path: string, move: PathMove): string | null {
  if (!isPathInside(path, move.from)) return null;
  return `${move.to}${path.substring(move.from.length)}`;
}

export function applyPathMoves(path: string, moves: PathMove[]): string {
  let nextPath = path;
  for (const move of moves) {
    nextPath = rebasePath(nextPath, move) ?? nextPath;
  }
  return nextPath;
}

export function relocateOpenNoteTabs(
  tabs: OpenNoteTab[],
  moves: PathMove[],
  vaultRoot: string,
): OpenNoteTab[] {
  if (!moves.length) return tabs;

  return tabs.map((tab) => {
    const nextPath = applyPathMoves(tab.path, moves);
    if (pathsEqual(nextPath, tab.path)) return tab;
    return {
      ...tab,
      id: toVaultRelative(nextPath, vaultRoot),
      path: nextPath,
      name: getBaseName(nextPath).replace(/\.md$/i, ""),
      status: "ready",
    };
  });
}

export function markOpenNoteTabsMissing(
  tabs: OpenNoteTab[],
  removedPaths: string[],
): OpenNoteTab[] {
  if (!removedPaths.length) return tabs;
  return tabs.map((tab) =>
    removedPaths.some((removedPath) => isPathInside(tab.path, removedPath))
      ? { ...tab, status: "missing" }
      : tab,
  );
}

export function markOpenNoteTabsAvailable(
  tabs: OpenNoteTab[],
  availablePaths: string[],
): OpenNoteTab[] {
  if (!availablePaths.length) return tabs;
  return tabs.map((tab) =>
    availablePaths.some((availablePath) => pathsEqual(tab.path, availablePath))
      ? { ...tab, status: "ready" }
      : tab,
  );
}

export function removeOpenNoteTabs(
  tabs: OpenNoteTab[],
  removedPaths: string[],
): OpenNoteTab[] {
  return tabs.filter(
    (tab) => !removedPaths.some((removedPath) => isPathInside(tab.path, removedPath)),
  );
}

export function chooseActiveTabAfterRemoval(
  previousTabs: OpenNoteTab[],
  nextTabs: OpenNoteTab[],
  activeTabKey: number | null,
): number | null {
  if (activeTabKey === null) return null;
  if (nextTabs.some((tab) => tab.tabKey === activeTabKey)) return activeTabKey;
  if (!nextTabs.length) return null;

  const removedIndex = previousTabs.findIndex((tab) => tab.tabKey === activeTabKey);
  const fallbackIndex = Math.min(Math.max(removedIndex, 0), nextTabs.length - 1);
  return nextTabs[fallbackIndex]?.tabKey ?? null;
}

export function reorderOpenNoteTabs(
  tabs: OpenNoteTab[],
  sourceTabKey: number,
  targetTabKey: number,
  placement: "before" | "after",
): OpenNoteTab[] {
  if (sourceTabKey === targetTabKey) return tabs;
  const source = tabs.find((tab) => tab.tabKey === sourceTabKey);
  if (!source) return tabs;

  const withoutSource = tabs.filter((tab) => tab.tabKey !== sourceTabKey);
  const targetIndex = withoutSource.findIndex((tab) => tab.tabKey === targetTabKey);
  if (targetIndex < 0) return tabs;

  const insertionIndex = targetIndex + (placement === "after" ? 1 : 0);
  const next = [...withoutSource];
  next.splice(insertionIndex, 0, source);
  return next;
}
