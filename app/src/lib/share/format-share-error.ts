import { ApiRequestError } from "../api/client";
import type { ShareWarning } from "./types";

type ShareErrorPayload = {
  error?: string;
  warnings?: ShareWarning[];
};

export function formatShareError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) {
    return error instanceof Error ? error.message : fallback;
  }

  try {
    const payload = JSON.parse(error.body) as ShareErrorPayload;
    if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
      return payload.warnings
        .map((warning) => `${warning.message}: ${warning.sourceRef}`)
        .join(" / ");
    }
    if (payload.error) return payload.error;
  } catch {
    // fall through
  }

  return error.body || fallback;
}
