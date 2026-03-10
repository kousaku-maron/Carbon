import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { getImageMimeType, getVideoMimeType, isImagePath, isVideoPath } from "../file-kind";

const DEFAULT_SLIDE_WIDTH = 9144000;
const DEFAULT_SLIDE_HEIGHT = 6858000;
const EMU_PER_INCH = 914400;
const CSS_DPI = 96;
const DEFAULT_TEXT_COLOR = "#1f2937";

export type PptxRenderable = {
  id: string;
  kind: "shape" | "image" | "video";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  fill: string | null;
  stroke: string | null;
  text: string | null;
  textColor: string;
  fontSizePx: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  borderRadius: string;
  src: string | null;
};

export type PptxSlide = {
  id: string;
  name: string;
  backgroundColor: string;
  elements: PptxRenderable[];
};

export type PptxPresentation = {
  widthEmu: number;
  heightEmu: number;
  widthPx: number;
  heightPx: number;
  slides: PptxSlide[];
};

export type LoadedPptxPresentation = {
  presentation: PptxPresentation;
  dispose: () => void;
};

type RelationshipMap = Map<string, string>;
type ThemeColorMap = Map<string, string>;

type XmlLikeNode = {
  nodeType: number;
  childNodes?: ArrayLike<XmlLikeNode>;
  localName?: string | null;
  nodeName?: string | null;
  textContent?: string | null;
  getAttribute?: (name: string) => string | null;
  getElementsByTagName?: (qualifiedName: string) => ArrayLike<XmlLikeNode>;
};

function getNodeLocalName(node: XmlLikeNode | null | undefined): string {
  if (!node) return "";
  const local = node.localName ?? node.nodeName ?? "";
  const value = typeof local === "string" ? local : "";
  const colon = value.indexOf(":");
  return colon >= 0 ? value.slice(colon + 1) : value;
}

function elementChildren(node: XmlLikeNode | null | undefined): XmlLikeNode[] {
  if (!node?.childNodes) return [];
  const result: XmlLikeNode[] = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    if (child?.nodeType === 1) result.push(child);
  }
  return result;
}

function firstChildByLocalName(node: XmlLikeNode | null | undefined, localName: string): XmlLikeNode | null {
  return elementChildren(node).find((child) => getNodeLocalName(child) === localName) ?? null;
}

function childByPath(node: XmlLikeNode | null | undefined, path: string[]): XmlLikeNode | null {
  let current = node ?? null;
  for (const segment of path) {
    current = firstChildByLocalName(current, segment);
    if (!current) return null;
  }
  return current;
}

function descendantElementsByLocalName(node: XmlLikeNode | null | undefined, localName: string): XmlLikeNode[] {
  if (!node) return [];
  const tagMatches = node.getElementsByTagName?.("*") ?? [];
  const result: XmlLikeNode[] = [];
  for (let i = 0; i < tagMatches.length; i += 1) {
    const candidate = tagMatches[i];
    if (getNodeLocalName(candidate) === localName) result.push(candidate);
  }
  return result;
}

function getAttribute(node: XmlLikeNode | null | undefined, name: string): string | null {
  if (!node?.getAttribute) return null;
  const direct = node.getAttribute(name);
  if (direct != null) return direct;
  const namespaced = node.getAttribute(`a:${name}`) ?? node.getAttribute(`r:${name}`) ?? node.getAttribute(`p:${name}`);
  if (namespaced != null) return namespaced;
  return null;
}

function parseXml(xml: string): XmlLikeNode {
  return new DOMParser().parseFromString(xml, "application/xml") as unknown as XmlLikeNode;
}

function normalizeZipPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const output: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      output.pop();
      continue;
    }
    output.push(part);
  }
  return output.join("/");
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

function resolveZipTarget(basePartPath: string, target: string): string {
  if (target.startsWith("/")) return normalizeZipPath(target.slice(1));
  return normalizeZipPath(`${dirname(basePartPath)}/${target}`);
}

function relsPathForPart(partPath: string): string {
  const dir = dirname(partPath);
  const name = partPath.slice(dir.length + 1);
  return `${dir}/_rels/${name}.rels`;
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async("text");
}

