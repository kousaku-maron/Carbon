import {
  CARBON_ICON_PNG_DATA_URL,
  SHARE_OG_IMAGE_HEIGHT,
  SHARE_OG_IMAGE_WIDTH,
  buildShareDescription,
  buildSharePageTitle,
  resolveShareTitle,
} from "@carbon/rendering";
const CANVAS_BG = "#fcfcfb";
const DOT_COLOR = "rgba(17, 24, 39, 0.12)";
const BODY_TEXT = "#374151";
const MUTED_TEXT = "#6b7280";

type TextMeasureLike = {
  measureText(text: string): { width: number };
};

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });
}

async function loadCarbonIcon(): Promise<CanvasImageSource | null> {
  try {
    return await loadImageElement(CARBON_ICON_PNG_DATA_URL);
  } catch (error) {
    console.warn("[share] failed to load og icon", error);
    return null;
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + clampedRadius, y);
  ctx.lineTo(x + width - clampedRadius, y);
  ctx.arcTo(x + width, y, x + width, y + clampedRadius, clampedRadius);
  ctx.lineTo(x + width, y + height - clampedRadius);
  ctx.arcTo(x + width, y + height, x + width - clampedRadius, y + height, clampedRadius);
  ctx.lineTo(x + clampedRadius, y + height);
  ctx.arcTo(x, y + height, x, y + height - clampedRadius, clampedRadius);
  ctx.lineTo(x, y + clampedRadius);
  ctx.arcTo(x, y, x + clampedRadius, y, clampedRadius);
  ctx.closePath();
}

function drawPattern(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = DOT_COLOR;
  for (let y = 36; y < SHARE_OG_IMAGE_HEIGHT; y += 42) {
    for (let x = 32; x < SHARE_OG_IMAGE_WIDTH; x += 42) {
      ctx.beginPath();
      ctx.arc(x, y, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function splitTokenToFit(
  ctx: TextMeasureLike,
  token: string,
  maxWidth: number,
): string[] {
  const units = Array.from(token);
  const parts: string[] = [];
  let current = "";

  for (const unit of units) {
    const candidate = `${current}${unit}`;
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    parts.push(current);
    current = unit;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function fitEllipsis(
  ctx: TextMeasureLike,
  text: string,
  maxWidth: number,
): string {
  if (!text) return "...";

  let candidate = text;
  while (candidate && ctx.measureText(`${candidate}...`).width > maxWidth) {
    candidate = Array.from(candidate).slice(0, -1).join("");
  }

  return candidate ? `${candidate}...` : "...";
}

export function wrapOgText(
  ctx: TextMeasureLike,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const tokens = text.match(/\S+\s*/g) ?? [];
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = `${current}${token}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current.trim()) {
      lines.push(current.trimEnd());
      if (lines.length === maxLines) {
        lines[maxLines - 1] = fitEllipsis(ctx, lines[maxLines - 1] ?? "", maxWidth);
        return lines;
      }
    }

    if (ctx.measureText(token).width <= maxWidth) {
      current = token;
      continue;
    }

    const parts = splitTokenToFit(ctx, token.trimEnd(), maxWidth);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      const isLastPart = index === parts.length - 1;
      const next = isLastPart ? `${part}${token.endsWith(" ") ? " " : ""}` : part;
      if (lines.length === maxLines - 1) {
        lines.push(fitEllipsis(ctx, next.trimEnd(), maxWidth));
        return lines;
      }
      lines.push(next.trimEnd());
    }

    current = "";
  }

  if (current.trim() && lines.length < maxLines) {
    lines.push(current.trimEnd());
  }

  return lines;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Failed to render share og image"));
    }, "image/png");
  });
}

export async function renderShareOgImageBlob(input: {
  title: string;
  markdownBody: string;
}): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_OG_IMAGE_WIDTH;
  canvas.height = SHARE_OG_IMAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to initialize og canvas");

  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawPattern(ctx);

  const icon = await loadCarbonIcon();
  if (icon) {
    ctx.drawImage(icon, 52, 56, 40, 40);
  }

  ctx.fillStyle = BODY_TEXT;
  ctx.font = '500 28px "IBM Plex Sans", "Noto Sans JP", sans-serif';
  ctx.textBaseline = "middle";
  ctx.fillText("Carbon", 104, 76);

  const title = buildSharePageTitle(resolveShareTitle(input.markdownBody, input.title)).replace(/\s*\|\s*Carbon$/, "");
  const description = buildShareDescription(input.markdownBody);

  ctx.fillStyle = "#0f172a";
  ctx.font = '700 72px "IBM Plex Sans", "Noto Sans JP", sans-serif';
  ctx.textBaseline = "alphabetic";
  const titleLines = wrapOgText(ctx, title, 860, 2);
  let cursorY = 178;
  for (const line of titleLines) {
    ctx.fillText(line, 52, cursorY);
    cursorY += 84;
  }

  ctx.fillStyle = MUTED_TEXT;
  ctx.font = '400 32px "IBM Plex Sans", "Noto Sans JP", sans-serif';
  const descriptionLines = wrapOgText(ctx, description, 860, 3);
  cursorY += 18;
  for (const line of descriptionLines) {
    ctx.fillText(line, 52, cursorY);
    cursorY += 44;
  }

  const buttonWidth = 220;
  const buttonHeight = 68;
  const buttonY = SHARE_OG_IMAGE_HEIGHT - 122;
  ctx.fillStyle = "#000000";
  drawRoundedRect(ctx, 52, buttonY, buttonWidth, buttonHeight, buttonHeight / 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = '500 24px "IBM Plex Sans", "Noto Sans JP", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Read more", 52 + buttonWidth / 2, buttonY + buttonHeight / 2);
  ctx.textAlign = "start";

  return canvasToBlob(canvas);
}
