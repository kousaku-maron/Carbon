import { Extension } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import {
  SearchQuery,
  findNext as findNextCommand,
  findPrev as findPrevCommand,
  getMatchHighlights,
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
  return getMatchHighlights(state).find().length;
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
        ({ state, dispatch }) =>
          findNextCommand(state, dispatch),

      findPreviousMatch:
        () =>
        ({ state, dispatch }) =>
          findPrevCommand(state, dispatch),
    };
  },
});
