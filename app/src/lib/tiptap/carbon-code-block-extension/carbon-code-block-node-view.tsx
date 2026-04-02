import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useCallback } from "react";
import { useCopyFeedback } from "../../hooks/use-copy-feedback";

export function CarbonCodeBlockNodeView(props: NodeViewProps) {
  const { copied, showCopied } = useCopyFeedback<"code">(1200);
  const language =
    typeof props.node.attrs.language === "string" ? props.node.attrs.language : "";
  const languageClassPrefix =
    typeof props.extension.options.languageClassPrefix === "string"
      ? props.extension.options.languageClassPrefix
      : "";
  const languageClassName = language && languageClassPrefix
    ? `${languageClassPrefix}${language}`
    : undefined;

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(props.node.textContent).then(() => {
      showCopied("code");
    });
  }, [props.node.textContent, showCopied]);

  return (
    <NodeViewWrapper className="carbon-code-block">
      <div className="carbon-code-block-toolbar" contentEditable={false}>
        {language ? (
          <span className="carbon-code-block-language">{language}</span>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="note-editor-copy-btn carbon-code-block-copy-btn"
          title={copied ? "Code copied" : "Copy code block"}
          aria-label={copied ? "Code copied" : "Copy code block"}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleCopy();
          }}
        >
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3.5 8.5L6.5 11.5L12.5 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="5.5" y="5.5" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H4.5C3.67 2 3 2.67 3 3.5V10C3 10.83 3.67 11.5 4.5 11.5H5.5"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
          )}
        </button>
      </div>
      <pre>
        <NodeViewContent className={languageClassName} />
      </pre>
    </NodeViewWrapper>
  );
}
