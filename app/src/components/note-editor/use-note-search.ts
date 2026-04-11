import type { Editor } from "@tiptap/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { getCarbonSearchMatchStatus } from "../../lib/tiptap/carbon-search-extension";

type UseNoteSearchOptions = {
  editor: Editor | null;
  editorZoom: number;
  noteDocKey: number;
};

export function useNoteSearch({ editor, editorZoom, noteDocKey }: UseNoteSearchOptions) {
  const editorContentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResizeRafRef = useRef<number | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);

  const syncSearchMatchStatus = useCallback((nextEditor = editor) => {
    if (!nextEditor) {
      setSearchMatchCount(0);
      setSearchMatchIndex(0);
      return;
    }

    const { currentIndex, total } = getCarbonSearchMatchStatus(nextEditor.state);
    setSearchMatchCount(total);
    setSearchMatchIndex(currentIndex);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const handleTransaction = () => {
      syncSearchMatchStatus(editor);
    };

    handleTransaction();
    editor.on("transaction", handleTransaction);

    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, syncSearchMatchStatus]);

  const focusSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const scrollSearchSelectionIntoView = useCallback(() => {
    const container = editorContentRef.current;
    if (!editor || !container) return;

    window.requestAnimationFrame(() => {
      const { from, to } = editor.state.selection;
      if (from === to) return;

      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const containerRect = container.getBoundingClientRect();
        const topPadding = 88;
        const bottomPadding = 40;
        const selectionTop = Math.min(start.top, end.top);
        const selectionBottom = Math.max(start.bottom, end.bottom);

        if (selectionTop < containerRect.top + topPadding) {
          container.scrollTop += (selectionTop - (containerRect.top + topPadding)) / editorZoom;
          return;
        }

        if (selectionBottom > containerRect.bottom - bottomPadding) {
          container.scrollTop += (selectionBottom - (containerRect.bottom - bottomPadding)) / editorZoom;
        }
      } catch {
        // Ignore transient position lookup failures during document updates.
      }
    });
  }, [editor, editorZoom]);

  const runSearchNavigation = useCallback((navigate: () => void) => {
    if (!editor || !searchQuery) return;

    const previousSelection = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };

    navigate();

    if (
      editor.state.selection.from !== previousSelection.from ||
      editor.state.selection.to !== previousSelection.to
    ) {
      scrollSearchSelectionIntoView();
    }
  }, [editor, scrollSearchSelectionIntoView, searchQuery]);

  const applySearchQuery = useCallback((query: string, revealMatch = true) => {
    setSearchQuery(query);
    if (!editor) return;

    if (!query) {
      editor.commands.clearCarbonSearch();
      setSearchMatchCount(0);
      setSearchMatchIndex(0);
      return;
    }

    editor.commands.setCarbonSearchQuery(query);
    if (revealMatch) {
      runSearchNavigation(() => {
        editor.commands.findNextMatch();
      });
    }
  }, [editor, runSearchNavigation]);

  const openSearch = useCallback((seedQuery?: string) => {
    const nextQuery = seedQuery ?? searchQuery;
    setIsSearchOpen(true);

    if (nextQuery) {
      editor?.commands.setCarbonSearchQuery(nextQuery);
    }

    focusSearchInput();
  }, [editor, focusSearchInput, searchQuery]);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchMatchCount(0);
    setSearchMatchIndex(0);
    if (!editor) return;

    editor.commands.clearCarbonSearch();
    editor.commands.focus();
  }, [editor]);

  const getSelectedSearchSeed = useCallback(() => {
    if (!editor) return "";

    const { from, to, empty } = editor.state.selection;
    if (empty) return "";

    return editor.state.doc.textBetween(from, to, "\n", "\n").trim();
  }, [editor]);

  const handleFindNext = useCallback(() => {
    runSearchNavigation(() => {
      editor?.commands.findNextMatch();
    });
  }, [editor, runSearchNavigation]);

  const handleFindPrevious = useCallback(() => {
    runSearchNavigation(() => {
      editor?.commands.findPreviousMatch();
    });
  }, [editor, runSearchNavigation]);

  const handleSearchInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        handleFindPrevious();
      } else {
        handleFindNext();
      }
    }
  }, [closeSearch, handleFindNext, handleFindPrevious]);

  useEffect(() => {
    if (!editor || !isSearchOpen || !searchQuery) return;

    const root = editor.view.dom;
    const ResizeObserverCtor = window.ResizeObserver;
    if (typeof ResizeObserverCtor !== "function") return;

    const scheduleRealign = () => {
      if (searchResizeRafRef.current != null) {
        window.cancelAnimationFrame(searchResizeRafRef.current);
      }

      searchResizeRafRef.current = window.requestAnimationFrame(() => {
        searchResizeRafRef.current = null;
        const { from, to } = editor.state.selection;
        if (from === to) return;
        scrollSearchSelectionIntoView();
      });
    };

    const observer = new ResizeObserverCtor(() => {
      scheduleRealign();
    });

    observer.observe(root);

    return () => {
      observer.disconnect();
      if (searchResizeRafRef.current != null) {
        window.cancelAnimationFrame(searchResizeRafRef.current);
        searchResizeRafRef.current = null;
      }
    };
  }, [editor, isSearchOpen, scrollSearchSelectionIntoView, searchQuery]);

  useEffect(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setSearchMatchCount(0);
    setSearchMatchIndex(0);
    editor?.commands.clearCarbonSearch();
  }, [editor, noteDocKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;
      if (!hasPrimaryModifier || event.altKey || event.shiftKey) return;
      if (event.isComposing || event.key.toLowerCase() !== "f") return;

      const active = document.activeElement;
      if (
        (active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement) &&
        active !== searchInputRef.current
      ) {
        return;
      }

      event.preventDefault();
      const seedQuery = searchQuery || getSelectedSearchSeed();
      if (seedQuery && seedQuery !== searchQuery) {
        applySearchQuery(seedQuery);
      }
      openSearch(seedQuery);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [applySearchQuery, getSelectedSearchSeed, openSearch, searchQuery]);

  return {
    editorContentRef,
    searchInputRef,
    isSearchOpen,
    searchMatchIndex,
    searchMatchCount,
    searchQuery,
    applySearchQuery,
    closeSearch,
    handleFindNext,
    handleFindPrevious,
    handleSearchInputKeyDown,
  };
}
