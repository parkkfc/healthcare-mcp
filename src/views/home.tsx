import "@/index.css";

import { useEffect, useRef, useState } from "react";
import {
  useDisplayMode,
  useModelContext,
  useSendFollowUpMessage,
  useUser,
  useViewport,
} from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { LoginPanel, type LoginData } from "./login.js";
import { onProfileBump } from "../hooks/profile-sync.js";
import { HomeEnergyChart } from "./components/home-energy-chart.js";
import {
  createFreshAccountKey,
  useAccountKey,
} from "./use-account-key.js";
import { useAssistantContext } from "../hooks/use-assistant-context.js";
import { useClaimConversationKey } from "./use-claim-conversation-key.js";
import type { DailyEnergyPlan } from "@/goals.js";
import { MVP_CALL_NAME, MVP_SKIP_USER_NAME } from "@/mvp.js";

type HomeProfile = {
  loginRequired?: boolean;
  loginSaved?: boolean;
  nameSaved: boolean;
  displayName: string;
  handSaved: boolean;
  handLengthCm: number;
  handWidthCm: number;
  handfulVolumeMl: number;
  inbodySaved: boolean;
  measuredOn?: string;
  weightKg: number;
  bodyGoalSaved?: boolean;
  bodyGoalTitle?: string;
  targetDays?: number;
  mealLoggedToday?: boolean;
  energyToday?: DailyEnergyPlan | null;
  accountKey?: string;
};

type ActionId =
  | "meal"
  | "barcode"
  | "workout-log"
  | "workout-plan"
  | "body-goal"
  | "meal-logs"
  | "today"
  | "diet-chart"
  | "habit-calendar"
  | "workout-chart"
  | "inbody-chart"
  | "inbody-setup"
  | "hand"
  | "name"
  | "login";

function mapHomeProfile(
  next: Partial<HomeProfile> & Record<string, unknown>,
  fallbackKey: string,
): HomeProfile {
  return {
    loginRequired: Boolean(next.loginRequired),
    loginSaved: Boolean(next.loginSaved),
    nameSaved: Boolean(next.nameSaved),
    displayName: typeof next.displayName === "string" ? next.displayName : "",
    handSaved: Boolean(next.handSaved),
    handLengthCm: typeof next.handLengthCm === "number" ? next.handLengthCm : 0,
    handWidthCm: typeof next.handWidthCm === "number" ? next.handWidthCm : 0,
    handfulVolumeMl:
      typeof next.handfulVolumeMl === "number" ? next.handfulVolumeMl : 0,
    inbodySaved: Boolean(next.inbodySaved),
    measuredOn: typeof next.measuredOn === "string" ? next.measuredOn : "",
    weightKg: typeof next.weightKg === "number" ? next.weightKg : 0,
    bodyGoalSaved: Boolean(next.bodyGoalSaved),
    bodyGoalTitle:
      typeof next.bodyGoalTitle === "string" ? next.bodyGoalTitle : "",
    targetDays: typeof next.targetDays === "number" ? next.targetDays : 0,
    mealLoggedToday: Boolean(next.mealLoggedToday),
    energyToday:
      next.energyToday && typeof next.energyToday === "object"
        ? (next.energyToday as DailyEnergyPlan)
        : null,
    accountKey:
      typeof next.accountKey === "string" && next.accountKey.length > 0
        ? next.accountKey
        : fallbackKey,
  };
}

/** Build the login panel from open-home output — never call the open-login view tool. */
function loginDataFromHome(
  output: Record<string, unknown>,
  accountKey: string,
): LoginData {
  const cloud =
    output.cloudProfile && typeof output.cloudProfile === "object"
      ? (output.cloudProfile as Record<string, unknown>)
      : {};
  const linked = Array.isArray(output.linked)
    ? (output.linked as LoginData["linked"])
    : [];
  return {
    signedIn: Boolean(
      output.signedIn ?? (output.loginSaved && !output.loginRequired),
    ),
    linked,
    cloudProfile: {
      displayName:
        (typeof cloud.displayName === "string" && cloud.displayName) ||
        (typeof output.displayName === "string" ? output.displayName : "") ||
        "",
      nameSaved: Boolean(cloud.nameSaved ?? output.nameSaved),
      lastAuthProvider:
        (typeof cloud.lastAuthProvider === "string" && cloud.lastAuthProvider) ||
        (typeof output.lastAuthProvider === "string"
          ? output.lastAuthProvider
          : "") ||
        "",
      email:
        (typeof cloud.email === "string" && cloud.email) ||
        (typeof output.email === "string" ? output.email : "") ||
        "",
      lastLoginAt:
        (typeof cloud.lastLoginAt === "string" && cloud.lastLoginAt) ||
        (typeof output.lastLoginAt === "string" ? output.lastLoginAt : "") ||
        "",
    },
    googleReady: Boolean(output.googleReady),
    kakaoReady: Boolean(output.kakaoReady),
    conversationKey: "",
    accountKey:
      typeof output.accountKey === "string" && output.accountKey.length > 0
        ? output.accountKey
        : accountKey,
  };
}

