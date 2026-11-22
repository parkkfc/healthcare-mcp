import { useEffect, useRef, useState } from "react";
import { useCallTool } from "@/helpers.js";
import { isAccountKey } from "./use-account-key.js";

/**
 * The host LLM holds the key open-home / open-login gave it; this device
 * holds the logged-in key in localStorage. Tell the server they belong
 * together, so the model's saves land in the account the card shows.
 *
 * Returns true once the server has answered (or nothing needs linking).
 * Runs again whenever either key changes, e.g. right after login.
 */
export function useClaimConversationKey(
  conversationKey: string | undefined,
  accountKey: string,
): boolean {
  const { callToolAsync } = useCallTool("link-account-key");
  const callRef = useRef(callToolAsync);
  callRef.current = callToolAsync;
  const pair =
    isAccountKey(conversationKey) && isAccountKey(accountKey)
      ? `${conversationKey.trim()}|${accountKey}`
      : "";
  const [donePair, setDonePair] = useState("");

  useEffect(() => {
    if (!pair) return;
    const [key, deviceKey] = pair.split("|");
    let cancelled = false;
    void callRef
      .current({ conversationKey: key, accountKey: deviceKey })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setDonePair(pair);
      });
    return () => {
      cancelled = true;
    };
  }, [pair]);

  return pair.length === 0 || donePair === pair;
}
