import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../api/client";
import { formatShareError } from "./format-share-error";

describe("formatShareError", () => {
  it("formats warning payloads into a readable joined message", () => {
    const error = new ApiRequestError(
      "/api/shares",
      422,
      JSON.stringify({
        warnings: [
          {
            code: "OUTSIDE_VAULT_ASSET",
            message: "Vault 外のファイル参照があるため共有できません",
            sourceRef: "../secret.png",
            severity: "error",
          },
          {
            code: "OUTSIDE_VAULT_LINK",
            message: "Vault 外のファイル参照があるため共有できません",
            sourceRef: "../secret.pdf",
            severity: "error",
          },
        ],
      }),
    );

    expect(formatShareError(error, "fallback")).toBe(
      "Vault 外のファイル参照があるため共有できません: ../secret.png / Vault 外のファイル参照があるため共有できません: ../secret.pdf",
    );
  });

  it("falls back to API error text when warnings are absent", () => {
    const error = new ApiRequestError(
      "/api/shares",
      400,
      JSON.stringify({ error: "Invalid metadata" }),
    );

    expect(formatShareError(error, "fallback")).toBe("Invalid metadata");
  });
});
