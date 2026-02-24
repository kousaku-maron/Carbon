import { type Editor, type Range } from "@tiptap/react";
import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionMatch,
  SuggestionOptions,
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import {
  NoteLinkSuggestionList,
  type NoteLinkSuggestionListRef,
} from "./note-link-suggestion-list";

export type NoteLinkSuggestionItem = {
  id: string;
  name: string;
  path: string;
  relativePath: string;
};

// ── Trigger detection ───────────────────────────────────────

type SuggestionMatcher = NonNullable<
  SuggestionOptions<NoteLinkSuggestionItem>["findSuggestionMatch"]
>;

function findDoubleBracketSuggestionMatch(
  config: Parameters<SuggestionMatcher>[0],
): SuggestionMatch {
  const { $position } = config;
  const textBefore = $position.parent.textBetween(
    0,
    $position.parentOffset,
    undefined,
    "\uFFFC",
  );
  if (!textBefore) return null;

  const triggerIndex = textBefore.lastIndexOf("[[");
  if (triggerIndex < 0) return null;

  const afterTrigger = textBefore.slice(triggerIndex + 2);
  if (afterTrigger.includes("]")) return null;

  const from = $position.pos - textBefore.length + triggerIndex;
  const to = $position.pos;

  if (from >= to) return null;

  return {
    range: { from, to },
    query: afterTrigger,
    text: textBefore.slice(triggerIndex),
  };
}

// ── Popup positioning ───────────────────────────────────────

const POPUP_MAX_WIDTH = 360;
const POPUP_MAX_HEIGHT = 240;
const GAP = 4;

function positionPopup(
  clientRect: (() => DOMRect | null) | null | undefined,
  el: HTMLElement,
) {
  const rect = clientRect?.();
  if (!rect) return;
  const left = Math.max(
    0,
    Math.min(rect.left, window.innerWidth - POPUP_MAX_WIDTH - 8),
  );
  const fitsBelow =
    rect.bottom + GAP + POPUP_MAX_HEIGHT <= window.innerHeight;
  const top = fitsBelow
    ? rect.bottom + GAP
    : rect.top - POPUP_MAX_HEIGHT - GAP;
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(0, top)}px`;
}

// ── Build config ────────────────────────────────────────────

export type CarbonLinkSuggestionConfig = {
  items: (props: { query: string }) => NoteLinkSuggestionItem[];
};

/**
 * Build a full SuggestionOptions from the consumer-provided items callback.
 * Trigger detection, command execution, and popup rendering are all built-in.
 */
export function buildSuggestionConfig(
  config: CarbonLinkSuggestionConfig,
): Omit<SuggestionOptions<NoteLinkSuggestionItem>, "editor"> {
  return {
    char: "[",
    allowSpaces: true,
    allowedPrefixes: null,
    findSuggestionMatch: findDoubleBracketSuggestionMatch,
    items: config.items,

    command: ({
      editor,
      range,
      props,
    }: {
      editor: Editor;
      range: Range;
      props: NoteLinkSuggestionItem;
    }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "text",
          text: props.name,
          marks: [
            {
              type: "link",
              attrs: { href: props.relativePath },
            },
          ],
        })
        .run();
    },

    render: () => {
      let renderer: ReactRenderer<NoteLinkSuggestionListRef> | null = null;
      let popup: HTMLElement | null = null;

      return {
        onStart(onStartProps: SuggestionProps<NoteLinkSuggestionItem>) {
          popup = document.createElement("div");
          popup.style.position = "fixed";
          popup.style.zIndex = "200";
          document.body.appendChild(popup);

          renderer = new ReactRenderer(NoteLinkSuggestionList, {
            props: {
              items: onStartProps.items,
              command: onStartProps.command,
            },
            editor: onStartProps.editor,
          });
          popup.appendChild(renderer.element);
          positionPopup(onStartProps.clientRect, popup);
        },

        onUpdate(onUpdateProps: SuggestionProps<NoteLinkSuggestionItem>) {
          renderer?.updateProps({
            items: onUpdateProps.items,
            command: onUpdateProps.command,
          });
          if (popup) positionPopup(onUpdateProps.clientRect, popup);
        },

        onKeyDown(onKeyDownProps: SuggestionKeyDownProps) {
          if (onKeyDownProps.event.key === "Escape") {
            popup?.remove();
            renderer?.destroy();
            popup = null;
            renderer = null;
            return true;
          }
          return renderer?.ref?.onKeyDown(onKeyDownProps.event) ?? false;
        },

        onExit() {
          renderer?.destroy();
          popup?.remove();
          popup = null;
          renderer = null;
        },
      };
    },
  };
}
