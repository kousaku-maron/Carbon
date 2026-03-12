function readBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

export const ENABLE_CLOUD_IMAGE_UPLOAD = readBooleanEnv(
  import.meta.env.VITE_ENABLE_CLOUD_IMAGE_UPLOAD,
  false,
);
