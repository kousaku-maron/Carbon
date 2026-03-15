export type ShareStatus = "active" | "revoked";
export type ShareSourceNoteStatus = "linked" | "missing";

export type ShareSummary = {
  id: string;
  title: string;
  slug: string;
  shareToken: string;
  publicUrl: string;
  status: ShareStatus;
  sourceVaultPath: string;
  sourceVaultName: string;
  sourceNotePath: string;
  currentRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export type ShareWarning = {
  code: string;
  message: string;
  sourceRef: string;
  severity: "info" | "warning" | "error";
};

export type ShareLinkManifestItem = {
  href: string;
  kind: "note-link" | "file-link" | "external-link";
  targetNotePath?: string | null;
  publicUrl?: string | null;
};

export type ShareAssetManifestItem = {
  clientAssetId: string;
  kind: "image" | "video" | "pdf" | "file";
  sourceType: "local-file" | "carbon-asset";
  sourceRef: string;
  mimeType: string;
  title?: string | null;
  uploadField?: string;
};

export type ShareMetadata = {
  title?: string;
  slug?: string;
  sourceVaultPath: string;
  sourceVaultName: string;
  sourceNotePath: string;
  markdownBody: string;
  linkManifest: ShareLinkManifestItem[];
  assetManifest: ShareAssetManifestItem[];
  warnings: ShareWarning[];
};

export type ShareAnalysis = {
  metadata: ShareMetadata;
  localUploads: Array<{
    fieldName: string;
    absolutePath: string;
    fileName: string;
    mimeType: string;
  }>;
};

export type ShareDetail = {
  share: ShareSummary;
  latestRevision: {
    id: string;
    createdAt: string;
    summary: {
      warnings?: ShareWarning[];
      assets?: unknown[];
      links?: ShareLinkManifestItem[];
    };
  } | null;
  assets: Array<{
    id: string;
    kind: string;
    sourceType: string;
    sourceRef: string;
    title: string | null;
    mimeType: string;
    publicUrl: string;
  }>;
};

export type ShareMutationResult = {
  share: ShareSummary;
  revision: {
    id: string;
    assetCount: number;
    warningCount: number;
  };
};
