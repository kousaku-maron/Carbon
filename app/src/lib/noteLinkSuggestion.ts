import { type Editor, Extension, type Range } from "@tiptap/react";
import Suggestion, {
  type SuggestionMatch,
  type SuggestionOptions,
} from "@tiptap/suggestion";

export type NoteLinkSuggestionItem = {
  id: string;
  name: string;
  path: string;
  relativePath: string;
};

export type NoteLinkSuggestionOptions = {
  suggestion: Omit<SuggestionOptions<NoteLinkSuggestionItem>, "editor">;
};

type NoteLinkSuggestionMatcher = NonNullable<
  SuggestionOptions<NoteLinkSuggestionItem>["findSuggestionMatch"]
>;

function findDoubleBracketSuggestionMatch(
  config: Parameters<NoteLinkSuggestionMatcher>[0],
): SuggestionMatch {
  const { $position } = config;
  // Use all text before cursor in the current textblock, not only nodeBefore,
  // to handle cases where brackets are split across text nodes.
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

export const NoteLinkSuggestion = Extension.create<NoteLinkSuggestionOptions>({
  name: "noteLinkSuggestion",

  addOptions() {
    return {
      suggestion: {
        char: "[",
        allowSpaces: true,
        allowedPrefixes: null,
        findSuggestionMatch: findDoubleBracketSuggestionMatch,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: NoteLinkSuggestionItem;
        }) => {
          const item = props;
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: "text",
              text: item.name,
              marks: [
                {
                  type: "link",
                  attrs: { href: item.relativePath },
                },
              ],
            })
            .run();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
