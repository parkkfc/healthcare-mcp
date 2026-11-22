/**
 * Google / Kakao OAuth for a stable Hands-On Diet account.
 * The widget opens the authorize URL, then polls finish-oauth until the
 * callback marks the attempt done. ChatGPT openai/subject still wins when
 * present; OAuth is mainly how Claude keeps the same users row across devices.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "./db/client.js";
import * as schema from "./db/schema.js";

export const oauthProviders = schema.oauthProviders;
export type OAuthProvider = (typeof oauthProviders)[number];
export type OAuthAuthMode = (typeof schema.oauthAuthModes)[number];

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export type OAuthEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_CLIENT_SECRET?: string;
  OAUTH_STATE_SECRET?: string;
  PUBLIC_BASE_URL?: string;
};

type ProviderProfile = {
  providerUserId: string;
  email: string;
  displayName: string;
};

const ATTEMPT_TTL_MS = 15 * 60 * 1000;

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (oauthProviders as readonly string[]).includes(value);
}

export function oauthConfigured(
  env: OAuthEnv,
  provider: OAuthProvider,
): boolean {
  if (!env.OAUTH_STATE_SECRET || env.OAUTH_STATE_SECRET.length < 16) return false;
  if (provider === "google") {
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  }
  return Boolean(env.KAKAO_REST_API_KEY);
}

export function oauthPublicBase(env: OAuthEnv, requestUrl?: string): string {
  const fromEnv = env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (requestUrl) {
    const url = new URL(requestUrl);
    return `${url.protocol}//${url.host}`;
  }
  return "https://healthcare-mcp.my-first-mcp-server-gus.workers.dev";
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToBase64Url(sig);
}

async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(secret, message);
  return expected === signature;
}

export async function createLoginAttempt(input: {
  provider: OAuthProvider;
  mode: OAuthAuthMode;
}): Promise<{ attemptId: string; expiresAt: string }> {
  const db = await getDb();
  const attemptId = crypto.randomUUID();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ATTEMPT_TTL_MS).toISOString();
  await db.insert(schema.oauthLoginAttempts).values({
    id: attemptId,
    provider: input.provider,
    status: "pending",
    mode: input.mode,
    userId: null,
    clientAccountKey: null,
    errorMessage: null,
    createdAt,
    expiresAt,
  });
  return { attemptId, expiresAt };
}

function isWidgetAccountKey(value: string): boolean {
  return /^(guest|user)_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Widget-safe key for a users.id that may be a ChatGPT subject. */
export async function clientKeyForUserId(userId: string): Promise<string> {
  if (isWidgetAccountKey(userId)) return userId;
  const db = await getDb();
  const existing = await db
    .select()
    .from(schema.accountAliases)
    .where(eq(schema.accountAliases.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0].clientKey;
  const clientKey = `user_${crypto.randomUUID()}`;
  await db.insert(schema.accountAliases).values({
    clientKey,
    userId,
    createdAt: new Date().toISOString(),
  });
  return clientKey;
}

export async function resolveAlias(clientKey: string): Promise<string> {
  if (!isWidgetAccountKey(clientKey)) return clientKey;
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.accountAliases)
    .where(eq(schema.accountAliases.clientKey, clientKey))
    .limit(1);
  return rows[0]?.userId ?? clientKey;
}

/**
 * After OAuth, keep the pre-login guest_/user_ key working so the host LLM
 * (which may still pass the old key) hits the same logged-in users row.
 */
export async function linkAccountAlias(
  clientKey: string | undefined,
  userId: string,
): Promise<void> {
  const key = clientKey?.trim() ?? "";
  if (!isWidgetAccountKey(key) || !userId || key === userId) return;
  // A key that is itself a logged-in account must never be redirected:
  // the alias would hide that account behind another one for good.
  if ((await listLinkedProviders(key)).length > 0) return;
  const db = await getDb();
  const existing = await db
    .select()
    .from(schema.accountAliases)
    .where(eq(schema.accountAliases.clientKey, key))
    .limit(1);
  if (existing[0]?.userId === userId) return;
  if (existing[0]) {
    await db
      .update(schema.accountAliases)
      .set({ userId })
      .where(eq(schema.accountAliases.clientKey, key));
    return;
  }
  await db.insert(schema.accountAliases).values({
    clientKey: key,
    userId,
    createdAt: new Date().toISOString(),
  });
}

export async function signOAuthState(
  secret: string,
  attemptId: string,
): Promise<string> {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify({ attemptId, ts: Date.now() })),
  );
  const signature = await hmacSign(secret, payload);
  return `${payload}.${signature}`;
}

