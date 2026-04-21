import {
  CARBON_IMAGE_EMBED_CLASS,
  CARBON_IMAGE_FRAME_CLASS,
  CARBON_IMAGE_NODE_CLASS,
  CARBON_FILE_CARD_ACTION_CLASS,
  CARBON_FILE_CARD_CLASS,
  CARBON_FILE_CARD_KIND_CLASS,
  CARBON_FILE_CARD_META_CLASS,
  CARBON_FILE_CARD_PREVIEW_CLASS,
  CARBON_FILE_CARD_PREVIEW_IMAGE_CLASS,
  CARBON_FILE_CARD_TITLE_CLASS,
  CARBON_INTERNAL_LINK_CLASS,
  CARBON_LINK_CLASS,
  CARBON_MISSING_ASSET_CLASS,
  CARBON_MISSING_IMAGE_ASSET_CLASS,
  CARBON_MISSING_LINK_CLASS,
  CARBON_PDF_FRAME_CLASS,
  CARBON_PDF_NODE_CLASS,
  CARBON_PROSE_CLASS,
  CARBON_SHARE_DOWNLOAD_CLASS,
  CARBON_SHARE_EMBED_CLASS,
  CARBON_SHARE_OPEN_CLASS,
  CARBON_VIDEO_EMBED_CLASS,
  CARBON_VIDEO_FRAME_CLASS,
  CARBON_VIDEO_NODE_CLASS,
} from "./class-names";

