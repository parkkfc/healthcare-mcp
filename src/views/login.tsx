import "@/index.css";

import { useEffect, useRef, useState } from "react";
import {
  useModelContext,
  useOpenExternal,
  useSendFollowUpMessage,
  useUser,
} from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { bumpProfile } from "../hooks/profile-sync.js";
import { useAccountKey } from "./use-account-key.js";
import { useClaimConversationKey } from "./use-claim-conversation-key.js";

type Provider = "google" | "kakao";
type AuthMode = "signup" | "login";

export type LoginData = Extract<
  ReturnType<typeof useToolInfo<"open-login">>,
  { isSuccess: true }
>["output"];

export function LoginPanel({
  data,
  theme,
  accountKey,
  onAccountKey,
  onSignedIn,
}: {
  data: LoginData;
  theme: string;
  accountKey: string;
  onAccountKey?: (key: string) => void;
  /** Fired once OAuth finishes so the host can open home immediately. */
  onSignedIn?: (accountKey: string) => void;
}) {
  const openExternal = useOpenExternal();
  const { callToolAsync: startOAuth, isPending: starting } =
    useCallTool("start-oauth");
  const { callToolAsync: finishOAuth } = useCallTool("finish-oauth");
  const [mode, setMode] = useState<AuthMode>("login");
  const [attemptId, setAttemptId] = useState("");
  const [provider, setProvider] = useState<Provider | "">("");
  const [notice, setNotice] = useState("");
  const [linked, setLinked] = useState(data.linked);
  const [signedIn, setSignedIn] = useState(data.signedIn);
  const [displayName, setDisplayName] = useState(
    data.cloudProfile?.displayName?.trim() ?? "",
  );
  const [email, setEmail] = useState(
    data.cloudProfile?.email?.trim() ?? "",
  );
  const [activeKey, setActiveKey] = useState(accountKey);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    setLinked(data.linked);
    setSignedIn(data.signedIn);
    setDisplayName(data.cloudProfile?.displayName?.trim() ?? "");
    setEmail(data.cloudProfile?.email?.trim() ?? "");
  }, [
    data.linked,
    data.signedIn,
    data.cloudProfile?.displayName,
    data.cloudProfile?.email,
  ]);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  async function begin(next: Provider) {
    setNotice("");
    setProvider(next);
    try {
      const result = await startOAuth({
        provider: next,
        mode,
        accountKey: activeKey || undefined,
      });
      const out = result.structuredContent;
      if (!out?.ok || !out.authorizeUrl || !out.attemptId) {
        setNotice(out?.message || "로그인을 시작하지 못했습니다.");
        return;
      }
      setAttemptId(out.attemptId);
      setNotice(
        mode === "signup"
          ? "가입 창을 열었습니다. 끝나면 이 카드로 돌아와 주세요. 이메일 제공에 동의해 주세요."
          : "로그인 창을 열었습니다. 끝나면 이 카드로 돌아와 주세요. 자동으로 이어집니다.",
      );
      openExternal(out.authorizeUrl, { redirectUrl: false });
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(() => {
        void poll(out.attemptId);
      }, 2000);
    } catch (error) {
      setNotice(
        error instanceof Error && error.message
          ? error.message
          : "로그인을 시작하지 못했습니다.",
      );
    }
  }

  async function poll(id: string) {
    try {
      const result = await finishOAuth({ attemptId: id, accountKey: activeKey });
      const out = result.structuredContent;
      if (!out) return;
      if (out.status === "pending") return;
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (out.status === "done" && out.accountKey) {
        setSignedIn(true);
        setLinked(out.linked ?? linked);
        setActiveKey(out.accountKey);
        onAccountKey?.(out.accountKey);
        const cloudName = out.cloudProfile?.displayName?.trim() ?? "";
        const cloudEmail = out.cloudProfile?.email?.trim() ?? "";
        if (cloudName) setDisplayName(cloudName);
        if (cloudEmail) setEmail(cloudEmail);
        setNotice(
          out.message ||
            (cloudName
              ? `'${cloudName}' 기록을 불러왔습니다.`
              : "계정을 저장했습니다."),
        );
        bumpProfile();
        setAttemptId("");
        setProvider("");
        onSignedIn?.(out.accountKey);
        return;
      }
      setNotice(out.message || "로그인에 실패했습니다. 다시 눌러 주세요.");
      setAttemptId("");
      setProvider("");
    } catch {
      // Keep polling through transient widget errors.
    }
  }

  const actionLabel = mode === "signup" ? "가입" : "로그인";

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} space-y-3 rounded-xl border border-border bg-background p-4 text-foreground`}
    >
      <div>
        <h2 className="text-lg font-bold">계정 {actionLabel}</h2>
        <p className="text-sm text-muted-foreground">
          Google·카카오 이메일로 계정을 구분합니다. 가입 때 받은 닉네임이
          Hands-On Diet 이름이 됩니다.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-border p-1">
        <button
          type="button"
          disabled={Boolean(attemptId)}
          onClick={() => setMode("login")}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
            mode === "login"
              ? "bg-foreground text-background"
              : "text-muted-foreground"
          }`}
        >
          로그인
        </button>
        <button
          type="button"
          disabled={Boolean(attemptId)}
          onClick={() => setMode("signup")}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
            mode === "signup"
              ? "bg-foreground text-background"
              : "text-muted-foreground"
          }`}
        >
          회원가입
        </button>
      </div>

      {signedIn ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
          계정 연결됨
          {linked.length > 0
            ? ` · ${linked
                .map((item) =>
                  item.provider === "google" ? "Google" : "카카오",
                )
                .join(", ")}`
            : ""}
          {displayName ? ` · ${displayName}` : ""}
          {email ? ` · ${email}` : ""}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {mode === "signup"
            ? "처음이면 회원가입을 고른 뒤 Google/카카오로 이메일을 연결하세요."
            : "이미 가입했다면 로그인으로 같은 이메일 기록을 불러오세요."}
        </p>
      )}

      {!data.googleReady && !data.kakaoReady ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          서버에 Google/카카오 앱 키가 아직 없습니다. 관리자가 콘솔에서 클라이언트
          ID를 등록한 뒤 다시 열어 주세요.
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={!data.googleReady || starting || Boolean(attemptId)}
            onClick={() => void begin("google")}
            className="rounded-lg bg-[#4285F4] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {provider === "google" && attemptId
              ? `Google ${actionLabel} 확인 중…`
              : `Google로 ${actionLabel}`}
          </button>
          <button
            type="button"
            disabled={!data.kakaoReady || starting || Boolean(attemptId)}
            onClick={() => void begin("kakao")}
            className="rounded-lg bg-[#FEE500] px-4 py-3 text-sm font-bold text-[#191919] disabled:opacity-50"
          >
            {provider === "kakao" && attemptId
              ? `카카오 ${actionLabel} 확인 중…`
              : `카카오로 ${actionLabel}`}
          </button>
        </div>
      )}

      {notice ? <p className="text-sm">{notice}</p> : null}

      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "login",
          mode,
          signedIn,
          linkedProviders: linked.map((item) => item.provider),
          displayName,
          email,
          accountKey:
            activeKey.startsWith("guest_") || activeKey.startsWith("user_")
              ? activeKey
              : "",
          waiting: Boolean(attemptId),
        })}
      />
    </div>
  );
}

export default function Login() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"open-login">();
  if (!toolInfo.isSuccess) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} rounded-xl border border-border bg-background p-4 text-foreground`}
      >
        <p className="text-sm text-muted-foreground">
          로그인 카드를 불러오는 중…
        </p>
      </div>
    );
  }
  return <LoginLoaded data={toolInfo.output} theme={theme} />;
}