type Need = "name" | "hand" | "inbody";
const needLabel: Record<Need, string> = {
  name: "이름",
  hand: "손 치수",
  inbody: "인바디",
};

type Action = {
  id: ActionId;
  title: string;
  /** Cheat-sheet line shown on the card. */
  detail: string;
  /** Safe Korean sentence for the host composer (no accountKey). */
  chat: string;
  /** Assistant-only hint: which tool to open. */
  toolHint: string;
  needs: Need[];
};

const groups: { title: string; actions: Action[] }[] = [
  {
    title: "기록",
    actions: [
      {
        id: "meal",
        title: "식사 기록",
        detail: "입력 형식 카드 → 채팅에 음식명·양",
        // Separate view card via host (not an in-home panel).
        chat: "식사 기록할게",
        toolHint:
          "사용자가 홈에서 식사 기록을 눌렀다. show-meal-entry-guide를 accountKey와 함께 바로 연다(홈과 붙인 패널이 아니라 별도 카드). 채팅에 예시를 풀어 쓰지 마라. write-meal-foods는 지금 열지 마라. 글만·간식은 음식명·양이 오면 write-meal-foods를 한 번 연다. 사진+밥·국이면 get-hand-size 후 containerDiameterCm(손 폭 cm × 그릇픽셀÷손바닥픽셀)을 items에 넣은 뒤에만 write-meal-foods를 한 번 연다. 지름 없이 호출하면 카드가 안 열린다. 입력창에 accountKey를 넣지 마라.",
        needs: MVP_SKIP_USER_NAME ? ["hand"] : ["name", "hand"],
      },
      {
        id: "barcode",
        title: "바코드로 기록",
        detail: "채팅 예: `바코드 찍을래`",
        chat: "바코드 찍을래",
        toolHint: "scan-food-barcode를 accountKey와 함께 연다.",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "body-goal",
        title: "워너비 체형",
        detail: "채팅 예: `워너비 체형 고를래`",
        chat: "워너비 체형 고를래",
        toolHint: "choose-body-goal을 accountKey와 함께 연다.",
        needs: MVP_SKIP_USER_NAME ? ["inbody"] : ["name", "inbody"],
      },
      {
        id: "workout-plan",
        title: "맞춤 운동",
        detail: "채팅 예: `오늘 맞춤 운동 짜줘`",
        chat: "오늘 맞춤 운동 짜줘",
        toolHint:
          "recommend-inbody-workout을 accountKey·clientDate와 함께 연다. workout_catalog_gaps면 search-training-docs(workout_course)→add-catalog-exercises 후 recommend를 한 번만 다시 연다.",
        needs: MVP_SKIP_USER_NAME ? ["inbody"] : ["name", "inbody"],
      },
      {
        id: "workout-log",
        title: "운동 기록",
        detail: "채팅 예: `운동 기록할게`",
        chat: "운동 기록할게",
        toolHint: "log-workout을 accountKey와 함께 연다.",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "meal-logs",
        title: "기록 고치기",
        detail: "채팅 예: `어제 식사 기록 고칠래`",
        chat: "어제 식사 기록 고칠래",
        toolHint: "get-diet-period를 accountKey와 함께 연다.",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
    ],
  },
  {
    title: "차트",
    actions: [
      {
        id: "today",
        title: "오늘 목표 달성",
        detail: "채팅 예: `오늘 목표 달성 보여줘`",
        chat: "오늘 목표 달성 보여줘",
        toolHint: "get-daily-summary-chart를 accountKey와 함께 연다.",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "diet-chart",
        title: "탄단지 열량",
        detail: "채팅 예: `탄단지 차트 보여줘`",
        chat: "탄단지 차트 보여줘",
        toolHint: "show-diet-chart를 accountKey와 함께 연다.",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "habit-calendar",
        title: "성실도 달력",
        detail: "채팅 예: `성실도 달력 보여줘`",
        chat: "성실도 달력 보여줘",
        toolHint:
          "show-habit-calendar를 accountKey·clientDate와 함께 연다.",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "workout-chart",
        title: "운동 성장",
        detail: "채팅 예: `운동 성장 차트 보여줘`",
        chat: "운동 성장 차트 보여줘",
        toolHint: "show-workout-chart를 accountKey와 함께 연다.",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "inbody-chart",
        title: "인바디 차트",
        detail: "채팅 예: `인바디 보여줘`",
        chat: "인바디 보여줘",
        toolHint: "show-inbody-chart를 accountKey와 함께 연다.",
        needs: MVP_SKIP_USER_NAME ? ["inbody"] : ["name", "inbody"],
      },
    ],
  },
  {
    title: "설정",
    actions: [
      {
        id: "inbody-setup",
        title: "인바디 등록",
        detail: "채팅에 결과지 사진을 올려 주세요.",
        chat: "인바디 결과지 올릴게",
        toolHint:
          "loginRequired=false면 다시 로그인을 요구하지 말고 save-inbody로 이어간다. 결과지 사진을 요청한다.",
        needs: MVP_SKIP_USER_NAME ? ["hand"] : ["name", "hand"],
      },
      {
        id: "hand",
        title: "손 치수",
        detail: "채팅에 카드+손 사진을 올려 주세요.",
        chat: "손 치수 등록할게",
        toolHint: "preview-hand-size를 연다. 홈 안에 손 패널을 열지 않는다.",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      ...(MVP_SKIP_USER_NAME
        ? []
        : [
          {
            id: "name" as const,
            title: "이름 바꾸기",
            detail: "채팅 예: `이름 바꿀래`",
            chat: "이름 바꿀래",
            toolHint: "set-display-name을 연다.",
            needs: [] as Need[],
          },
        ]),
      {
        id: "login",
        title: "회원가입 / 로그인",
        detail: "Google·카카오로 이 기기 계정을 연결합니다.",
        chat: "",
        toolHint: "",
        needs: [],
      },
    ],
  },
];

const allActions = groups.flatMap((group) => group.actions);

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${ok
        ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-300"
        : "border-amber-600/40 text-amber-700 dark:text-amber-300"
        }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {label}
    </span>
  );
}

