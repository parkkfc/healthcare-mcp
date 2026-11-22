/**
 * One answer to "who is this, and are they logged in?" for every tool.
 *
 * ChatGPT sends openai/subject, so the server knows the user. Claude sends
 * nothing: the widget keeps the logged-in key in localStorage, and the host
 * LLM only knows what tool results tell it. open-home therefore hands the
 * model a conversation key, and the widget links that key to the device's
 * login. After that the model and the widget resolve to the same users row.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db/client.js";
import * as schema from "./db/schema.js";
import {
  linkAccountAlias,
  listLinkedProviders,
  resolveAlias,
} from "./oauth.js";
import { hostUserId, normalizeAccountKey } from "./user-id.js";

type HostExtra = Parameters<typeof hostUserId>[0];

export type Identity =
  /** Host subject, or a key that resolves to a Google/Kakao account. */
  | { state: "ready"; userId: string }
  /** The widget has answered for this key and the device is not logged in. */
  | { state: "login"; userId: string }
  /** A conversation key the widget has not answered for yet. */
  | { state: "pending"; userId: string }
  /** No key at all, so login state cannot be known. */
  | { state: "unknown" };

/** How long a tool waits for the widget to link a fresh conversation key. */
const CLAIM_WAIT_MS = 8000;
const CLAIM_POLL_MS = 500;
/** A key nobody claimed within this window is treated as not logged in. */
const CLAIM_WINDOW_MS = 2 * 60 * 1000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function mintConversationKey(): string {
  return `guest_${crypto.randomUUID()}`;
}

async function isAwaitingClaim(key: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.conversationKeys)
    .where(eq(schema.conversationKeys.key, key))
    .limit(1);
  const row = rows[0];
  if (!row || row.claimedAt) return false;
  return Date.now() - Date.parse(row.createdAt) < CLAIM_WINDOW_MS;
}

/**
 * Resolve the caller. With `wait`, a conversation key that open-home just
 * issued gets a few seconds for the widget to link it, because the model
 * often calls the next tool before the home card has finished loading.
 */
export async function identify(
  extra: HostExtra,
  accountKey: string | undefined,
  options?: { wait?: boolean },
): Promise<Identity> {
  const host = hostUserId(extra);
  if (host) return { state: "ready", userId: host };
  const key = normalizeAccountKey(accountKey);
  if (!key) return { state: "unknown" };
  const deadline = Date.now() + (options?.wait ? CLAIM_WAIT_MS : 0);
  for (;;) {
    const userId = await resolveAlias(key);
    if ((await listLinkedProviders(userId)).length > 0) {
      return { state: "ready", userId };
    }
    if (!(await isAwaitingClaim(key))) return { state: "login", userId };
    if (Date.now() >= deadline) return { state: "pending", userId };
    await sleep(CLAIM_POLL_MS);
  }
}

/** Record that the model now holds this key and the widget must answer for it. */
export async function markConversationKeyPending(key: string): Promise<void> {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  await db
    .insert(schema.conversationKeys)
    .values({ key, createdAt, claimedAt: null })
    .onConflictDoUpdate({
      target: schema.conversationKeys.key,
      set: { createdAt, claimedAt: null },
    });
}

/**
 * The widget answers for a conversation key with the key stored on the device.
 * A logged-in device links the conversation key to its account; either way the
 * key is marked claimed so tools stop waiting.
 */
export async function claimConversationKey(input: {
  conversationKey: string | undefined;
  deviceKey: string | undefined;
}): Promise<{ linked: boolean; loginSaved: boolean }> {
  const conversationKey = normalizeAccountKey(input.conversationKey);
  const deviceKey = normalizeAccountKey(input.deviceKey);
  if (!conversationKey || !deviceKey) {
    return { linked: false, loginSaved: false };
  }
  const deviceUserId = await resolveAlias(deviceKey);
  const loginSaved = (await listLinkedProviders(deviceUserId)).length > 0;
  // Link before marking claimed: a waiting tool must see the alias first.
  if (loginSaved) await linkAccountAlias(conversationKey, deviceUserId);
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .insert(schema.conversationKeys)
    .values({ key: conversationKey, createdAt: now, claimedAt: now })
    .onConflictDoUpdate({
      target: schema.conversationKeys.key,
      set: { claimedAt: now },
    });
  const linked =
    loginSaved && (await resolveAlias(conversationKey)) === deviceUserId;
  return { linked, loginSaved };
}

/** What to tell the user and the model when the caller is not ready. */
export function identityProblem(identity: Exclude<Identity, { state: "ready" }>): {
  shown: string;
  model: string;
} {
  if (identity.state === "unknown") {
    return {
      shown: "계정을 확인하려면 홈 화면을 먼저 열어야 해요.",
      model:
        "identityUnknown=true. accountKey 없이 호출되어 로그인 여부를 알 수 없다. 로그인이 안 된 것이 아니다. open-home을 호출하고, 그 결과에 적힌 accountKey를 넣어 이 도구를 다시 호출하라. 사용자에게 로그인하라고 말하지 마라.",
    };
  }
  if (identity.state === "pending") {
    return {
      shown:
        "홈 카드가 계정을 확인하는 중이에요. 홈 카드가 보이면 한 번 더 말씀해 주세요.",
      model:
        "identityPending=true. 홈 위젯이 아직 이 accountKey를 이 기기의 로그인에 연결하지 못했다. 로그인이 안 됐다고 단정하지 마라. 같은 accountKey로 다시 호출하고, 홈 카드가 떠 있지 않으면 open-home을 다시 호출하라.",
    };
  }
  return {
    shown:
      "이 기기는 아직 로그인 전이에요. 홈 카드에서 Google 또는 카카오로 로그인해 주세요.",
    model:
      "loginRequired=true. 홈 위젯도 같은 상태(로그인 필요)를 보여 준다. open-home을 intent login으로 호출해 로그인 카드를 띄워라. 로그인 전에는 이름·말투·손·인바디를 저장하지 않는다.",
  };
}
