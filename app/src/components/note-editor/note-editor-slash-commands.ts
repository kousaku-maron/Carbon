import type { CarbonSlashCommandDefinition } from "../../lib/tiptap/carbon-slash-command-extension";

export const NOTE_EDITOR_SLASH_COMMANDS: CarbonSlashCommandDefinition[] = [
  {
    id: "table",
    title: "Table",
    description: "Insert a 3 x 3 table",
    query: "table",
    execute: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
];
