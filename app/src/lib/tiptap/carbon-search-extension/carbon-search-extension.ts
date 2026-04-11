import { Extension, type CommandProps } from "@tiptap/core";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import {
  SearchQuery,
  getSearchState,
  search as searchPlugin,
  setSearchState,
} from "prosemirror-search";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    carbonSearch: {
      setCarbonSearchQuery: (query: string) => ReturnType;
      clearCarbonSearch: () => ReturnType;
      findNextMatch: () => ReturnType;
      findPreviousMatch: () => ReturnType;
    };
  }
}

function createSearchQuery(query: string): SearchQuery {
  return new SearchQuery({ search: query });
}

export function getCarbonSearchMatchCount(state: EditorState): number {
  return getCarbonSearchMatchStatus(state).total;
}

export function getCarbonSearchMatchStatus(state: EditorState): {
  currentIndex: number;
  total: number;
} {
  const searchState = getSearchState(state);
  if (!searchState?.query.valid) {
    return { currentIndex: 0, total: 0 };
  }

  const range = searchState.range ?? { from: 0, to: state.doc.content.size };
  const { from: selectionFrom, to: selectionTo } = state.selection;
  let total = 0;
  let currentIndex = 0;

  for (let pos = range.from;;) {
    const next = searchState.query.findNext(state, pos, range.to);
    if (!next) break;

    total += 1;
    if (next.from === selectionFrom && next.to === selectionTo) {
      currentIndex = total;
    }
    pos = next.to;
  }

  return { currentIndex, total };
}

function runSearchCommand(
  direction: 1 | -1,
  { state, dispatch }: CommandProps,
) {
  const nextMatch = getAdjacentMatch(state, direction);
  if (!nextMatch || !dispatch) return false;

  dispatch(
    state.tr.setSelection(
      TextSelection.create(state.doc, nextMatch.from, nextMatch.to),
    ),
  );
  return true;
}

function getAdjacentMatch(state: EditorState, direction: 1 | -1) {
  const searchState = getSearchState(state);
  if (!searchState?.query.valid) return null;

  const range = searchState.range ?? { from: 0, to: state.doc.content.size };
  const { from, to } = state.selection;

  if (direction > 0) {
    return (
      searchState.query.findNext(state, Math.max(to, range.from), range.to) ??
      searchState.query.findNext(state, range.from, Math.min(from, range.to))
    );
  }

  return (
    searchState.query.findPrev(state, Math.min(from, range.to), range.from) ??
    searchState.query.findPrev(state, range.to, Math.max(to, range.from))
  );
}

export const CarbonSearch = Extension.create({
  name: "carbonSearch",

  addProseMirrorPlugins() {
    return [searchPlugin()];
  },

  addCommands() {
    return {
      setCarbonSearchQuery:
        (query: string) =>
        ({ tr, dispatch }) => {
          if (!dispatch) return true;
          dispatch(setSearchState(tr, createSearchQuery(query)));
          return true;
        },

      clearCarbonSearch:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) return true;
          dispatch(setSearchState(tr, createSearchQuery("")));
          return true;
        },

      findNextMatch:
        () =>
        (props) =>
          runSearchCommand(1, props),

      findPreviousMatch:
        () =>
        (props) =>
          runSearchCommand(-1, props),
    };
  },
});
