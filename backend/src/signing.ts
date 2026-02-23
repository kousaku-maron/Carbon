/**
 * HMAC-SHA256 based signed URL generation and verification for asset delivery.
 *
 * Signature payload: `${assetId}:${ownerUserId}:${exp}`
 * URL format: /api/assets/:assetId/raw?exp=<unix_seconds>&sig=<hex>
 */

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes
const MIN_SIGNING_SECRET_LENGTH = 32;

function normalizeAndValidateSigningSecret(secret: string): string {
  const normalized = (secret || "").trim();
  if (normalized.length < MIN_SIGNING_SECRET_LENGTH) {
    throw new Error(
      `ASSET_SIGNING_SECRET must be set and at least ${MIN_SIGNING_SECRET_LENGTH} characters`,
    );
  }
  return normalized;
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const validatedSecret = normalizeAndValidateSigningSecret(secret);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(validatedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSignedUrl(
  baseUrl: string,
  assetId: string,
  ownerUserId: string,
  secret: string,
): Promise<{ url: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const payload = `${assetId}:${ownerUserId}:${exp}`;
  const sig = await hmacSign(secret, payload);

  const url = `${baseUrl}/api/assets/${assetId}/raw?exp=${exp}&sig=${sig}`;
  const expiresAt = new Date(exp * 1000).toISOString();
  return { url, expiresAt };
}

export async function verifySignature(
  assetId: string,
  ownerUserId: string,
  exp: string,
  sig: string,
  secret: string,
): Promise<boolean> {
  const expNum = parseInt(exp, 10);
  if (isNaN(expNum)) return false;

  // Check expiry
  if (Math.floor(Date.now() / 1000) > expNum) return false;

  const payload = `${assetId}:${ownerUserId}:${expNum}`;
  const expectedSig = await hmacSign(secret, payload);

  // Constant-time comparison
  if (sig.length !== expectedSig.length) return false;
  const a = new TextEncoder().encode(sig);
  const b = new TextEncoder().encode(expectedSig);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