export async function readOAuthState(
  secret: string,
  state: string,
): Promise<{ attemptId: string } | null> {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  if (!(await hmacVerify(secret, payload, signature))) return null;
  try {
    const raw = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as {
      attemptId?: string;
      ts?: number;
    };
    if (typeof raw.attemptId !== "string" || !raw.attemptId) return null;
    if (typeof raw.ts === "number" && Date.now() - raw.ts > ATTEMPT_TTL_MS) {
      return null;
    }
    return { attemptId: raw.attemptId };
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(input: {
  env: OAuthEnv;
  provider: OAuthProvider;
  state: string;
  baseUrl: string;
}): string {
  const redirectUri = `${input.baseUrl}/auth/${input.provider}/callback`;
  if (input.provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", input.env.GOOGLE_CLIENT_ID!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", input.state);
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("client_id", input.env.KAKAO_REST_API_KEY!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", "profile_nickname,account_email");
  return url.toString();
}

async function exchangeGoogle(
  env: OAuthEnv,
  code: string,
  redirectUri: string,
): Promise<ProviderProfile> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error(`Google 토큰 교환 실패(HTTP ${tokenRes.status})`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("Google access_token이 없습니다.");
  const meRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!meRes.ok) throw new Error(`Google 프로필 조회 실패(HTTP ${meRes.status})`);
  const me = (await meRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
  };
  if (!me.sub) throw new Error("Google 사용자 ID가 없습니다.");
  return {
    providerUserId: me.sub,
    email: me.email?.trim() ?? "",
    displayName: me.name?.trim() ?? "",
  };
}

async function exchangeKakao(
  env: OAuthEnv,
  code: string,
  redirectUri: string,
): Promise<ProviderProfile> {
  const body = new URLSearchParams({
    code,
    client_id: env.KAKAO_REST_API_KEY!,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (env.KAKAO_CLIENT_SECRET) {
    body.set("client_secret", env.KAKAO_CLIENT_SECRET);
  }
  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error(`카카오 토큰 교환 실패(HTTP ${tokenRes.status})`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("카카오 access_token이 없습니다.");
  const meRes = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!meRes.ok) throw new Error(`카카오 프로필 조회 실패(HTTP ${meRes.status})`);
  const me = (await meRes.json()) as {
    id?: number | string;
    kakao_account?: {
      email?: string;
      profile?: { nickname?: string };
    };
  };
  if (me.id == null) throw new Error("카카오 사용자 ID가 없습니다.");
  return {
    providerUserId: String(me.id),
    email: me.kakao_account?.email?.trim() ?? "",
    displayName: me.kakao_account?.profile?.nickname?.trim() ?? "",
  };
}

async function touchUserLogin(
  userId: string,
  provider: OAuthProvider,
  profile: ProviderProfile,
  email: string,
) {
  const db = await getDb();
  const now = new Date().toISOString();
  const nickname = profile.displayName || email.split("@")[0] || "회원";
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(schema.users).values({
      id: userId,
      email,
      displayName: nickname,
      lastAuthProvider: provider,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  // Hands-On Diet display name follows the OAuth nickname.
  await db
    .update(schema.users)
    .set({
      email,
      displayName: nickname,
      lastAuthProvider: provider,
      lastLoginAt: now,
      updatedAt: now,
    })
    .where(eq(schema.users.id, userId));
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const db = await getDb();
  const byUser = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (byUser[0]) return byUser[0].id;

  const byIdentity = await db
    .select({ userId: schema.oauthIdentities.userId })
    .from(schema.oauthIdentities)
    .where(eq(schema.oauthIdentities.email, email))
    .limit(1);
  return byIdentity[0]?.userId ?? null;
}

async function ensureOauthIdentity(input: {
  provider: OAuthProvider;
  profile: ProviderProfile;
  userId: string;
  email: string;
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(schema.oauthIdentities)
    .where(
      and(
        eq(schema.oauthIdentities.provider, input.provider),
        eq(
          schema.oauthIdentities.providerUserId,
          input.profile.providerUserId,
        ),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(schema.oauthIdentities)
      .set({
        userId: input.userId,
        email: input.email,
        displayName: input.profile.displayName || existing[0].displayName,
      })
      .where(eq(schema.oauthIdentities.id, existing[0].id));
    return;
  }
  await db.insert(schema.oauthIdentities).values({
    provider: input.provider,
    providerUserId: input.profile.providerUserId,
    userId: input.userId,
    email: input.email,
    displayName: input.profile.displayName || null,
    createdAt: now,
  });
}

/**
 * Google/Kakao users are keyed by email in Cloudflare D1.
 * signup = create if email is new; login = load if email exists.
 */
async function resolveUserIdForProfile(input: {
  provider: OAuthProvider;
  profile: ProviderProfile;
  mode: OAuthAuthMode;
}): Promise<{ userId: string; isNew: boolean }> {
  const email = normalizeEmail(input.profile.email);
  if (!email) {
    throw new Error(
      "이메일 정보가 없습니다. Google/카카오에서 이메일 제공에 동의해 주세요.",
    );
  }

  const byProvider = await (async () => {
    const db = await getDb();
    const rows = await db
      .select()
      .from(schema.oauthIdentities)
      .where(
        and(
          eq(schema.oauthIdentities.provider, input.provider),
          eq(
            schema.oauthIdentities.providerUserId,
            input.profile.providerUserId,
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  })();

  const byEmail = await findUserIdByEmail(email);
  const knownUserId = byProvider?.userId ?? byEmail;

  if (input.mode === "signup") {
    if (knownUserId) {
      throw new Error(
        "이미 가입된 이메일입니다. 로그인 탭에서 같은 Google/카카오로 들어와 주세요.",
      );
    }
    const userId = `user_${crypto.randomUUID()}`;
    await touchUserLogin(userId, input.provider, input.profile, email);
    await ensureOauthIdentity({
      provider: input.provider,
      profile: input.profile,
      userId,
      email,
    });
    return { userId, isNew: true };
  }

  if (!knownUserId) {
    throw new Error(
      "가입된 계정이 없습니다. 회원가입 탭에서 먼저 가입해 주세요.",
    );
  }

  await touchUserLogin(knownUserId, input.provider, input.profile, email);
  await ensureOauthIdentity({
    provider: input.provider,
    profile: input.profile,
    userId: knownUserId,
    email,
  });
  return { userId: knownUserId, isNew: false };
}

export async function completeOAuthCallback(input: {
  env: OAuthEnv;
  provider: OAuthProvider;
  code: string;
  state: string;
  baseUrl: string;
}): Promise<
  | { ok: true; userId: string; isNew: boolean }
  | { ok: false; message: string }
> {
  const secret = input.env.OAUTH_STATE_SECRET;
  if (!secret || !oauthConfigured(input.env, input.provider)) {
    return { ok: false, message: "OAuth가 아직 설정되지 않았습니다." };
  }
  const parsed = await readOAuthState(secret, input.state);
  if (!parsed) return { ok: false, message: "로그인 상태가 만료되었거나 위조되었습니다." };

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.oauthLoginAttempts)
    .where(eq(schema.oauthLoginAttempts.id, parsed.attemptId))
    .limit(1);
  const attempt = rows[0];
  if (!attempt) return { ok: false, message: "로그인 시도를 찾지 못했습니다." };
  if (attempt.provider !== input.provider) {
    return { ok: false, message: "로그인 제공자가 일치하지 않습니다." };
  }
  if (attempt.status === "done" && attempt.userId) {
    return { ok: true, userId: attempt.userId, isNew: false };
  }
  if (Date.parse(attempt.expiresAt) < Date.now()) {
    await db
      .update(schema.oauthLoginAttempts)
      .set({ status: "error", errorMessage: "로그인 시간이 지났습니다." })
      .where(eq(schema.oauthLoginAttempts.id, attempt.id));
    return { ok: false, message: "로그인 시간이 지났습니다. 다시 시도해 주세요." };
  }

  try {
    const redirectUri = `${input.baseUrl}/auth/${input.provider}/callback`;
    const profile =
      input.provider === "google"
        ? await exchangeGoogle(input.env, input.code, redirectUri)
        : await exchangeKakao(input.env, input.code, redirectUri);
    const mode =
      attempt.mode === "signup" || attempt.mode === "login"
        ? attempt.mode
        : "login";
    const resolved = await resolveUserIdForProfile({
      provider: input.provider,
      profile,
      mode,
    });
    const clientAccountKey = await clientKeyForUserId(resolved.userId);
    await db
      .update(schema.oauthLoginAttempts)
      .set({
        status: "done",
        userId: resolved.userId,
        clientAccountKey,
        errorMessage: null,
      })
      .where(eq(schema.oauthLoginAttempts.id, attempt.id));
    return { ok: true, userId: resolved.userId, isNew: resolved.isNew };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "로그인에 실패했습니다.";
    await db
      .update(schema.oauthLoginAttempts)
      .set({ status: "error", errorMessage: message })
      .where(eq(schema.oauthLoginAttempts.id, attempt.id));
    return { ok: false, message };
  }
}

export async function readLoginAttempt(attemptId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.oauthLoginAttempts)
    .where(eq(schema.oauthLoginAttempts.id, attemptId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listLinkedProviders(userId: string) {
  const db = await getDb();
  const rows = await db
    .select({
      provider: schema.oauthIdentities.provider,
      email: schema.oauthIdentities.email,
      displayName: schema.oauthIdentities.displayName,
    })
    .from(schema.oauthIdentities)
    .where(eq(schema.oauthIdentities.userId, userId));
  return rows;
}

/** True when Google/Kakao is linked to this users.id (or its alias target). */
export async function hasOAuthLogin(userId: string): Promise<boolean> {
  const realId = await resolveAlias(userId);
  const linked = await listLinkedProviders(realId);
  if (linked.length > 0) return true;
  if (realId !== userId) {
    const own = await listLinkedProviders(userId);
    return own.length > 0;
  }
  return false;
}

export function oauthDoneHtml(ok: boolean, message: string): string {
  const title = ok ? "로그인 완료" : "로그인 실패";
  const color = ok ? "#16a34a" : "#dc2626";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · Hands-On Diet</title>
  <style>
    body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#fafafa}
    .card{max-width:26rem;padding:1.5rem;border:1px solid #27272a;border-radius:1rem;background:#18181b}
    h1{margin:0 0 .5rem;font-size:1.25rem;color:${color}}
    p{margin:0;line-height:1.5;color:#a1a1aa}
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
