import { type Editor, type Range } from "@tiptap/react";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionMatch,
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { Extension } from "@tiptap/core";
import {
  SlashCommandSuggestionList,
  type SlashCommandSuggestionItem,
  type SlashCommandSuggestionListRef,
} from "./carbon-slash-command-suggestion-list";

type SlashCommandItem = SlashCommandSuggestionItem & {
  query: string;
  execute: (editor: Editor, range: Range) => boolean;
};

export type CarbonSlashCommandDefinition = SlashCommandItem;

export type CarbonSlashCommandOptions = {
  commands: CarbonSlashCommandDefinition[];
};

type SuggestionMatcher = NonNullable<
  SuggestionOptions<SlashCommandSuggestionItem>["findSuggestionMatch"]
>;

function findSlashSuggestionMatch(
  config: Parameters<SuggestionMatcher>[0],
): SuggestionMatch {
  const { $position } = config;
  const textBefore = $position.parent.textBetween(
    0,
    $position.parentOffset,
    undefined,
    "\uFFFC",
  );
  if (!textBefore.startsWith("/")) return null;
  if (textBefore.includes(" ")) return null;

  const from = $position.pos - textBefore.length;
  const to = $position.pos;

  return {
    range: { from, to },
    query: textBefore.slice(1),
    text: textBefore,
  };
}

const POPUP_MAX_WIDTH = 360;
const POPUP_MAX_HEIGHT = 240;
const GAP = 4;
const CARBON_SLASH_COMMAND_PLUGIN_KEY = new PluginKey("carbonSlashCommandSuggestion");

function positionPopup(
  clientRect: (() => DOMRect | null) | null | undefined,
  el: HTMLElement,
) {
  const rect = clientRect?.();
  if (!rect) return;
  const popupHeight = Math.min(el.offsetHeight || POPUP_MAX_HEIGHT, POPUP_MAX_HEIGHT);
  const left = Math.max(
    0,
    Math.min(rect.left, window.innerWidth - POPUP_MAX_WIDTH - 8),
  );
  const fitsBelow =
    rect.bottom + GAP + popupHeight <= window.innerHeight;
  const top = fitsBelow
    ? rect.bottom + GAP
    : rect.top - popupHeight - GAP;
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(0, top)}px`;
}

function getSlashCommandItems(
  commands: CarbonSlashCommandDefinition[],
  { query }: { query: string },
): SlashCommandSuggestionItem[] {
  const normalized = query.trim().toLowerCase();
  return commands
    .filter((command) => {
      if (!normalized) return true;
      return command.query.includes(normalized) || command.title.toLowerCase().includes(normalized);
    })
    .map(({ id, title, description }) => ({ id, title, description }));
}

export const CarbonSlashCommand = Extension.create<CarbonSlashCommandOptions>({
  name: "carbonSlashCommand",

  addOptions() {
    return {
      commands: [],
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: CARBON_SLASH_COMMAND_PLUGIN_KEY,
        char: "/",
        allowSpaces: false,
        allowedPrefixes: null,
        findSuggestionMatch: findSlashSuggestionMatch,
        items: ({ query }) => getSlashCommandItems(this.options.commands, { query }),
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SlashCommandSuggestionItem;
        }) => {
          const command = this.options.commands.find((item) => item.id === props.id);
          if (!command) return;
          command.execute(editor, range);
        },
        render: () => {
          let renderer: ReactRenderer<SlashCommandSuggestionListRef> | null = null;
          let popup: HTMLElement | null = null;

          return {
            onStart(onStartProps: SuggestionProps<SlashCommandSuggestionItem>) {
              popup = document.createElement("div");
              popup.style.position = "fixed";
              popup.style.zIndex = "200";
              document.body.appendChild(popup);

              renderer = new ReactRenderer(SlashCommandSuggestionList, {
                props: {
                  items: onStartProps.items,
                  command: onStartProps.command,
                },
                editor: onStartProps.editor,
              });
              popup.appendChild(renderer.element);
              positionPopup(onStartProps.clientRect, popup);
            },

            onUpdate(onUpdateProps: SuggestionProps<SlashCommandSuggestionItem>) {
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
      }),
    ];
  },
});
