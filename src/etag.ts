/**
 * 15-minute etags for update/delete tools.
 *
 * A read tool issues `<issuedAt base36>.<HMAC>` for one row. The HMAC covers
 * the resource name, row id, row version and issue time, signed with the
 * user's own key. Update/delete tools recompute it against the row as it is
 * now, so an etag stops working when it is older than 15 minutes, when the row
 * changed after it was issued, or when it was made up.
 */

export const ETAG_TTL_MS = 15 * 60 * 1000;

export type EtagResource = "meal_log" | "workout_log";

export type EtagCheck = "ok" | "missing" | "expired" | "mismatch";

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function payload(
  resource: EtagResource,
  rowId: number,
  version: string,
  issuedAt: number,
): string {
  return `${resource}|${rowId}|${version}|${issuedAt}`;
}

export async function issueEtag(
  secret: string,
  resource: EtagResource,
  rowId: number,
  version: string,
  now: number = Date.now(),
): Promise<string> {
  const signature = await sign(secret, payload(resource, rowId, version, now));
  return `${now.toString(36)}.${signature}`;
}

export async function checkEtag(
  secret: string,
  resource: EtagResource,
  rowId: number,
  version: string,
  etag: string | undefined,
  now: number = Date.now(),
): Promise<EtagCheck> {
  if (!etag || etag.trim().length === 0) return "missing";
  const [issuedPart, signature] = etag.trim().split(".");
  if (!issuedPart || !signature) return "mismatch";
  const issuedAt = Number.parseInt(issuedPart, 36);
  if (!Number.isFinite(issuedAt)) return "mismatch";
  const expected = await sign(
    secret,
    payload(resource, rowId, version, issuedAt),
  );
  if (expected !== signature) return "mismatch";
  if (now - issuedAt > ETAG_TTL_MS || issuedAt > now + 60_000) return "expired";
  return "ok";
}