async function readZipBytes(zip: JSZip, path: string): Promise<Uint8Array | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async("uint8array");
}

async function loadRelationshipMap(zip: JSZip, partPath: string): Promise<RelationshipMap> {
  const relsPath = relsPathForPart(partPath);
  const xml = await readZipText(zip, relsPath);
  const map: RelationshipMap = new Map();
  if (!xml) return map;

  const doc = parseXml(xml);
  for (const rel of descendantElementsByLocalName(doc, "Relationship")) {
    const id = getAttribute(rel, "Id");
    const target = getAttribute(rel, "Target");
    const mode = getAttribute(rel, "TargetMode");
    if (!id || !target || mode === "External") continue;
    map.set(id, resolveZipTarget(partPath, target));
  }

  return map;
}

function parseThemeColors(themeXml: string | null): ThemeColorMap {
  const map: ThemeColorMap = new Map();
  if (!themeXml) return map;

  const doc = parseXml(themeXml);
  const clrScheme = descendantElementsByLocalName(doc, "clrScheme")[0];
  if (!clrScheme) return map;

  for (const colorNode of elementChildren(clrScheme)) {
    const key = getNodeLocalName(colorNode);
    const rgb = extractColorFromNode(colorNode, map);
    if (key && rgb) map.set(key, rgb);
  }

  return map;
}

function extractColorFromNode(node: XmlLikeNode | null | undefined, themeColors: ThemeColorMap): string | null {
  if (!node) return null;

  for (const child of elementChildren(node)) {
    const name = getNodeLocalName(child);
    if (name === "srgbClr") {
      const val = getAttribute(child, "val");
      if (val) return `#${val}`;
    }
    if (name === "schemeClr") {
      const val = getAttribute(child, "val");
      if (val) return themeColors.get(val) ?? null;
    }
    if (name === "sysClr") {
      const lastClr = getAttribute(child, "lastClr");
      if (lastClr) return `#${lastClr}`;
    }
    if (name === "prstClr") {
      const val = getAttribute(child, "val");
      if (val) return val;
    }
  }

  return null;
}

function extractSolidFillColor(node: XmlLikeNode | null | undefined, themeColors: ThemeColorMap): string | null {
  if (!node) return null;
  const solidFill = firstChildByLocalName(node, "solidFill");
  if (solidFill) return extractColorFromNode(solidFill, themeColors);
  if (firstChildByLocalName(node, "noFill")) return "transparent";
  return null;
}

function parseShapeBounds(node: XmlLikeNode | null | undefined): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
} | null {
  const xfrm =
    childByPath(node, ["spPr", "xfrm"]) ??
    childByPath(node, ["pic", "spPr", "xfrm"]) ??
    childByPath(node, ["xfrm"]);
  if (!xfrm) return null;

  const off = firstChildByLocalName(xfrm, "off");
  const ext = firstChildByLocalName(xfrm, "ext");
  if (!off || !ext) return null;

  const x = Number.parseInt(getAttribute(off, "x") ?? "0", 10);
  const y = Number.parseInt(getAttribute(off, "y") ?? "0", 10);
  const width = Number.parseInt(getAttribute(ext, "cx") ?? "0", 10);
  const height = Number.parseInt(getAttribute(ext, "cy") ?? "0", 10);
  const rotation = Number.parseInt(getAttribute(xfrm, "rot") ?? "0", 10) / 60000;

  return { x, y, width, height, rotation };
}

function parseTextAlignment(txBody: XmlLikeNode | null | undefined): {
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
} {
  const bodyPr = firstChildByLocalName(txBody, "bodyPr");
  const anchor = getAttribute(bodyPr, "anchor");
  const verticalAlign = anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top";

  const firstParagraph = firstChildByLocalName(txBody, "p");
  const pPr = firstChildByLocalName(firstParagraph, "pPr");
  const algn = getAttribute(pPr, "algn");
  const align = algn === "ctr" ? "center" : algn === "r" ? "right" : "left";

  return { align, verticalAlign };
}

