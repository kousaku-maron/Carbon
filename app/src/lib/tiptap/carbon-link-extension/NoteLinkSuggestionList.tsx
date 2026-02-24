import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { NoteLinkSuggestionItem } from "./noteLinkSuggestion";

export interface NoteLinkSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface Props {
  items: NoteLinkSuggestionItem[];
  command: (item: NoteLinkSuggestionItem) => void;
}

export const NoteLinkSuggestionList = forwardRef<
  NoteLinkSuggestionListRef,
  Props
>((props, ref) => {
  const { items, command } = props;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  // Scroll selected item into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) =>
          prev <= 0 ? items.length - 1 : prev - 1,
        );
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) =>
          prev >= items.length - 1 ? 0 : prev + 1,
        );
        return true;
      }
      if (event.key === "Enter") {
        const item = items[selectedIndex];
        if (item) command(item);
        return true;
      }
      if (event.key === "Escape") {
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="note-link-suggestion">
        <div className="note-link-suggestion-empty">No results</div>
      </div>
    );
  }

  return (
    <div className="note-link-suggestion" ref={listRef}>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={`note-link-suggestion-item ${index === selectedIndex ? "active" : ""}`}
          onClick={() => command(item)}
        >
          <span className="note-link-suggestion-name">{item.name}</span>
          <span className="note-link-suggestion-path">{item.id}</span>
        </button>
      ))}
    </div>
  );
});