export const carbonProseCss = `
.${CARBON_PROSE_CLASS} {
  color: #37352f;
  font-size: 0.95rem;
  line-height: 1.75;
}

.${CARBON_PROSE_CLASS} > *:first-child {
  margin-top: 0;
}

.${CARBON_PROSE_CLASS} h1 {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 3rem 0 1.1rem;
  color: #37352f;
  line-height: 1.2;
}

.${CARBON_PROSE_CLASS} h2 {
  font-size: 1.35rem;
  font-weight: 600;
  margin: 2.4rem 0 0.95rem;
  color: #37352f;
  line-height: 1.2;
}

.${CARBON_PROSE_CLASS} h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 2rem 0 0.8rem;
  color: #37352f;
  line-height: 1.2;
}

.${CARBON_PROSE_CLASS} h1 + *,
.${CARBON_PROSE_CLASS} h2 + *,
.${CARBON_PROSE_CLASS} h3 + * {
  margin-top: 0;
}

.${CARBON_PROSE_CLASS} p {
  margin: 0.5rem 0;
}

.${CARBON_PROSE_CLASS} ul,
.${CARBON_PROSE_CLASS} ol {
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}

.${CARBON_PROSE_CLASS} ul {
  list-style: disc;
}

.${CARBON_PROSE_CLASS} ul ul {
  list-style: circle;
}

.${CARBON_PROSE_CLASS} ul ul ul {
  list-style: square;
}

.${CARBON_PROSE_CLASS} ol {
  list-style: decimal;
}

.${CARBON_PROSE_CLASS} li {
  margin: 0.15rem 0;
}

.${CARBON_PROSE_CLASS} blockquote {
  border-left: 3px solid #e3e2e0;
  margin: 0.75rem 0;
  padding: 0.25rem 0 0.25rem 1rem;
  color: #787774;
}

.${CARBON_PROSE_CLASS} pre {
  background: #f7f6f3;
  border: 1px solid #e3e2e0;
  border-radius: 7px;
  padding: 0.75rem 1rem;
  margin: 0.75rem 0;
  overflow-x: auto;
}

.${CARBON_PROSE_CLASS} pre code {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.85rem;
  color: #37352f;
  background: none;
  padding: 0;
}

.${CARBON_PROSE_CLASS} code {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.85em;
  background: #f7f6f3;
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  color: #eb5757;
}

.${CARBON_PROSE_CLASS} hr {
  border: none;
  border-top: 1px solid #e3e2e0;
  margin: 1.5rem 0;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
  margin: 0.2rem 0;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin: 0;
  padding: 0.14rem 0;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li label {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 1.05rem;
  height: 1.05rem;
  margin-top: 0.26rem;
  cursor: default;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li input[type="checkbox"] {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li label span {
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 0.28rem;
  border: 1.5px solid #d3d1cb;
  background: #fff;
  box-sizing: border-box;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li input[type="checkbox"]:checked + span {
  border-color: #2383e2;
  background: #2383e2;
  position: relative;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li input[type="checkbox"]:checked + span::after {
  content: "";
  position: absolute;
  left: 0.31rem;
  top: 0.11rem;
  width: 0.24rem;
  height: 0.48rem;
  border: solid #fff;
  border-width: 0 0.12rem 0.12rem 0;
  transform: rotate(45deg);
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li > div {
  flex: 1 1 auto;
  min-width: 0;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li > div > p {
  margin: 0;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li > div > ul[data-type="taskList"] {
  margin-top: 0.08rem;
  padding-left: 1.6rem;
}

.${CARBON_PROSE_CLASS} ul[data-type="taskList"] li[data-checked="true"] > div > p {
  text-decoration: line-through;
  text-decoration-color: #9f9b92;
  text-decoration-thickness: 1.5px;
}

.${CARBON_PROSE_CLASS} table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

.${CARBON_PROSE_CLASS} th,
.${CARBON_PROSE_CLASS} td {
  border: 1px solid #e3e2e0;
  padding: 0.65rem 0.8rem;
  text-align: left;
  vertical-align: top;
}

.${CARBON_PROSE_CLASS} th {
  background: #f5f5f4;
}

.${CARBON_PROSE_CLASS} figure {
  margin: 0.9rem 0;
}

.${CARBON_PROSE_CLASS} figcaption {
  margin-top: 0.45rem;
  color: #787774;
  font-size: 0.82rem;
}

.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS} {
  color: #6f6e69;
  text-decoration: underline;
  text-decoration-color: rgba(111, 110, 105, 0.42);
  text-underline-offset: 2px;
  transition: text-decoration-color 0.15s, color 0.12s;
}

.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS}:hover {
  color: #5f5e5a;
  text-decoration-color: rgba(95, 94, 90, 0.6);
}

.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS}.${CARBON_INTERNAL_LINK_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 0.32em;
  padding: 0.08em 0.38em 0.08em 0.26em;
  margin: 0 0.05em;
  border-radius: 0.34em;
  color: #37352f;
  font-weight: 600;
  line-height: 1.35;
  text-decoration-color: rgba(55, 53, 47, 0.45);
}

.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS}.${CARBON_INTERNAL_LINK_CLASS}:hover {
  color: #2f2e2b;
  text-decoration-color: rgba(47, 46, 43, 0.65);
}

.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS}.${CARBON_INTERNAL_LINK_CLASS}::before {
  content: "";
  display: inline-block;
  width: 0.95em;
  height: 0.95em;
  flex-shrink: 0;
  background-repeat: no-repeat;
  background-size: contain;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238f8f8b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3Cpolyline points='14 2 14 8 20 8'/%3E%3C/svg%3E");
}

.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS}.${CARBON_MISSING_LINK_CLASS} {
  position: relative;
  color: #37352f;
  text-decoration-color: rgba(55, 53, 47, 0.45);
  cursor: help;
}

.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS}.${CARBON_MISSING_LINK_CLASS}:hover {
  color: #2f2e2b;
  text-decoration-color: rgba(47, 46, 43, 0.65);
}

.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS}.${CARBON_MISSING_LINK_CLASS}::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%) translateY(4px);
  min-width: max-content;
  max-width: min(240px, 80vw);
  padding: 0.38rem 0.55rem;
  border-radius: 0.45rem;
  background: rgba(32, 32, 32, 0.92);
  color: #ffffff;
  font-size: 0.72rem;
  line-height: 1.35;
  text-align: center;
  white-space: normal;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
  z-index: 20;
}

.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS}.${CARBON_MISSING_LINK_CLASS}:hover::after,
.${CARBON_PROSE_CLASS} .${CARBON_LINK_CLASS}.${CARBON_MISSING_LINK_CLASS}:focus-visible::after {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.${CARBON_PROSE_CLASS} .${CARBON_IMAGE_NODE_CLASS},
.${CARBON_PROSE_CLASS} .${CARBON_VIDEO_NODE_CLASS},
.${CARBON_PROSE_CLASS} .${CARBON_PDF_NODE_CLASS},
.${CARBON_PROSE_CLASS} .${CARBON_SHARE_EMBED_CLASS} {
  margin: 0.75rem 0;
}

.${CARBON_PROSE_CLASS} .${CARBON_IMAGE_FRAME_CLASS},
.${CARBON_PROSE_CLASS} .${CARBON_VIDEO_FRAME_CLASS},
.${CARBON_PROSE_CLASS} .${CARBON_PDF_FRAME_CLASS} {
  position: relative;
}

.${CARBON_PROSE_CLASS} .${CARBON_IMAGE_EMBED_CLASS},
.${CARBON_PROSE_CLASS} .${CARBON_VIDEO_EMBED_CLASS},
.${CARBON_PROSE_CLASS} img,
.${CARBON_PROSE_CLASS} video {
  width: 100%;
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0;
}

.${CARBON_PROSE_CLASS} .${CARBON_VIDEO_EMBED_CLASS},
.${CARBON_PROSE_CLASS} video {
  max-height: 70vh;
  background: #111;
}

.${CARBON_PROSE_CLASS} .${CARBON_SHARE_DOWNLOAD_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #37352f;
}

.${CARBON_PROSE_CLASS} .${CARBON_SHARE_OPEN_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #37352f;
}

.${CARBON_PROSE_CLASS} .${CARBON_SHARE_DOWNLOAD_CLASS}::before {
  content: "↧";
  color: #787774;
}

.${CARBON_PROSE_CLASS} .${CARBON_SHARE_OPEN_CLASS}::before {
  content: none;
}

.${CARBON_PROSE_CLASS} .${CARBON_FILE_CARD_CLASS} {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.95rem 1rem;
  border: 1px solid #e3e2e0;
  border-radius: 0.9rem;
  background: #ffffff;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
}

.${CARBON_PROSE_CLASS} .${CARBON_FILE_CARD_PREVIEW_CLASS} {
  width: 104px;
  height: 136px;
  border-radius: 0.7rem;
  overflow: hidden;
  flex-shrink: 0;
  background: #f7f6f3;
  border: 1px solid #ece9e3;
}

.${CARBON_PROSE_CLASS} .${CARBON_FILE_CARD_PREVIEW_IMAGE_CLASS} {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  margin: 0;
}

.${CARBON_PROSE_CLASS} .${CARBON_FILE_CARD_META_CLASS} {
  min-width: 0;
  flex: 1 1 auto;
}

.${CARBON_PROSE_CLASS} .${CARBON_FILE_CARD_KIND_CLASS} {
  display: inline-flex;
  align-items: center;
  margin-bottom: 0.28rem;
  padding: 0.12rem 0.42rem;
  border-radius: 999px;
  background: #f1f1ef;
  color: #787774;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.${CARBON_PROSE_CLASS} .${CARBON_FILE_CARD_TITLE_CLASS} {
  color: #37352f;
  font-size: 0.86rem;
  font-weight: 600;
  line-height: 1.35;
  word-break: break-word;
}

.${CARBON_PROSE_CLASS} .${CARBON_FILE_CARD_ACTION_CLASS} {
  flex-shrink: 0;
}

.${CARBON_PROSE_CLASS} .${CARBON_FILE_CARD_ACTION_CLASS}.${CARBON_SHARE_DOWNLOAD_CLASS} {
  padding: 0.42rem 0.72rem;
  border-radius: 999px;
  background: #f7f6f3;
  text-decoration: none;
}

.${CARBON_PROSE_CLASS} .${CARBON_FILE_CARD_ACTION_CLASS}.${CARBON_SHARE_OPEN_CLASS} {
  padding: 0.42rem 0.72rem;
  border-radius: 999px;
  background: #f7f6f3;
  text-decoration: none;
}

.${CARBON_PROSE_CLASS} .${CARBON_MISSING_ASSET_CLASS} {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  padding: 18px;
  border: 1px dashed #d7d5d1;
  border-radius: 14px;
  background: #f7f6f3;
  color: #787774;
  font-size: 14px;
  text-align: center;
}

.${CARBON_PROSE_CLASS} .${CARBON_MISSING_ASSET_CLASS}.${CARBON_MISSING_IMAGE_ASSET_CLASS} {
  min-height: 220px;
}
`;