export default function Home() {
  const { theme } = useUser();
  const { safeArea } = useViewport();
  const [displayMode, setDisplayMode] = useDisplayMode();
  const toolInfo = useToolInfo<"open-home">();
  const sendMessage = useSendFollowUpMessage();
  const { update } = useModelContext();
  const { callTool: loadUser } = useCallTool("get-user");
  const [keyOverride, setKeyOverride] = useState("");
  const [replaceToken, setReplaceToken] = useState(0);
  const preferred =
    keyOverride ||
    (toolInfo.isSuccess && toolInfo.output.accountKey
      ? toolInfo.output.accountKey
      : undefined);
  const accountKey = useAccountKey(preferred, { replaceToken });
  const claimed = useClaimConversationKey(
    toolInfo.isSuccess ? toolInfo.output.conversationKey : undefined,
    accountKey,
  );
  const [profile, setProfile] = useState<HomeProfile | null>(null);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loginPanel, setLoginPanel] = useState<LoginData | null>(null);
  const intentRan = useRef(false);
  const homeRef = useRef<HTMLDivElement>(null);
  const isFullscreen = displayMode === "fullscreen";

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevHtml = root.style.backgroundColor;
    const prevBody = body.style.backgroundColor;
    root.style.backgroundColor = "var(--background)";
    body.style.backgroundColor = "var(--background)";
    return () => {
      root.style.backgroundColor = prevHtml;
      body.style.backgroundColor = prevBody;
    };
  }, [theme]);

  useEffect(() => {
    if (!toolInfo.isSuccess || !claimed) return;
    loadUser(
      { accountKey },
      {
        onSuccess: (result) => {
          const next = result.structuredContent;
          if (!next) return;
          setProfile(mapHomeProfile(next, accountKey));
        },
        onError: () => {
          setFailed(
            "계정 상태를 불러오지 못했습니다. 새로고침을 눌러 주세요.",
          );
        },
      },
    );
  }, [toolInfo.isSuccess, claimed, accountKey, loadUser]);

  const home: HomeProfile =
    profile ??
    (toolInfo.isSuccess
      ? mapHomeProfile(toolInfo.output, accountKey)
      : mapHomeProfile({}, accountKey));

  const checking =
    toolInfo.isSuccess &&
    Boolean(toolInfo.output.identityPending) &&
    profile === null;
  const loginRequired = Boolean(home.loginRequired);

  async function launchChat(action: Action) {
    if (!action.chat) return;
    const loginNote = loginRequired
      ? "loginRequired=true. 로그인부터."
      : `loginRequired=false. accountKey=${accountKey} 를 이후 도구에 그대로 넣으세요.`;
    await update({
      content: [
        {
          type: "text",
          text: `${action.toolHint} ${loginNote}`,
          annotations: { audience: ["assistant"] },
        },
      ],
    }).catch(() => undefined);
    await sendMessage(action.chat);
  }

  async function openAction(action: Action): Promise<void> {
    if (checking) {
      setFailed("계정을 확인하는 중이에요. 잠시 뒤 다시 눌러 주세요.");
      return;
    }
    setFailed(null);
    if (loginRequired && action.id !== "login") {
      const loginAction = allActions.find((item) => item.id === "login");
      if (loginAction) {
        await openAction(loginAction);
        setFailed("새 기기예요. 회원가입 또는 로그인으로 시작해 주세요.");
      }
      return;
    }
    const saved: Record<Need, boolean> = {
      name: MVP_SKIP_USER_NAME ? true : home.nameSaved,
      hand: home.handSaved,
      inbody: true,
    };
    const missing = action.needs.find((need) => !saved[need]);
    const first = allActions.find((item) => item.id === missing);
    if (missing && first && first.id !== action.id) {
      await openAction(first);
      setFailed(
        `${action.title}보다 ${needLabel[missing]} 저장이 먼저입니다.`,
      );
      return;
    }
    setBusy(action.id);
    try {
      if (action.id === "login") {
        if (!toolInfo.isSuccess) {
          throw new Error("홈 데이터를 아직 받지 못했습니다.");
        }
        const data = loginDataFromHome(toolInfo.output, accountKey);
        setLoginPanel(
          home.loginSaved
            ? {
              ...data,
              signedIn: true,
              cloudProfile: {
                ...data.cloudProfile,
                displayName:
                  data.cloudProfile.displayName || home.displayName,
                nameSaved: data.cloudProfile.nameSaved || home.nameSaved,
              },
            }
            : data,
        );
        return;
      }
      await launchChat(action);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "요청을 보내지 못했습니다. 한 번 더 눌러 주세요.";
      setFailed(message);
    } finally {
      setBusy(null);
    }
  }

  const openActionRef = useRef(openAction);
  openActionRef.current = openAction;
  const intent = toolInfo.isSuccess ? toolInfo.output.intent?.trim() : "";

  // Frozen: only force login panel when login is required (or intent=login).
  useEffect(() => {
    if (!accountKey || checking) return;
    if (!(loginRequired || intent === "login")) return;
    if (intentRan.current) return;
    const action = allActions.find((item) => item.id === "login");
    if (!action) return;
    intentRan.current = true;
    void openActionRef.current(action);
  }, [intent, accountKey, loginRequired, checking]);

  useAssistantContext(
    toolInfo.isSuccess
      ? JSON.stringify({
        screen: "home-launcher",
        identityPending: checking,
        loginRequired,
        loginSaved: Boolean(home.loginSaved),
        displayName: home.displayName,
        nameSaved: home.nameSaved,
        handSaved: home.handSaved,
        inbodySaved: home.inbodySaved,
        accountKey,
        panel: loginPanel ? "login" : null,
      })
      : "",
  );

  const accountKeyRef = useRef(accountKey);
  accountKeyRef.current = accountKey;
  const loadUserRef = useRef(loadUser);
  loadUserRef.current = loadUser;
  const refreshProfileRef = useRef(async () => { });
  refreshProfileRef.current = async () => {
    const key = accountKeyRef.current;
    try {
      const result = await new Promise<{ structuredContent?: HomeProfile }>(
        (resolve, reject) => {
          loadUserRef.current(
            { accountKey: key },
            {
              onSuccess: (data) => resolve(data),
              onError: (error) => reject(error),
            },
          );
        },
      );
      const next = result.structuredContent;
      if (!next) return;
      setProfile(mapHomeProfile(next, key));
    } catch {
      /* keep current profile */
    }
  };

  useEffect(() => {
    if (!accountKey) return;
    const lastFocusRefresh = { at: 0 };
    const FOCUS_MIN_MS = 60_000;
    const reload = () => {
      void refreshProfileRef.current();
    };
    const reloadIfStale = () => {
      const now = Date.now();
      if (now - lastFocusRefresh.at < FOCUS_MIN_MS) return;
      lastFocusRefresh.at = now;
      reload();
    };
    const stopBump = onProfileBump(reload);
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadIfStale();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", reloadIfStale);
    return () => {
      stopBump();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", reloadIfStale);
    };
  }, [accountKey]);

  if (!toolInfo.isSuccess) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} min-h-[120px] p-4 bg-background text-foreground`}
      >
        홈을 불러오는 중…
      </div>
    );
  }

  const greeting = checking
    ? "계정을 확인하는 중…"
    : loginRequired
      ? "새 기기예요. 회원가입 또는 로그인으로 시작해 주세요."
      : MVP_SKIP_USER_NAME
        ? `${MVP_CALL_NAME}, 오늘은 뭐부터 할까요?`
        : home.nameSaved
          ? `${home.displayName}님, 오늘은 뭐부터 할까요?`
          : "이름을 정한 뒤 메뉴를 쓸 수 있어요.";

  const canLogout =
    !loginRequired &&
    (accountKey.startsWith("user_") || Boolean(home.loginSaved));

  function logoutLocal() {
    const next = createFreshAccountKey();
    setKeyOverride(next);
    setReplaceToken((n) => n + 1);
    setLoginPanel(null);
    setFailed(null);
    setProfile(
      mapHomeProfile({ loginRequired: true, loginSaved: false }, next),
    );
    intentRan.current = false;
  }

  const ready: Record<Need, boolean> = {
    name: MVP_SKIP_USER_NAME ? true : home.nameSaved,
    hand: home.handSaved,
    inbody: home.inbodySaved,
  };

  return (
    <div
      ref={homeRef}
      className={`${theme === "dark" ? "dark" : ""} min-h-full bg-background text-foreground ${isFullscreen ? "flex min-h-[100dvh] flex-col" : ""
        }`}
      style={
        isFullscreen
          ? {
            paddingTop: (safeArea?.insets?.top ?? 0) + 16,
            paddingBottom: Math.max(safeArea?.insets?.bottom ?? 0, 88),
            paddingLeft: Math.max(safeArea?.insets?.left ?? 0, 16),
            paddingRight: Math.max(safeArea?.insets?.right ?? 0, 16),
          }
          : undefined
      }
    >
      <div
        className={
          isFullscreen
            ? "mx-auto w-full max-w-lg"
            : "rounded-xl border border-border bg-background p-4"
        }
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">
              Hands-On Diet
            </p>
            <h1 className="mt-1 text-xl font-bold">{greeting}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              기능이 궁금하면 채팅에{" "}
              <span className="font-semibold text-foreground">홈화면</span>{" "}
              또는{" "}
              <span className="font-semibold text-foreground">
                뭐 할 수 있어?
              </span>
              라고 쳐 보세요. 버튼은 채팅으로 이어지고, 차트·식사는 대화에서
              바로 열립니다.
            </p>
          </div>
          {!isFullscreen ? (
            <button
              type="button"
              onClick={() => setDisplayMode("fullscreen")}
              className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs"
            >
              크게
            </button>
          ) : null}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <StatusDot
            ok={!loginRequired && !checking}
            label={
              checking
                ? "계정 확인 중"
                : loginRequired
                  ? "로그인 필요"
                  : "로그인됨"
            }
          />
          {MVP_SKIP_USER_NAME ? (
            <StatusDot ok label={MVP_CALL_NAME} />
          ) : (
            <StatusDot
              ok={home.nameSaved}
              label={home.nameSaved ? `이름 ${home.displayName}` : "이름 없음"}
            />
          )}
          <StatusDot
            ok={home.handSaved}
            label={
              home.handSaved
                ? `손 ${home.handWidthCm}cm`
                : "손 치수 없음"
            }
          />
          <StatusDot
            ok={home.inbodySaved}
            label={
              home.inbodySaved
                ? `인바디 ${home.weightKg}kg${home.measuredOn ? ` · ${home.measuredOn}` : ""
                }`
                : "인바디 없음"
            }
          />
          <StatusDot
            ok={Boolean(home.bodyGoalSaved)}
            label={
              home.bodyGoalSaved
                ? `워너비 ${home.bodyGoalTitle}${home.targetDays ? ` · ${home.targetDays}일` : ""
                }`
                : "워너비 없음"
            }
          />
          <StatusDot
            ok={Boolean(home.mealLoggedToday)}
            label={home.mealLoggedToday ? "오늘 식사 있음" : "오늘 식사 없음"}
          />
          <button
            type="button"
            onClick={() => void refreshProfileRef.current()}
            className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-blue-500/50 hover:text-blue-600"
          >
            새로고침
          </button>
          {canLogout ? (
            <button
              type="button"
              onClick={logoutLocal}
              className="ml-auto rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-red-500/50 hover:text-red-600"
            >
              로그아웃
            </button>
          ) : null}
        </div>

        <HomeEnergyChart energy={home.energyToday} theme={theme} />

        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.title}>
              <h2 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {group.title}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.actions.map((action) => {
                  const needsLogin = loginRequired && action.id !== "login";
                  const blocked =
                    needsLogin || checking
                      ? undefined
                      : action.needs.find((need) => !ready[need]);
                  const isBusy = busy === action.id;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      disabled={isBusy}
                      onClick={() => void openAction(action)}
                      className="rounded-xl border border-border bg-background px-3 py-3 text-left transition hover:border-blue-600/50 hover:bg-blue-600/5 disabled:opacity-60"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-bold">{action.title}</span>
                        {needsLogin ? (
                          <span className="text-xs text-amber-700 dark:text-amber-300">
                            먼저 로그인
                          </span>
                        ) : blocked ? (
                          <span className="text-xs text-amber-700 dark:text-amber-300">
                            먼저 {needLabel[blocked]}
                          </span>
                        ) : isBusy ? (
                          <span className="text-xs text-blue-600">
                            연결 중
                          </span>
                        ) : action.id !== "login" ? (
                          <span className="text-xs text-muted-foreground">
                            채팅으로
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {action.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {failed ? (
          <p className="mt-3 text-sm text-red-600">{failed}</p>
        ) : null}

        {loginPanel ? (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">
                회원가입 / 로그인
              </p>
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => setLoginPanel(null)}
              >
                닫기
              </button>
            </div>
            <LoginPanel
              data={loginPanel}
              theme={theme}
              accountKey={accountKey}
              onAccountKey={setKeyOverride}
              onSignedIn={(key) => {
                setKeyOverride(key);
                intentRan.current = false;
                setLoginPanel(null);
                setFailed(null);
                void update({
                  content: [
                    {
                      type: "text",
                      text: MVP_SKIP_USER_NAME
                        ? `loginDone=true. loginRequired=false. accountKey=${key}. 다시 로그인·가입을 요구하지 마세요. '${MVP_CALL_NAME}'으로만 부르세요. 이름을 묻거나 set-display-name을 열지 마세요. 이 accountKey로 손·인바디(save-inbody)를 이어가세요.`
                        : `loginDone=true. loginRequired=false. accountKey=${key}. 다시 로그인·가입을 요구하지 마세요. 이 accountKey로 이름·손·인바디(save-inbody)를 이어가세요.`,
                      annotations: { audience: ["assistant"] },
                    },
                  ],
                }).catch(() => undefined);
                void sendMessage(
                  "로그인 완료. 이어서 설정을 등록해 주세요.",
                ).catch(() => undefined);
                loadUser(
                  { accountKey: key },
                  {
                    onSuccess: (result) => {
                      const next = result.structuredContent;
                      if (!next) return;
                      setProfile(mapHomeProfile(next, key));
                    },
                  },
                );
              }}
            />
          </div>
        ) : null}

        <p className="mt-4 text-xs text-muted-foreground">
          메뉴판이에요. 다시 보고 싶으면 채팅에 `홈화면`을 검색해 보세요.
        </p>
      </div>
    </div>
  );
}
