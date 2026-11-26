import "@/index.css";

import { useEffect, useState } from "react";
import { useSendFollowUpMessage, useUser } from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { bumpProfile } from "../hooks/profile-sync.js";
import { useAccountKey } from "./use-account-key.js";
import { useAssistantContext } from "../hooks/use-assistant-context.js";

export default function SetDisplayName() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"set-display-name">();
  const { callTool, isPending, isError } = useCallTool("save-display-name");
  const {
    callTool: loadUser,
    isPending: isLoading,
  } = useCallTool("get-user");
  const sendMessage = useSendFollowUpMessage();
  const preferred =
    toolInfo.isSuccess && toolInfo.output.accountKey
      ? toolInfo.output.accountKey
      : undefined;
  const accountKey = useAccountKey(preferred);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [nextSent, setNextSent] = useState(false);

  useEffect(() => {
    if (!toolInfo.isSuccess || hydrated) return;
    loadUser(
      { accountKey },
      {
        onSuccess: (result) => {
          const profile = result.structuredContent;
          if (profile?.nameSaved && profile.displayName) {
            setSavedName(profile.displayName);
          }
          setHydrated(true);
        },
        onError: () => setHydrated(true),
      },
    );
  }, [toolInfo.isSuccess, hydrated, accountKey, loadUser]);

  useAssistantContext(
    JSON.stringify({
      name,
      savedName,
      saved: savedName.length > 0,
      accountKey,
      nameSaved: savedName.length > 0,
    }),
  );

  useEffect(() => {
    if (!savedName || nextSent) return;
    setNextSent(true);
    void sendMessage("이름이 있어요. 다음 단계로 이어 주세요.").catch(
      () => undefined,
    );
  }, [savedName, nextSent, sendMessage]);

  if (!toolInfo.isSuccess) return null;

  if (!hydrated || isLoading) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} p-4 bg-background text-foreground rounded-xl border border-border`}
      >
        저장된 이름을 확인하는 중…
      </div>
    );
  }

  if (savedName) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} p-4 bg-background text-foreground rounded-xl border border-border`}
      >
        <h2 className="text-lg font-bold">이름이 이미 있어요</h2>
        <p className="mt-2 text-sm">
          {savedName}님으로 저장되어 있습니다. 다시 적을 필요 없어요.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          모르는 게 있을 때는 `홈화면`을 검색해 보세요.
        </p>
      </div>
    );
  }

  return (
    <form
      className={`${theme === "dark" ? "dark" : ""} p-4 bg-background text-foreground rounded-xl border border-border`}
      onSubmit={(event) => {
        event.preventDefault();
        if (isPending || name.trim().length === 0) return;
        callTool(
          { name, accountKey },
          {
            onSuccess: (result) => {
              if (result.structuredContent?.saved) {
                setSavedName(result.structuredContent.displayName);
                bumpProfile();
              }
            },
          },
        );
      }}
    >
      <h2 className="text-lg font-bold">이름을 정해 주세요</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        트레이너가 이 이름으로 부릅니다. 1~16자이고, 계정 번호는 아닙니다.
      </p>
      <label className="mb-3 block text-sm">
        이름
        <input
          type="text"
          maxLength={16}
          value={name}
          placeholder="이름"
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
        />
      </label>
      <button
        type="submit"
        disabled={isPending || name.trim().length === 0}
        className="w-full rounded-lg bg-blue-600 py-3 font-bold text-white"
      >
        {isPending ? "저장 중..." : "이 이름으로 저장"}
      </button>
      {isError ? (
        <p className="mt-2 text-sm text-red-600">
          저장하지 못했습니다. 이름을 확인하고 한 번 더 눌러 주세요.
        </p>
      ) : null}
    </form>
  );
}