function parseText(node: XmlLikeNode | null | undefined, themeColors: ThemeColorMap): {
  text: string | null;
  fontSizePx: number;
  color: string;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
} {
  const txBody = firstChildByLocalName(node, "txBody");
  if (!txBody) {
    return {
      text: null,
      fontSizePx: 18,
      color: DEFAULT_TEXT_COLOR,
      align: "left",
      verticalAlign: "top",
    };
  }

  const paragraphs = elementChildren(txBody).filter((child) => getNodeLocalName(child) === "p");
  const lines: string[] = [];
  let fontSize = 18;
  let color: string | null = null;

  for (const paragraph of paragraphs) {
    const fragments: string[] = [];
    for (const child of elementChildren(paragraph)) {
      const name = getNodeLocalName(child);
      if (name === "r") {
        const textNode = firstChildByLocalName(child, "t");
        if (textNode?.textContent) fragments.push(textNode.textContent);
        const rPr = firstChildByLocalName(child, "rPr");
        const size = Number.parseInt(getAttribute(rPr, "sz") ?? "", 10);
        if (Number.isFinite(size) && size > 0) fontSize = size / 100;
        if (!color) color = extractSolidFillColor(rPr, themeColors);
      } else if (name === "t" && child.textContent) {
        fragments.push(child.textContent);
      } else if (name === "br") {
        fragments.push("\n");
      }
    }
    lines.push(fragments.join("").trimEnd());
  }

  const { align, verticalAlign } = parseTextAlignment(txBody);

  return {
    text: lines.join("\n").trim() || null,
    fontSizePx: fontSize,
    color: color ?? DEFAULT_TEXT_COLOR,
    align,
    verticalAlign,
  };
}

function shapeBorderRadius(node: XmlLikeNode | null | undefined): string {
  const prstGeom = childByPath(node, ["spPr", "prstGeom"]);
  const preset = getAttribute(prstGeom, "prst");
  if (preset === "roundRect") return "1.6cqw";
  if (preset === "ellipse") return "999px";
  return "0.5cqw";
}