function LoginLoaded({ data, theme }: { data: LoginData; theme: string }) {
  const [preferred, setPreferred] = useState(data.accountKey || "");
  const accountKey = useAccountKey(preferred || undefined);
  // The model holds data.conversationKey; link it to this device's login.
  useClaimConversationKey(data.conversationKey, accountKey);
  const { callToolAsync: openHome } = useCallTool("open-home");
  const { callToolAsync: linkKey } = useCallTool("link-account-key");
  const sendMessage = useSendFollowUpMessage();
  const { update } = useModelContext();
  const homeOpened = useRef(false);

  function goHome(key: string) {
    if (homeOpened.current) return;
    homeOpened.current = true;
    setPreferred(key);
    // Keep accountKey out of visible chat; some hosts ignore audience:assistant on follow-ups.
    void update({
      content: [
        {
          type: "text",
          text: `loginDone=true. loginRequired=false. accountKey=${key}. 다시 로그인·가입을 요구하지 마세요. 이 accountKey로 홈·인바디(save-inbody) 등 다음 설정을 이어가세요.`,
          annotations: { audience: ["assistant"] },
        },
      ],
    }).catch(() => undefined);
    void sendMessage("로그인 완료. 홈으로 이어갈게요.").catch(() => undefined);
    void (async () => {
      // Link before leaving this card: open-home may replace the iframe.
      if (data.conversationKey) {
        await linkKey({
          conversationKey: data.conversationKey,
          accountKey: key,
        }).catch(() => undefined);
      }
      await openHome({ accountKey: key }).catch(() => {
        homeOpened.current = false;
      });
    })();
  }

  return (
    <LoginPanel
      data={data}
      theme={theme}
      accountKey={accountKey}
      onAccountKey={setPreferred}
      onSignedIn={goHome}
    />
  );
}
