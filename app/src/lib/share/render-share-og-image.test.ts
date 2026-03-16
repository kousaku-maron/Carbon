import { describe, expect, it } from "vitest";
import { wrapOgText } from "./render-share-og-image";
import { buildSharePageTitle, resolveShareTitle } from "@carbon/rendering";

const fakeMeasureContext = {
  measureText(text: string) {
    return { width: Array.from(text).length * 10 };
  },
};

describe("wrapOgText", () => {
  it("wraps long Japanese text without relying on whitespace", () => {
    const source = "これはとても長い日本語のタイトルでスペースなしでも安全に折り返される必要があります";
    const lines = wrapOgText(
      fakeMeasureContext,
      source,
      120,
      2,
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(12);
    expect(lines[1]?.endsWith("...")).toBe(true);
    expect(
      `${lines[0]}${lines[1]?.slice(0, -3)}`,
    ).toBe(source.slice(0, Array.from(lines[0] ?? "").length + Array.from(lines[1]?.slice(0, -3) ?? "").length));
  });

  it("keeps regular spaced text grouped when it already fits", () => {
    const lines = wrapOgText(
      fakeMeasureContext,
      "Carbon share preview",
      240,
      2,
    );

    expect(lines).toEqual(["Carbon share preview"]);
  });

  it("uses the first h1 for OGP titles when available", () => {
    expect(buildSharePageTitle(resolveShareTitle("# 公開タイトル\n\n本文", "abc.md"))).toBe(
      "公開タイトル | Carbon",
    );
    expect(buildSharePageTitle(resolveShareTitle("本文だけです", "abc.md"))).toBe(
      "abc.md | Carbon",
    );
  });
});
