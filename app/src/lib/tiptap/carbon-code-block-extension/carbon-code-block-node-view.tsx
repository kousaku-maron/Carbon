import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useCopyFeedback } from "../../hooks/use-copy-feedback";

type Mermaid = typeof import("mermaid").default;

let mermaidPromise: Promise<Mermaid> | null = null;

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
    });
    return mermaid;
  });
  return mermaidPromise;
}

export function CarbonCodeBlockNodeView(props: NodeViewProps) {
  const { copied, showCopied } = useCopyFeedback<"code">(1200);
  const mermaidId = useId().replace(/:/g, "");
  const [mermaidSvg, setMermaidSvg] = useState("");
  const [mermaidModalSvg, setMermaidModalSvg] = useState("");
  const [mermaidError, setMermaidError] = useState("");
  const [mermaidViewMode, setMermaidViewMode] = useState<"preview" | "code">("preview");
  const [mermaidModalOpen, setMermaidModalOpen] = useState(false);
  const language =
    typeof props.node.attrs.language === "string" ? props.node.attrs.language : "";
  const isMermaid = language.trim().toLowerCase() === "mermaid";
  const languageClassPrefix =
    typeof props.extension.options.languageClassPrefix === "string"
      ? props.extension.options.languageClassPrefix
      : "";
  const languageClassName = language && languageClassPrefix
    ? `${languageClassPrefix}${language}`
    : undefined;
  const source = props.node.textContent;
  const renderId = useMemo(() => `carbon-mermaid-${mermaidId}`, [mermaidId]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(source).then(() => {
      showCopied("code");
    });
  }, [source, showCopied]);

  const closeMermaidModal = useCallback(() => {
    setMermaidModalOpen(false);
  }, []);

  useEffect(() => {
    if (!isMermaid) {
      setMermaidSvg("");
      setMermaidModalSvg("");
      setMermaidError("");
      setMermaidModalOpen(false);
      return;
    }

    const trimmedSource = source.trim();
    if (!trimmedSource) {
      setMermaidSvg("");
      setMermaidModalSvg("");
      setMermaidError("");
      return;
    }

    let cancelled = false;
    setMermaidError("");

    void loadMermaid()
      .then((mermaid) => mermaid.render(renderId, trimmedSource))
      .then(({ svg }) => {
        if (cancelled) return;
        setMermaidSvg(svg);
        setMermaidModalSvg(svg.split(renderId).join(`${renderId}-modal`));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMermaidSvg("");
        setMermaidModalSvg("");
        setMermaidError(error instanceof Error ? error.message : "Failed to render Mermaid diagram");
      });

    return () => {
      cancelled = true;
    };
  }, [isMermaid, renderId, source]);

  useEffect(() => {
    if (!mermaidModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMermaidModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMermaidModal, mermaidModalOpen]);

  return (
    <NodeViewWrapper
      className={`carbon-code-block${isMermaid ? " carbon-code-block--mermaid" : ""}${isMermaid && mermaidViewMode === "preview" ? " carbon-code-block--preview" : ""}`}
    >
      <div className="carbon-code-block-toolbar" contentEditable={false}>
        {language ? (
          <span className="carbon-code-block-language">{language}</span>
        ) : (
          <span />
        )}
        <div className="carbon-code-block-actions">
          {isMermaid ? (
            <button
              type="button"
              className="note-editor-copy-btn carbon-code-block-toggle-btn"
              title={mermaidViewMode === "preview" ? "Show Mermaid code" : "Show Mermaid preview"}
              aria-label={mermaidViewMode === "preview" ? "Show Mermaid code" : "Show Mermaid preview"}
              aria-pressed={mermaidViewMode === "preview"}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMermaidViewMode((current) => current === "preview" ? "code" : "preview");
              }}
            >
              {mermaidViewMode === "preview" ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M2.75 8C3.78 5.83 5.56 4.5 8 4.5C10.44 4.5 12.22 5.83 13.25 8C12.22 10.17 10.44 11.5 8 11.5C5.56 11.5 3.78 10.17 2.75 8Z"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinejoin="round"
                  />
                  <circle cx="8" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.35" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M5.5 4.5L2.75 8L5.5 11.5"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10.5 4.5L13.25 8L10.5 11.5"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 3.75L7 12.25"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
          ) : null}
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
      </div>
      {isMermaid ? (
        <button
          type="button"
          className="carbon-mermaid-preview"
          contentEditable={false}
          disabled={!mermaidSvg}
          title={mermaidSvg ? "Open Mermaid preview" : undefined}
          aria-label={mermaidSvg ? "Open Mermaid preview" : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (mermaidSvg) {
              setMermaidModalOpen(true);
            }
          }}
        >
          {mermaidSvg ? (
            <div className="carbon-mermaid-svg" dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
          ) : mermaidError ? (
            <div className="carbon-mermaid-error">{mermaidError}</div>
          ) : (
            <div className="carbon-mermaid-empty">Mermaid diagram</div>
          )}
        </button>
      ) : null}
      <pre>
        <NodeViewContent className={languageClassName} />
      </pre>
      {isMermaid && mermaidModalOpen && mermaidModalSvg ? (
        <div
          className="carbon-mermaid-modal"
          contentEditable={false}
          role="dialog"
          aria-modal="true"
          aria-label="Mermaid preview"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMermaidModal();
          }}
        >
          <div
            className="carbon-mermaid-modal-panel"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="carbon-mermaid-modal-svg" dangerouslySetInnerHTML={{ __html: mermaidModalSvg }} />
          </div>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
