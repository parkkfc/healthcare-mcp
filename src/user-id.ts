import { z } from "zod";

/** Claude guest device key, or Google/Kakao login key. */
const accountKeyPattern =
  /^(guest|user)_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const accountKeySchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z
    .string()
    .regex(accountKeyPattern)
    .optional()
    .describe(
      "openai/subject가 없을 때만 넣는다. 홈·로그인 카드가 준 guest_ 또는 user_ UUID를 그대로 쓴다. ChatGPT에서는 생략한다. 사용자에게 묻거나 지어내지 않는다.",
    ),
);

export function normalizeAccountKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim();
  return accountKeyPattern.test(key) ? key : undefined;
}

export function hostUserId(extra: {
  mcpReq?: { _meta?: { "openai/subject"?: string } };
  http?: { authInfo?: { extra?: { subject?: string } } };
  authInfo?: { extra?: { subject?: string } };
}): string | undefined {
  const subject = extra.mcpReq?._meta?.["openai/subject"];
  if (typeof subject === "string" && subject.length > 0) return subject;
  const authSubject =
    extra.http?.authInfo?.extra?.subject ?? extra.authInfo?.extra?.subject;
  if (typeof authSubject === "string" && authSubject.length > 0) {
    return authSubject;
  }
  return undefined;
}

export function resolveUserId(
  extra: {
    mcpReq?: { _meta?: { "openai/subject"?: string } };
    http?: { authInfo?: { extra?: { subject?: string } } };
    authInfo?: { extra?: { subject?: string } };
  },
  accountKey?: string,
): string | undefined {
  return hostUserId(extra) ?? normalizeAccountKey(accountKey);
}

/**
 * Like resolveUserId, but maps OAuth widget aliases (user_ → host subject).
 * Use in tool handlers that touch D1. Sync path stays for hosts with subject.
 */
export async function resolveUserIdAsync(
  extra: {
    mcpReq?: { _meta?: { "openai/subject"?: string } };
    http?: { authInfo?: { extra?: { subject?: string } } };
    authInfo?: { extra?: { subject?: string } };
  },
  accountKey?: string,
): Promise<string | undefined> {
  const host = hostUserId(extra);
  if (host) return host;
  const key = normalizeAccountKey(accountKey);
  if (!key) return undefined;
  const { resolveAlias } = await import("./oauth.js");
  return resolveAlias(key);
}

export function missingUserIdContent() {
  return {
    content: [
      {
        type: "text" as const,
        text: "사용자 번호를 받지 못했습니다. Claude에서는 카드가 준 accountKey를 도구에 다시 넘겨 주세요.",
      },
    ],
    isError: true as const,
  };
}
