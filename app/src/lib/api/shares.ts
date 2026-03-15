import { request } from "./client";
import type { ShareDetail, ShareMutationResult, ShareSummary } from "../share/types";

type ListSharesOptions = {
  status?: "active" | "revoked" | "all";
  sourceVaultPath?: string;
  sourceNotePath?: string;
};

export async function listShares(options: ListSharesOptions = {}): Promise<ShareSummary[]> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.sourceVaultPath) params.set("sourceVaultPath", options.sourceVaultPath);
  if (options.sourceNotePath) params.set("sourceNotePath", options.sourceNotePath);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const result = await request<{ items: ShareSummary[] }>(`/api/shares${suffix}`);
  return result.items;
}

export async function getShare(shareId: string): Promise<ShareDetail> {
  return request<ShareDetail>(`/api/shares/${encodeURIComponent(shareId)}`);
}

export async function createShare(formData: FormData): Promise<ShareMutationResult> {
  return request<ShareMutationResult>("/api/shares", {
    method: "POST",
    body: formData,
    timeout: 60_000,
  });
}

export async function republishShare(
  shareId: string,
  formData: FormData,
): Promise<ShareMutationResult> {
  return request<ShareMutationResult>(`/api/shares/${encodeURIComponent(shareId)}/republish`, {
    method: "POST",
    body: formData,
    timeout: 60_000,
  });
}

export async function revokeShare(shareId: string): Promise<{ ok: boolean; status: string }> {
  return request<{ ok: boolean; status: string }>(
    `/api/shares/${encodeURIComponent(shareId)}/revoke`,
    {
      method: "POST",
      body: "{}",
    },
  );
}
