import { describe, expect, it } from "vitest";
import { buildCarbonAssetWarning, mergeShareWarnings } from "./share-warnings";

describe("share warning helpers", () => {
  it("builds an inaccessible carbon asset warning", () => {
    expect(buildCarbonAssetWarning("carbon://asset/as_123", "inaccessible")).toEqual({
      code: "INACCESSIBLE_CARBON_ASSET",
      message: "Carbon asset could not be accessed and will render as unavailable",
      sourceRef: "carbon://asset/as_123",
      severity: "warning",
    });
  });

  it("builds a missing object warning and preserves metadata warning order when merged", () => {
    const merged = mergeShareWarnings(
      [
        {
          code: "UNSHARED_NOTE_LINK",
          message: "リンク先ノートは未公開の可能性があります",
          sourceRef: "./other.md",
          severity: "warning",
        },
      ],
      [buildCarbonAssetWarning("carbon://asset/as_999", "missing-object")],
    );

    expect(merged).toEqual([
      {
        code: "UNSHARED_NOTE_LINK",
        message: "リンク先ノートは未公開の可能性があります",
        sourceRef: "./other.md",
        severity: "warning",
      },
      {
        code: "MISSING_CARBON_ASSET_OBJECT",
        message: "Carbon asset data is missing and will render as unavailable",
        sourceRef: "carbon://asset/as_999",
        severity: "warning",
      },
    ]);
  });
});
