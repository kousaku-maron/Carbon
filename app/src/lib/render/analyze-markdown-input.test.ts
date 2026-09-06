import { describe, expect, it } from "vitest";
import { analyzeMarkdownInput } from "./analyze-markdown-input";

describe("analyzeMarkdownInput", () => {
  it("captures local assets and ignores code-like markdown segments", () => {
    const result = analyzeMarkdownInput({
      notePath: "/vault/docs/guide.md",
      vaultPath: "/vault",
      title: "Guide",
      markdownBody: [
        "```md",
        "![ignored](../outside.png)",
        "[ignored note](../outside.md)",
        "```",
        "",
        "Inline `![ignored-inline](../outside-inline.png)` sample.",
        "",
        "![real](./image.png)",
        "[Other note](./other.md)",
      ].join("\n"),
    });

    expect(result.title).toBe("Guide");
    expect(result.localUploads).toHaveLength(1);
    expect(result.localUploads[0]?.absolutePath).toBe("/vault/docs/image.png");
    expect(result.linkManifest).toEqual([
      {
        href: "./other.md",
        kind: "note-link",
        targetNotePath: "docs/other.md",
      },
    ]);
    expect(result.warnings).toEqual([
      {
        code: "UNRESOLVED_NOTE_LINK",
        message: "リンク先ノートを解決できません",
        sourceRef: "./other.md",
        severity: "warning",
      },
    ]);
  });

  it("uses the first h1 as the document title when present", () => {
    const result = analyzeMarkdownInput({
      notePath: "/vault/docs/guide.md",
      vaultPath: "/vault",
      title: "guide.md",
      markdownBody: "# ドキュメントタイトル\n\n## セクション\n\n本文",
    });

    expect(result.title).toBe("ドキュメントタイトル");
  });

  it("marks outside-vault local references as errors", () => {
    const result = analyzeMarkdownInput({
      notePath: "/vault/docs/guide.md",
      vaultPath: "/vault",
      markdownBody: "![bad](../../private/secret.png)\n[bad link](../../private/secret.pdf)",
    });

    expect(result.localUploads).toHaveLength(0);
    expect(result.warnings).toEqual([
      {
        code: "OUTSIDE_VAULT_ASSET",
        message: "Vault 外のファイル参照は扱えません",
        sourceRef: "../../private/secret.png",
        severity: "error",
      },
      {
        code: "OUTSIDE_VAULT_LINK",
        message: "Vault 外のファイル参照は扱えません",
        sourceRef: "../../private/secret.pdf",
        severity: "error",
      },
    ]);
  });

  it("treats leading-slash references as vault-absolute paths", () => {
    const result = analyzeMarkdownInput({
      notePath: "/vault/docs/guide.md",
      vaultPath: "/vault",
      markdownBody: [
        "![asset](/.carbon/assets/demo.png)",
        "[Root note](/root.md)",
      ].join("\n"),
    });

    expect(result.localUploads).toHaveLength(1);
    expect(result.localUploads[0]?.absolutePath).toBe("/vault/.carbon/assets/demo.png");
    expect(result.linkManifest).toEqual([
      {
        href: "/root.md",
        kind: "note-link",
        targetNotePath: "root.md",
      },
    ]);
  });

  it("keeps image carbon assets in the manifest without local uploads", () => {
    const result = analyzeMarkdownInput({
      notePath: "/vault/docs/guide.md",
      vaultPath: "/vault",
      markdownBody: "![cover](carbon://asset/as_123)",
    });

    expect(result.localUploads).toHaveLength(0);
    expect(result.assetManifest).toEqual([
      expect.objectContaining({
        kind: "image",
        sourceType: "carbon-asset",
        sourceRef: "carbon://asset/as_123",
      }),
    ]);
    expect(result.linkManifest).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("rejects non-image carbon assets while keeping the logic future-extensible", () => {
    const result = analyzeMarkdownInput({
      notePath: "/vault/docs/guide.md",
      vaultPath: "/vault",
      markdownBody: [
        ':::video {src="carbon://asset/as_video" title="demo.mp4"} :::',
        "[file](carbon://asset/as_file)",
      ].join("\n"),
    });

    expect(result.localUploads).toHaveLength(0);
    expect(result.assetManifest).toEqual([]);
    expect(result.linkManifest).toEqual([]);
    expect(result.warnings).toEqual([
      {
        code: "UNSUPPORTED_CARBON_ASSET_KIND",
        message: "carbon://asset には現在画像のみ対応しています",
        sourceRef: "carbon://asset/as_video",
        severity: "error",
      },
      {
        code: "UNSUPPORTED_CARBON_ASSET_KIND",
        message: "carbon://asset には現在画像のみ対応しています",
        sourceRef: "carbon://asset/as_file",
        severity: "error",
      },
    ]);
  });
});
