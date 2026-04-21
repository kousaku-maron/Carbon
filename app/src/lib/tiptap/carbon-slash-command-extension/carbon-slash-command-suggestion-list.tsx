import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type SlashCommandSuggestionItem = {
  id: string;
  title: string;
  description: string;
};

export interface SlashCommandSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

type Props = {
  items: SlashCommandSuggestionItem[];
  command: (item: SlashCommandSuggestionItem) => void;
};

export const SlashCommandSuggestionList = forwardRef<
  SlashCommandSuggestionListRef,
  Props
>((props, ref) => {
  const { items, command } = props;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1));
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
      <div className="slash-command-suggestion">
        <div className="slash-command-suggestion-empty">No results</div>
      </div>
    );
  }

  return (
    <div className="slash-command-suggestion" ref={listRef}>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={`slash-command-suggestion-item ${index === selectedIndex ? "active" : ""}`}
          onClick={() => command(item)}
        >
          <span className="slash-command-suggestion-title">{item.title}</span>
          <span className="slash-command-suggestion-description">{item.description}</span>
        </button>
      ))}
    </div>
  );
});
