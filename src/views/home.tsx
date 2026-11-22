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
import { MealRecordPanel } from "./write-meal-foods.js";
import { HandSizePanel } from "./preview-hand-size.js";
import {
  DailySummaryPanel,
  type DailySummaryData,
} from "./daily-summary.js";
import { DietChartPanel, type DietChartData } from "./diet-chart.js";
import { DietPeriodPanel, type DietPeriodData } from "./diet-period.js";
import {
  HabitCalendarPanel,
  type HabitCalendarData,
} from "./habit-calendar.js";
import {
  InbodyChartPanel,
  type InbodyChartData,
} from "./inbody-chart.js";
import {
  InbodyWorkoutPanel,
  type InbodyWorkoutData,
} from "./inbody-workout.js";
import {
  ChooseBodyGoalPanel,
  type BodyGoalData,
} from "./choose-body-goal.js";
import { LoginPanel, type LoginData } from "./login.js";
import { LogWorkoutPanel } from "./log-workout.js";
import { NutrientFlowPanel, type NutrientFlowData } from "./nutrient-flow.js";
import { BarcodeScanPanel } from "./scan-food-barcode.js";
import { bumpProfile, onProfileBump } from "./profile-sync.js";
import { HomeEnergyChart } from "./home-energy-chart.js";
import {
  createFreshAccountKey,
  useAccountKey,
} from "./use-account-key.js";
import { useAssistantContext } from "./use-assistant-context.js";
import { deviceToday, deviceTimeZone } from "@/device-time.js";
import { useClaimConversationKey } from "./use-claim-conversation-key.js";
import type { DailyEnergyPlan } from "@/goals.js";
import { MVP_CALL_NAME, MVP_SKIP_USER_NAME } from "@/mvp.js";
import { WorkoutChartPanel, type WorkoutChartData } from "./workout-chart.js";

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
    // Home links the conversation key itself; the panel must not do it twice.
    conversationKey: "",
    accountKey:
      typeof output.accountKey === "string" && output.accountKey.length > 0
        ? output.accountKey
        : accountKey,
  };
}

type HomePanel =
  | { kind: "today"; data: DailySummaryData }
  | { kind: "diet"; data: DietChartData }
  | { kind: "inbody"; data: InbodyChartData }
  | { kind: "calendar"; data: HabitCalendarData }
  | { kind: "flow"; data: NutrientFlowData }
  | { kind: "workout-chart"; data: WorkoutChartData }
  | { kind: "workout-plan"; data: InbodyWorkoutData }
  | { kind: "body-goal"; data: BodyGoalData }
  | { kind: "meal-logs"; data: DietPeriodData }
  | { kind: "workout-log"; date: string }
  | { kind: "barcode"; date: string }
  | { kind: "meal-record"; date: string }
  | { kind: "name" }
  | { kind: "login"; data: LoginData }
  | { kind: "hand" };

const panelTitle: Record<HomePanel["kind"], string> = {
  today: "오늘 목표 달성",
  diet: "식단 차트",
  inbody: "인바디 차트",
  calendar: "성실도 달력",
  flow: "영양소 흐름",
  "workout-chart": "운동 성장",
  "workout-plan": "맞춤 운동",
  "body-goal": "워너비 체형",
  "meal-logs": "기록 고치기",
  "workout-log": "운동 기록",
  barcode: "바코드로 기록",
  "meal-record": "식사 등록",
  name: "이름",
  login: "회원가입 / 로그인",
  hand: "손 치수",
};

type Need = "name" | "hand" | "inbody";
const needLabel: Record<Need, string> = {
  name: "이름",
  hand: "손 치수",
  inbody: "인바디",
};

type Action = {
  id: ActionId;
  title: string;
  detail: string;
  /** Sent to the chat when the action needs the model (photos). */
  shown: string;
  workflow: string;
  needs: Need[];
};

