import { useEffect, useRef, useState } from "react";
import { useViewState } from "skybridge/web";

const STORAGE_KEY = "hands-on-diet-account-key";
const guestKeyPattern =
  /^guest_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const oauthUserKeyPattern =
  /^user_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAccountKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestKeyPattern.test(value.trim()) || oauthUserKeyPattern.test(value.trim()))
  );
}

/** @deprecated Use isAccountKey. Kept for older imports. */
export function isGuestAccountKey(value: unknown): value is string {
  return isAccountKey(value);
}

function readStorage(): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const existing = localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    return isAccountKey(existing) ? existing : undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(key: string) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Claude iframe may block storage; view state still keeps the key.
  }
}

function createAccountKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `guest_${crypto.randomUUID()}`;
  }
  return `guest_00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;
}

/** Wipe the local session and mint a fresh Claude guest key (logout). */
export function createFreshAccountKey(): string {
  const next = createAccountKey();
  writeStorage(next);
  return next;
}

/**
 * Prefer an OAuth `user_` key when the server returns one after login.
 * Otherwise keep the Claude `guest_` key in localStorage + view state.
 * ChatGPT ignores this and uses openai/subject on the server.
 * Pass a rising `replaceToken` to force a guest key after logout.
 */
export function useAccountKey(
  preferred?: string,
  options?: { replaceToken?: number },
) {
  const replaceToken = options?.replaceToken ?? 0;
  const lastReplace = useRef(0);
  const [persisted, setPersisted] = useViewState<{ accountKey: string }>({
    accountKey: "",
  });
  const [accountKey, setAccountKey] = useState(() => {
    if (isAccountKey(preferred)) {
      writeStorage(preferred.trim());
      return preferred.trim();
    }
    if (isAccountKey(persisted.accountKey)) {
      writeStorage(persisted.accountKey);
      return persisted.accountKey;
    }
    const stored = readStorage();
    if (stored) return stored;
    const next = createAccountKey();
    writeStorage(next);
    return next;
  });

  useEffect(() => {
    writeStorage(accountKey);
    if (persisted.accountKey !== accountKey) {
      setPersisted({ accountKey });
    }
  }, [accountKey, persisted.accountKey, setPersisted]);

  useEffect(() => {
    if (!isAccountKey(preferred)) return;
    const next = preferred.trim();
    if (replaceToken > lastReplace.current) {
      lastReplace.current = replaceToken;
      writeStorage(next);
      setAccountKey(next);
      return;
    }
    if (next === accountKey) return;
    // OAuth user_ always wins over a local guest_ key.
    if (next.startsWith("user_") || !accountKey.startsWith("user_")) {
      writeStorage(next);
      setAccountKey(next);
    }
  }, [preferred, accountKey, replaceToken]);

  return accountKey;
}
