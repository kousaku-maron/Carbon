import { Extension, type CommandProps } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import {
  SearchQuery,
  findNext as findNextCommand,
  findPrev as findPrevCommand,
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
  command: (state: EditorState, dispatch?: CommandProps["dispatch"]) => boolean,
  { state, dispatch }: CommandProps,
) {
  return command(state, dispatch);
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
          runSearchCommand(findNextCommand, props),

      findPreviousMatch:
        () =>
        (props) =>
          runSearchCommand(findPrevCommand, props),
    };
  },
});
