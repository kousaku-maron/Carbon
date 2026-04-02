import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CarbonCodeBlockNodeView } from "./carbon-code-block-node-view";

export const CarbonCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CarbonCodeBlockNodeView);
  },
});
