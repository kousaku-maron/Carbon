export const SHARE_OG_IMAGE_WIDTH = 1200;
export const SHARE_OG_IMAGE_HEIGHT = 630;
export const CARBON_ICON_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADSUlEQVR42sVXQUsbQRR+OxvTkEguYpRepDmlhxYPoUclhwptLtXSIjVQj/4Gf0Fu3r2EEvHQUtJDKsX2UijeBNFDI14s0kNUMASDaZPN9r3pTJiMm+xEt/TBx242w3zfvPnm7dsQ/Oewff6zbzG3hWBiDrp3+w3Sg4nBbsCLtQQ6gwQwZcA84hliCjGKGOkj2CtIfAtxifiB+IAoeXD0TCj/iCDeI54GnIEtxHNEUxVhadkg5R8F+W8x0Bpi5V6ZcAVZWIjIqp6wFMM5iBeIt4I8HHAG5JwvEe8kJ9MGzSvbEXQwjYNHSFylKaYGnI7rtrYsDtd1OQxOgcrRkQLkfljC7b4CbNvmhJ1Op0vMGONiHMfxEzCqcoa0FI34Vi4klySJRALi8TjUajU4Pz/vZsUnGyOCy9H32tfttEoiz2QysLOzA9VqFY6OjuDs7Az29vZgbm6Ok9M4g4LU4wEwXXkul4Niscifra+vw+HhIYyNjcHq6iosLy/D9vY2F0DbYxJGAuTKJycnoVAoQKvVgnQ6Dfv7+90x0WiUb8ewYSyAVrSwsAChUAjy+Twnj0QiXBiBMhAO/y0d7XY7WAEyUqkUv+7u7naJCGS8q6srjpsWB6OQ7qcs9NRbNB498zHf7QUcHBzw6+zsbPfISTGUCdomeha4ALnyUqkE9XodVlZWIJvNcjPK/V5aWoJkMsmzMYwIIwE0KR3Di4sLTkRRLpd5Ldjc3IRKpQIbGxuwuLjYPbLDdimuMCTlOCXqNOtXC6anp7nrZ2Zm+PE7Pj6GtbU1fkQHhJyzgnhAu8Z3URFgCwH3+wnQS7HXbwMB3xEPpQCmNQ9tEz8QqUwz/Sb36ydjQLTle0DWAVdpFhuKGF9TSrOR+w1Kr5zzUuF0mWbGExMBqjkN+gBdwInKyTwaR/gHLbk655ZXkyCNSO/qz1RrRFvNbtGQqsQdMfdXxGMxN+e0NTG0uV8QjxD3tK74ppBfR98QrxA1r664pzUfHx8fxSbjNd4/QdxFxJRPLNNVO8LUPxGfEG+EAXs+06w+xckV7rYmJiZizWbzDt7zbDUajb6ssVhMfYU7+Lr+dXp6eqmU5mvfiJZBhXQD+ib0nMsybKWDcL9n/AEqUkVES+lcQgAAAABJRU5ErkJggg==";

export function buildSharePageTitle(noteTitle: string): string {
  return `Carbon | ${noteTitle}`;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/&(nbsp|#160|#xa0);/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveShareTitle(markdown: string, fallbackTitle: string): string {
  const withoutCodeFences = markdown.replace(/```[\s\S]*?```/g, "\n");
  const lines = withoutCodeFences.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]?.trim() ?? "";
    if (!current) continue;

    const atxMatch = current.match(/^#\s+(.*)$/);
    if (atxMatch?.[1]) {
      const title = stripInlineMarkdown(atxMatch[1]);
      if (title) return title;
    }

    const next = lines[index + 1]?.trim() ?? "";
    if (next && /^=+$/.test(next)) {
      const title = stripInlineMarkdown(current);
      if (title) return title;
    }
  }

  return fallbackTitle;
}

function stripMarkdownForDescription(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/:::([a-z]+)\s*\{([^}]*)\}\s*:::/g, " ")
    .replace(/&(nbsp|#160|#xa0);/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildShareDescription(markdown: string): string {
  const plain = stripMarkdownForDescription(markdown);
  if (!plain) return "Shared from Carbon.";
  if (plain.length <= 160) return plain;
  return `${plain.slice(0, 157).trimEnd()}...`;
}
