import { describe, expect, it } from "vitest";
import { analyzeShareInput } from "./analyze-share-input";

describe("analyzeShareInput", () => {
  it("captures vault metadata and ignores code-like markdown segments", () => {
    const result = analyzeShareInput({
      noteId: "docs/guide.md",
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

    expect(result.metadata.sourceVaultPath).toBe("/vault");
    expect(result.metadata.sourceVaultName).toBe("vault");
    expect(result.localUploads).toHaveLength(1);
    expect(result.localUploads[0]?.absolutePath).toBe("/vault/docs/image.png");
    expect(result.metadata.linkManifest).toEqual([
      {
        href: "./other.md",
        kind: "note-link",
        targetNotePath: "docs/other.md",
      },
    ]);
    expect(result.metadata.warnings).toEqual([
      {
        code: "UNSHARED_NOTE_LINK",
        message: "リンク先ノートは未公開の可能性があります",
        sourceRef: "./other.md",
        severity: "warning",
      },
    ]);
  });

  it("marks outside-vault local references as fatal errors", () => {
    const result = analyzeShareInput({
      noteId: "docs/guide.md",
      notePath: "/vault/docs/guide.md",
      vaultPath: "/vault",
      markdownBody: "![bad](../../private/secret.png)\n[bad link](../../private/secret.pdf)",
    });

    expect(result.localUploads).toHaveLength(0);
    expect(result.metadata.warnings).toEqual([
      {
        code: "OUTSIDE_VAULT_ASSET",
        message: "Vault 外のファイル参照があるため共有できません",
        sourceRef: "../../private/secret.png",
        severity: "error",
      },
      {
        code: "OUTSIDE_VAULT_LINK",
        message: "Vault 外のファイル参照があるため共有できません",
        sourceRef: "../../private/secret.pdf",
        severity: "error",
      },
    ]);
  });

  it("keeps carbon assets in the manifest without treating them as local uploads", () => {
    const result = analyzeShareInput({
      noteId: "docs/guide.md",
      notePath: "/vault/docs/guide.md",
      vaultPath: "/vault",
      markdownBody: [
        "![cover](carbon://asset/as_123)",
        "[download](carbon://asset/as_123)",
      ].join("\n"),
    });

    expect(result.localUploads).toHaveLength(0);
    expect(result.metadata.assetManifest).toEqual([
      expect.objectContaining({
        kind: "image",
        sourceType: "carbon-asset",
        sourceRef: "carbon://asset/as_123",
      }),
    ]);
    expect(result.metadata.linkManifest).toContainEqual({
      href: "carbon://asset/as_123",
      kind: "file-link",
    });
  });
});