async function buildMediaUrl(zip: JSZip, mediaPath: string, objectUrls: string[]): Promise<string | null> {
  const bytes = await readZipBytes(zip, mediaPath);
  if (!bytes) return null;
  const mimeType = isImagePath(mediaPath)
    ? getImageMimeType(mediaPath)
    : isVideoPath(mediaPath)
      ? getVideoMimeType(mediaPath)
      : "application/octet-stream";
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  const blob = new Blob([blobBytes.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

async function parsePictureElement(
  zip: JSZip,
  node: XmlLikeNode,
  relationships: RelationshipMap,
  slideIndex: number,
  elementIndex: number,
  objectUrls: string[],
): Promise<PptxRenderable | null> {
  const bounds = parseShapeBounds(node);
  if (!bounds) return null;

  const blip = childByPath(node, ["blipFill", "blip"]);
  const relId = getAttribute(blip, "embed") ?? getAttribute(blip, "link");
  if (!relId) return null;

  const mediaPath = relationships.get(relId);
  if (!mediaPath) return null;

  const src = await buildMediaUrl(zip, mediaPath, objectUrls);
  if (!src) return null;

  const kind = isVideoPath(mediaPath) ? "video" : isImagePath(mediaPath) ? "image" : null;
  if (!kind) return null;

  return {
    id: `slide-${slideIndex + 1}-media-${elementIndex + 1}`,
    kind,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: bounds.rotation,
    zIndex: elementIndex,
    fill: null,
    stroke: null,
    text: null,
    textColor: DEFAULT_TEXT_COLOR,
    fontSizePx: 18,
    textAlign: "left",
    verticalAlign: "top",
    borderRadius: "0.6cqw",
    src,
  };
}

function parseShapeElement(
  node: XmlLikeNode,
  themeColors: ThemeColorMap,
  slideIndex: number,
  elementIndex: number,
): PptxRenderable | null {
  const bounds = parseShapeBounds(node);
  if (!bounds) return null;

  const spPr = firstChildByLocalName(node, "spPr");
  const fill = extractSolidFillColor(spPr, themeColors);
  const strokeNode = firstChildByLocalName(spPr, "ln");
  const stroke = extractSolidFillColor(strokeNode, themeColors);
  const text = parseText(node, themeColors);

  if (!text.text && (!fill || fill === "transparent") && !stroke) return null;

  return {
    id: `slide-${slideIndex + 1}-shape-${elementIndex + 1}`,
    kind: "shape",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: bounds.rotation,
    zIndex: elementIndex,
    fill: fill === "transparent" ? null : fill,
    stroke: stroke === "transparent" ? null : stroke,
    text: text.text,
    textColor: text.color,
    fontSizePx: text.fontSizePx,
    textAlign: text.align,
    verticalAlign: text.verticalAlign,
    borderRadius: shapeBorderRadius(node),
    src: null,
  };
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  slideIndex: number,
  size: { width: number; height: number },
  themeColors: ThemeColorMap,
  objectUrls: string[],
): Promise<PptxSlide> {
  const xml = await readZipText(zip, slidePath);
  if (!xml) {
    return {
      id: `slide-${slideIndex + 1}`,
      name: `Slide ${slideIndex + 1}`,
      backgroundColor: "#ffffff",
      elements: [],
    };
  }

  const doc = parseXml(xml);
  const relationships = await loadRelationshipMap(zip, slidePath);
  const backgroundNode = childByPath(doc, ["sld", "cSld", "bg", "bgPr"]) ?? childByPath(doc, ["cSld", "bg", "bgPr"]);
  const backgroundColor = extractSolidFillColor(backgroundNode, themeColors) ?? "#ffffff";

  const spTree = childByPath(doc, ["sld", "cSld", "spTree"]) ?? childByPath(doc, ["cSld", "spTree"]);
  const treeChildren = elementChildren(spTree);
  const elements: PptxRenderable[] = [];

  for (let index = 0; index < treeChildren.length; index += 1) {
    const child = treeChildren[index];
    const name = getNodeLocalName(child);
    if (name === "sp") {
      const shape = parseShapeElement(child, themeColors, slideIndex, index);
      if (shape) elements.push(shape);
      continue;
    }
    if (name === "pic") {
      const media = await parsePictureElement(zip, child, relationships, slideIndex, index, objectUrls);
      if (media) elements.push(media);
    }
  }

  return {
    id: `slide-${slideIndex + 1}`,
    name: `Slide ${slideIndex + 1}`,
    backgroundColor,
    elements: elements
      .filter((element) => element.width > 0 && element.height > 0)
      .sort((a, b) => a.zIndex - b.zIndex),
  };
}

function numericSlideSort(a: string, b: string): number {
  const getIndex = (value: string) => Number.parseInt(value.match(/slide(\d+)\.xml$/)?.[1] ?? "0", 10);
  return getIndex(a) - getIndex(b);
}

function toCssPixels(emu: number): number {
  return (emu / EMU_PER_INCH) * CSS_DPI;
}

export async function loadPptxPresentation(bytes: Uint8Array): Promise<LoadedPptxPresentation> {
  const zip = await JSZip.loadAsync(bytes);
  const objectUrls: string[] = [];

  const presentationXml = await readZipText(zip, "ppt/presentation.xml");
  const themeXml = await readZipText(zip, "ppt/theme/theme1.xml");
  const themeColors = parseThemeColors(themeXml);

  let widthEmu = DEFAULT_SLIDE_WIDTH;
  let heightEmu = DEFAULT_SLIDE_HEIGHT;

  if (presentationXml) {
    const doc = parseXml(presentationXml);
    const slideSize = descendantElementsByLocalName(doc, "sldSz")[0];
    if (slideSize) {
      widthEmu = Number.parseInt(getAttribute(slideSize, "cx") ?? `${DEFAULT_SLIDE_WIDTH}`, 10);
      heightEmu = Number.parseInt(getAttribute(slideSize, "cy") ?? `${DEFAULT_SLIDE_HEIGHT}`, 10);
    }
  }

  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort(numericSlideSort);

  const slides: PptxSlide[] = [];
  for (let index = 0; index < slidePaths.length; index += 1) {
    slides.push(
      await parseSlide(zip, slidePaths[index], index, { width: widthEmu, height: heightEmu }, themeColors, objectUrls),
    );
  }

  return {
    presentation: {
      widthEmu,
      heightEmu,
      widthPx: toCssPixels(widthEmu),
      heightPx: toCssPixels(heightEmu),
      slides,
    },
    dispose: () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
    },
  };
}
