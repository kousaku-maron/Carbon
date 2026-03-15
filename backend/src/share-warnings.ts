import type { ShareWarning } from "./share-render";

export type CarbonAssetWarningReason = "inaccessible" | "missing-object";

export function buildCarbonAssetWarning(
  sourceRef: string,
  reason: CarbonAssetWarningReason,
): ShareWarning {
  if (reason === "missing-object") {
    return {
      code: "MISSING_CARBON_ASSET_OBJECT",
      message: "Carbon asset data is missing and will render as unavailable",
      sourceRef,
      severity: "warning",
    };
  }

  return {
    code: "INACCESSIBLE_CARBON_ASSET",
    message: "Carbon asset could not be accessed and will render as unavailable",
    sourceRef,
    severity: "warning",
  };
}

export function mergeShareWarnings(
  metadataWarnings: ShareWarning[] | undefined,
  assetWarnings: ShareWarning[],
): ShareWarning[] {
  return [...(metadataWarnings ?? []), ...assetWarnings];
}