const groups: { title: string; actions: Action[] }[] = [
  {
    title: "기록",
    actions: [
      {
        id: "meal",
        title: "식사 기록",
        detail:
          "누르면 식사 등록 카드가 바로 열립니다. 칸마다 사진을 고르고 끼니·구성을 적은 뒤 등록합니다.",
        shown: "",
        workflow: "",
        // MVP: 이름 게이트 주석. needs: ["name", "hand"],
        needs: MVP_SKIP_USER_NAME ? ["hand"] : ["name", "hand"],
      },
      {
        id: "barcode",
        title: "바코드로 기록",
        detail: "포장 식품의 바코드를 찍어 영양 성분을 불러옵니다.",
        shown: "",
        workflow: "",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "body-goal",
        title: "워너비 체형",
        detail: "체형 사진을 고르고, 달성 기한과 목표 체지방을 정합니다.",
        shown: "",
        workflow: "",
        needs: MVP_SKIP_USER_NAME ? ["inbody"] : ["name", "inbody"],
      },
      {
        id: "workout-plan",
        title: "맞춤 운동",
        detail:
          "헬스장·홈트레이닝과 집 기구만 고릅니다. 오늘 부위는 인바디와 날짜로 정해집니다.",
        shown: "",
        workflow: "",
        needs: MVP_SKIP_USER_NAME ? ["inbody"] : ["name", "inbody"],
      },
      {
        id: "workout-log",
        title: "운동 기록",
        detail: "문장으로 적고 검색하면 바로 kcal가 나옵니다.",
        shown: "",
        workflow: "",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "meal-logs",
        title: "기록 고치기",
        detail: "최근 7일 식단을 한 줄씩 고치거나 지웁니다.",
        shown: "",
        workflow: "",
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
        detail: "활동·탄수화물·단백질·지방 달성률을 링으로 봅니다.",
        shown: "",
        workflow: "",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "diet-chart",
        title: "탄단지 열량",
        detail: "기간별 탄·단·지 kcal를 하루 권장량과 비교합니다.",
        shown: "",
        workflow: "",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "habit-calendar",
        title: "성실도 달력",
        detail: "월별 달력으로 식단·운동 성실도를 봅니다. 일자가 칸에 표시됩니다.",
        shown: "",
        workflow: "",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "workout-chart",
        title: "운동 성장",
        detail: "종목별 주간 볼륨과 추정 1RM을 봅니다.",
        shown: "",
        workflow: "",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      {
        id: "inbody-chart",
        title: "인바디 차트",
        detail: "체형(C-I-D)·부위 밸런스·변화를 봅니다.",
        shown: "",
        workflow: "",
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
        detail:
          "결과지 사진으로 체중·골격근·체지방을 저장합니다. 약 1달 간격으로 새로 등록합니다.",
        shown: "인바디 등록할게요.",
        workflow:
          "홈에서 인바디 등록을 골랐다. 이미 로그인한 상태다. 다시 로그인·가입을 요구하지 않는다. accountKey를 save-inbody·get-inbody에 그대로 넣는다. 저장된 인바디가 있으면 get-inbody로 요약을 보여 주고, 새 등록이면 결과지 사진을 요청한 뒤 읽은 값으로 save-inbody를 호출한다. ‘로그인한 계정에만 저장’ 같은 말로 거절하지 않는다.",
        needs: MVP_SKIP_USER_NAME ? ["hand"] : ["name", "hand"],
      },
      {
        id: "hand",
        title: "손 치수",
        detail: "참고 손사진·카드 사진으로 길이·폭을 재고, 생쌀 1줌(무게 또는 컵 지름·높이)을 저장합니다.",
        shown: "손 치수 확인할게요.",
        workflow:
          "홈에서 손 치수를 골랐다. 홈 패널에 손 치수 카드가 열린다. 사진은 참고용이고, 생쌀은 네 손가락이 손바닥을 덮는 형태로 1줌 쥔 뒤 무게 또는 컵·그릇 지름·높이를 받는다. 1줌은 한식 반찬 kcal 줌 계산에 쓰인다. preview-hand-size 뷰 도구를 홈 안에서 호출하지 않는다. 카드가 save-hand-size로 저장한다.",
        needs: MVP_SKIP_USER_NAME ? [] : ["name"],
      },
      // MVP: 이름 바꾸기 메뉴 숨김
      ...(MVP_SKIP_USER_NAME
        ? []
        : [
            {
              id: "name" as const,
              title: "이름 바꾸기",
              detail: "트레이너가 부를 이름을 바꿉니다.",
              shown: "",
              workflow: "",
              needs: [] as Need[],
            },
          ]),
      {
        id: "login",
        title: "회원가입 / 로그인",
        detail: "Google·카카오 이메일로 가입하거나 기록을 이어갑니다.",
        shown: "",
        workflow: "",
        needs: [],
      },
    ],
  },
];

const allActions = groups.flatMap((group) => group.actions);

/** Today in Seoul — meal/barcode paths still use the Korea day boundary. */
function seoulToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function deviceClockArgs() {
  return {
    clientDate: deviceToday(),
    clientTimeZone: deviceTimeZone(),
  };
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        ok
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

function toolErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "불러오지 못했습니다. 한 번 더 눌러 주세요.";
}

export default function Home() {
  const { theme } = useUser();
  const { safeArea } = useViewport();
  const [displayMode, setDisplayMode] = useDisplayMode();
  const toolInfo = useToolInfo<"open-home">();
  const sendMessage = useSendFollowUpMessage();
  const { update } = useModelContext();
  const { callTool: loadUser } = useCallTool("get-user");
  const { callToolAsync: loadToday } = useCallTool("get-daily-summary-chart");
  const { callToolAsync: loadDiet } = useCallTool("show-diet-chart");
  const { callToolAsync: loadInbody } = useCallTool("show-inbody-chart");
  const { callToolAsync: loadCalendar } = useCallTool("show-habit-calendar");
  const { callToolAsync: loadWorkouts } = useCallTool("show-workout-chart");
  const { callToolAsync: loadWorkoutPlan } = useCallTool(
    "recommend-inbody-workout",
  );
  const { callToolAsync: loadBodyGoal } = useCallTool("choose-body-goal");
  const { callToolAsync: loadMealLogs } = useCallTool("get-diet-period");
  const { callToolAsync: saveName, isPending: nameSaving } =
    useCallTool("save-display-name");
  const [keyOverride, setKeyOverride] = useState("");
  const [replaceToken, setReplaceToken] = useState(0);
  const preferred =
    keyOverride ||
    (toolInfo.isSuccess && toolInfo.output.accountKey
      ? toolInfo.output.accountKey
      : undefined);
  const accountKey = useAccountKey(preferred, { replaceToken });
  // The model was given this key by open-home; link it to this device's login
  // so its saves and this card always agree on who is logged in.
  const claimed = useClaimConversationKey(
    toolInfo.isSuccess ? toolInfo.output.conversationKey : undefined,
    accountKey,
  );
  const [profile, setProfile] = useState<HomeProfile | null>(null);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [panel, setPanel] = useState<HomePanel | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const intentRan = useRef(false);
  const homeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelWasOpen = useRef(false);
  const panelKind = panel?.kind;
  const isFullscreen = displayMode === "fullscreen";

  // Opening a panel brings that card into view. Closing it returns to the home
  // menu; otherwise the scroll offset stays on the removed card and the menu
  // sits above the window.
  useEffect(() => {
    if (panelKind) {
      panelWasOpen.current = true;
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!panelWasOpen.current) return;
    panelWasOpen.current = false;
    const showHome = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      homeRef.current?.scrollIntoView({ block: "start" });
    };
    showHome();
    const frame = window.requestAnimationFrame(showHome);
    return () => window.cancelAnimationFrame(frame);
  }, [panelKind]);

  // Host may keep a taller iframe after a smaller panel opens — paint chrome
  // so leftover space matches the theme instead of flashing white.
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
    // Wait for the link: get-user must see the same account the model will.
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

  // open-home could not see this device's login; until get-user answers with
  // the device key, the card shows neither "logged in" nor "login required".
  const checking =
    toolInfo.isSuccess &&
    Boolean(toolInfo.output.identityPending) &&
    profile === null;
  const loginRequired = Boolean(home.loginRequired);

  /** Hands the request to the model: these steps need a photo in the chat. */
  async function askModel(action: Action) {
    const loginNote = loginRequired
      ? "loginRequired=true. 로그인부터."
      : `loginRequired=false. 이미 Google/카카오 로그인됨. 홈에 프로필이 보인다. "아직 로그인 전"·"로그인해 주세요"·"로그인 카드"라고 말하지 마세요. accountKey=${accountKey} 를 get-user·save-inbody·preview-hand-size에 그대로 넣으세요.`;
    // Never put accountKey / login directives in sendFollowUpMessage — some hosts
    // show them in the chat even with audience:assistant.
    await update({
      content: [
        {
          type: "text",
          text: `${action.workflow} ${loginNote}`,
          annotations: { audience: ["assistant"] },
        },
      ],
    }).catch(() => undefined);
    await sendMessage(action.shown);
  }

  /** Opens a feature inside the home card. Buttons and open-home intents share it. */
  async function openAction(action: Action): Promise<void> {
    if (checking) {
      setFailed("계정을 확인하는 중이에요. 잠시 뒤 다시 눌러 주세요.");
      return;
    }
    setFailed(null);
    // New devices must finish Google/Kakao before name or anything else.
    if (loginRequired && action.id !== "login") {
      const loginAction = allActions.find((item) => item.id === "login");
      if (loginAction) {
        await openAction(loginAction);
        setFailed("새 기기예요. 회원가입 또는 로그인으로 시작해 주세요.");
      }
      return;
    }
    // Name then hand before the rest opens.
    // A missing InBody is explained by the InBody chart itself.
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
      switch (action.id) {
        case "meal":
          setPanel({ kind: "meal-record", date: seoulToday() });
          return;
        case "inbody-setup":
          await askModel(action);
          return;
        case "barcode":
          setPanel({ kind: "barcode", date: seoulToday() });
          return;
        case "login": {
          // Never call open-login from home — that view tool blanks the host iframe.
          if (!toolInfo.isSuccess) {
            throw new Error("홈 데이터를 아직 받지 못했습니다.");
          }
          const data = loginDataFromHome(toolInfo.output, accountKey);
          // open-home may not have known the login; the loaded profile does.
          setPanel({
            kind: "login",
            data: home.loginSaved
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
          });
          return;
        }
        case "workout-log":
          setPanel({ kind: "workout-log", date: seoulToday() });
          return;
        case "body-goal": {
          const result = await loadBodyGoal({
            accountKey,
            ...deviceClockArgs(),
          });
          if (!result.structuredContent) {
            throw new Error("목표 체형 카드를 받지 못했습니다.");
          }
          setPanel({ kind: "body-goal", data: result.structuredContent });
          return;
        }
        case "workout-plan": {
          const result = await loadWorkoutPlan({
            accountKey,
            ...deviceClockArgs(),
          });
          if (!result.structuredContent) {
            throw new Error("맞춤 운동을 받지 못했습니다.");
          }
          setPanel({ kind: "workout-plan", data: result.structuredContent });
          return;
        }
        case "name":
          setNameDraft(home.displayName);
          setPanel({ kind: "name" });
          return;
        case "today": {
          const result = await loadToday({ accountKey });
          if (!result.structuredContent) {
            throw new Error("오늘 요약을 받지 못했습니다.");
          }
          setPanel({ kind: "today", data: result.structuredContent });
          return;
        }
        case "diet-chart": {
          const result = await loadDiet({ accountKey });
          if (!result.structuredContent) {
            throw new Error("식단 차트를 받지 못했습니다.");
          }
          setPanel({ kind: "diet", data: result.structuredContent });
          return;
        }
        case "inbody-chart": {
          const result = await loadInbody({ accountKey });
          if (!result.structuredContent) {
            throw new Error("인바디 차트를 받지 못했습니다.");
          }
          setPanel({ kind: "inbody", data: result.structuredContent });
          return;
        }
        case "habit-calendar": {
          const result = await loadCalendar({
            accountKey,
            ...deviceClockArgs(),
          });
          if (!result.structuredContent) {
            throw new Error("성실도 달력을 받지 못했습니다.");
          }
          setPanel({ kind: "calendar", data: result.structuredContent });
          return;
        }
        case "workout-chart": {
          const result = await loadWorkouts({ accountKey });
          if (!result.structuredContent) {
            throw new Error("운동 차트를 받지 못했습니다.");
          }
          setPanel({ kind: "workout-chart", data: result.structuredContent });
          return;
        }
        case "meal-logs": {
          const result = await loadMealLogs({ accountKey });
          if (!result.structuredContent) {
            throw new Error("식단 기록을 받지 못했습니다.");
          }
          setPanel({ kind: "meal-logs", data: result.structuredContent });
          return;
        }
        case "hand": {
          // Open the hand card inside home — do not call a view tool (blank iframe).
          setPanel({ kind: "hand" });
          return;
        }
      }
    } catch (error) {
      setFailed(toolErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  // The effect below runs once per intent but must call the latest closure.
  const openActionRef = useRef(openAction);
  openActionRef.current = openAction;
  const intent = toolInfo.isSuccess ? toolInfo.output.intent?.trim() : "";

  useEffect(() => {
    if (!accountKey || checking) return;
    const forced =
      loginRequired
        ? "login"
        : intent === "nutrient-flow"
          ? "diet-chart"
          : intent;
    if (!forced || intentRan.current) return;
    const action = allActions.find((item) => item.id === forced);
    if (!action) return;
    intentRan.current = true;
    void openActionRef.current(action);
  }, [intent, accountKey, loginRequired, checking]);

  useAssistantContext(
    toolInfo.isSuccess
      ? JSON.stringify({
          screen: "home",
          identityPending: checking,
          loginRequired,
          loginSaved: Boolean(home.loginSaved),
          displayName: home.displayName,
          nameSaved: home.nameSaved,
          handSaved: home.handSaved,
          inbodySaved: home.inbodySaved,
          accountKey,
          panel: panel?.kind ?? null,
        })
      : "",
  );

  // Keep hooks above any early return — pending→success must not change hook order.
  const accountKeyRef = useRef(accountKey);
  accountKeyRef.current = accountKey;
  const loadUserRef = useRef(loadUser);
  loadUserRef.current = loadUser;
  const refreshProfileRef = useRef(async () => {});
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
    // Saves always refresh; tab focus/visibility is throttled to cut get-user spam.
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
    setPanel(null);
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

  async function refreshProfile() {
    await refreshProfileRef.current();
  }

  return (
    <div
      ref={homeRef}
      className={`${theme === "dark" ? "dark" : ""} min-h-full bg-background text-foreground ${
        isFullscreen ? "flex min-h-[100dvh] flex-col" : ""
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
              아래에서 다음 할 일을 고르세요. 대화에서도 `홈화면`을 검색하면
              이 메뉴가 열립니다.
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
                ? `인바디 ${home.weightKg}kg${
                    home.measuredOn ? ` · ${home.measuredOn}` : ""
                  }`
                : "인바디 없음"
            }
          />
          <StatusDot
            ok={Boolean(home.bodyGoalSaved)}
            label={
              home.bodyGoalSaved
                ? `워너비 ${home.bodyGoalTitle}${
                    home.targetDays ? ` · ${home.targetDays}일` : ""
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
            onClick={() => void refreshProfile()}
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
                            불러오는 중
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

        {panel ? (
          <div className="mt-4">
            <div
              ref={panelRef}
              className="mb-2 flex scroll-mt-4 items-center justify-between gap-2"
            >
              <p className="text-xs font-semibold text-muted-foreground">
                {panelTitle[panel.kind]}
              </p>
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => setPanel(null)}
              >
                닫기
              </button>
            </div>

            {panel.kind === "today" ? (
              <div className="rounded-xl border border-border p-4">
                <DailySummaryPanel data={panel.data} theme={theme} />
              </div>
            ) : null}
            {panel.kind === "diet" ? (
              <DietChartPanel chart={panel.data} theme={theme} />
            ) : null}
            {panel.kind === "inbody" ? (
              <InbodyChartPanel
                chart={panel.data}
                theme={theme}
                accountKey={accountKey}
              />
            ) : null}
            {panel.kind === "calendar" ? (
              <HabitCalendarPanel data={panel.data} theme={theme} />
            ) : null}
            {panel.kind === "flow" ? (
              <NutrientFlowPanel data={panel.data} theme={theme} />
            ) : null}
            {panel.kind === "workout-chart" ? (
              <WorkoutChartPanel
                data={panel.data}
                theme={theme}
                accountKey={accountKey}
              />
            ) : null}
            {panel.kind === "meal-logs" ? (
              <DietPeriodPanel
                data={panel.data}
                theme={theme}
                accountKey={accountKey}
              />
            ) : null}
            {panel.kind === "body-goal" ? (
              <ChooseBodyGoalPanel
                data={panel.data}
                theme={theme}
                accountKey={accountKey}
              />
            ) : null}
            {panel.kind === "workout-plan" ? (
              panel.data.inbodySaved ? (
                <InbodyWorkoutPanel
                  data={panel.data}
                  theme={theme}
                  accountKey={accountKey}
                />
              ) : (
                <p className="text-sm">{panel.data.message}</p>
              )
            ) : null}
            {panel.kind === "workout-log" ? (
              <LogWorkoutPanel
                date={panel.date}
                entries={[]}
                bodyWeightKg={home.weightKg}
                accountKey={accountKey}
              />
            ) : null}
            {panel.kind === "meal-record" ? (
              <MealRecordPanel
                date={panel.date}
                accountKey={accountKey}
                handLengthCm={home.handLengthCm}
                handWidthCm={home.handWidthCm}
                handfulVolumeMl={home.handfulVolumeMl}
              />
            ) : null}
            {panel.kind === "barcode" ? (
              <BarcodeScanPanel
                meal="snack"
                date={panel.date}
                accountKey={accountKey}
              />
            ) : null}
            {panel.kind === "login" ? (
              <LoginPanel
                data={panel.data}
                theme={theme}
                accountKey={accountKey}
                onAccountKey={setKeyOverride}
                onSignedIn={(key) => {
                  setKeyOverride(key);
                  intentRan.current = false;
                  setPanel(null);
                  setFailed(null);
                  // Widget callTool is invisible to the host LLM — sync key privately, greet briefly.
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
                    MVP_SKIP_USER_NAME
                      ? "로그인 완료. 이어서 설정을 등록해 주세요."
                      : "로그인 완료. 이어서 설정을 등록해 주세요.",
                  ).catch(() => undefined);
                  loadUser(
                    { accountKey: key },
                    {
                      onSuccess: (result) => {
                        const next = result.structuredContent;
                        if (!next) return;
                        setProfile(mapHomeProfile(next, key));
                        // MVP: 로그인 직후 이름 카드 자동 오픈 안 함
                        // if (!next.loginRequired && !next.nameSaved) { ... }
                        if (
                          !MVP_SKIP_USER_NAME &&
                          !next.loginRequired &&
                          !next.nameSaved
                        ) {
                          const nameAction = allActions.find(
                            (item) => item.id === "name",
                          );
                          if (nameAction) void openActionRef.current(nameAction);
                        }
                      },
                    },
                  );
                }}
              />
            ) : null}
            {/* MVP: 이름 카드 비활성. MVP_SKIP_USER_NAME이 false일 때만 연다. */}
            {!MVP_SKIP_USER_NAME && panel.kind === "name" ? (
              <form
                className="rounded-xl border border-border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (nameSaving || nameDraft.trim().length === 0) return;
                  void saveName({ name: nameDraft, accountKey })
                    .then((result) => {
                      if (result.structuredContent?.saved) {
                        setProfile((current) => ({
                          ...(current ?? home),
                          nameSaved: true,
                          displayName: result.structuredContent!.displayName,
                          accountKey:
                            result.structuredContent!.accountKey || accountKey,
                        }));
                        bumpProfile();
                        setPanel(null);
                      } else {
                        setFailed("이름을 저장하지 못했습니다.");
                      }
                    })
                    .catch((error) => setFailed(toolErrorMessage(error)));
                }}
              >
                <h2 className="text-lg font-bold">이름을 정해 주세요</h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  트레이너가 이 이름으로 부릅니다. 1~16자입니다.
                </p>
                <input
                  type="text"
                  maxLength={16}
                  value={nameDraft}
                  placeholder="이름"
                  onChange={(event) => setNameDraft(event.target.value)}
                  className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={nameSaving || nameDraft.trim().length === 0}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                >
                  {nameSaving ? "저장 중…" : "저장"}
                </button>
              </form>
            ) : null}
            {panel.kind === "hand" ? (
              <HandSizePanel
                accountKey={accountKey}
                handLengthCm={home.handLengthCm}
                handWidthCm={home.handWidthCm}
                handfulVolumeMl={home.handfulVolumeMl}
                onSaved={(next) => {
                  setProfile((current) => ({
                    ...(current ?? home),
                    handSaved: true,
                    handLengthCm: next.handLengthCm,
                    handWidthCm: next.handWidthCm,
                    handfulVolumeMl: next.handfulVolumeMl,
                  }));
                }}
              />
            ) : null}
          </div>
        ) : null}

        <p className="mt-4 text-xs text-muted-foreground">
          모르는 게 있을 때는 대화에 `홈화면`을 검색해 보세요. 모든 기능은 이
          화면에서 볼 수 있어요.
        </p>
      </div>
    </div>
  );
}
