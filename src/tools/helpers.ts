import { text } from "skybridge/server";
import { z } from "zod";
import {
  getUserProfile,
  hasMealOnDate,
  listMealLogs,
  listWorkoutLogs,
  seoulToday
} from "../db/client.js";
import {
  workoutKinds
} from "../db/schema.js";
import { type EtagCheck } from "../etag.js";
import {
  resolveDailyEnergyPlan,
  type DailyEnergyPlan
} from "../goals.js";
import {
  findBodyGoal
} from "../body-goals.js";
import { MVP_CALL_NAME,
  MVP_SKIP_USER_NAME } from "../mvp.js";
import { DEFAULT_MEAL_MISS } from "../tone.js";
import {
  identify,
  identityProblem,
  markConversationKeyPending,
  mintConversationKey
} from "../identity.js";
import { accountKeySchema,
  normalizeAccountKey } from "../user-id.js";


export const inbodyMetrics = [
  "weightKg",
  "skeletalMuscleKg",
  "bodyFatKg",
  "bodyFatPercent",
  "muscleUpperLeftKg",
  "muscleUpperRightKg",
  "muscleCoreKg",
  "muscleLowerLeftKg",
  "muscleLowerRightKg",
] as const;
export const chartMetrics = [
  "kcal",
  "carbG",
  "proteinG",
  "fatG",
  "balance",
  "burnedKcal",
] as const;
export const chartVisuals = ["bar", "line", "area"] as const;
export const chartAxes = ["left", "right"] as const;

export const chartSeriesSchema = z.object({
  metric: z
    .enum(chartMetrics)
    .describe(
      "kcal 섭취 칼로리, carbG 탄수화물, proteinG 단백질, fatG 지방, burnedKcal 운동 소모 칼로리, balance 목표 대비 초과(양수)·적자(음수). 다이어트 유지 질문이면 balance를 bar로 고른다. balance는 0을 가운데 둔 양방향 막대로 따로 그려진다. 섭취와 소모를 견주려면 kcal 누적 bar와 burnedKcal line을 함께 넣는다.",
    ),
  label: z.string().describe("차트에 보일 이름"),
  visualType: z
    .enum(chartVisuals)
    .describe(
      "bar는 날짜·끼니 크기 비교, line은 시간 추세, area는 누적 볼륨. 기간에 맞춰 모양을 고정하지 말고 질문 의도로 고른다.",
    ),
  isStacked: z
    .boolean()
    .optional()
    .describe("kcal 막대일 때 true면 아침·점심·저녁·간식으로 누적한다."),
  yAxisId: z
    .enum(chartAxes)
    .describe("단위가 다르면 left와 right로 나눈다. 같은 단위는 같은 축."),
});

export const inbodySeriesSchema = z.object({
  metric: z
    .enum(inbodyMetrics)
    .describe(
      "weightKg 체중, skeletalMuscleKg 골격근량, bodyFatKg 체지방량, bodyFatPercent 체지방률, muscleUpperLeftKg·muscleUpperRightKg 상체, muscleCoreKg 코어, muscleLowerLeftKg·muscleLowerRightKg 하체. 체중·체성분 추세는 line, 측정일끼리 크기 비교는 bar.",
    ),
  label: z.string().describe("차트에 보일 이름"),
  visualType: z
    .enum(chartVisuals)
    .describe(
      "bar는 측정일 크기 비교, line은 변화 추세, area는 누적 경향. 기간에 맞춰 모양을 고정하지 말고 질문 의도로 고른다.",
    ),
  yAxisId: z
    .enum(chartAxes)
    .describe("kg는 left, 체지방률(%)은 right. 같은 단위는 같은 축."),
});

export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime() && dates.length < 366) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function shown(value: string) {
  return text(value, { audience: ["user", "assistant"] });
}

export function modelOnly(value: string) {
  return text(value, { audience: ["assistant"] });
}

/** Host models often send "10" or "10kcal". Drop the field instead of failing the tool. */
export function loosePositive(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] ?? "")
        : Number.NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

export function looseNonNegative(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] ?? "")
        : Number.NaN;
  return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}

export const loosePositiveNumber = z.preprocess(
  loosePositive,
  z.number().positive().optional(),
);
export const looseNonNegativeNumber = z.preprocess(
  looseNonNegative,
  z.number().nonnegative().optional(),
);

/** 첫 진입·온보딩·도움말·에러에만 붙이는 홈 안내. 매 답변 강제 금지. */
export const homeTip =
  "모르는 게 있을 때는 `홈화면` 또는 `뭐 할 수 있어?`라고 쳐 보세요. 메뉴판이 다시 열려요.";

export const homeWelcomeShown =
  "Hands-On Diet예요. 메뉴는 카드에서 보거나, 채팅에 `홈화면` / `뭐 할 수 있어?`라고 치면 다시 열 수 있어요. 예: 손바닥+식단 사진과 음식명을 올리거나, `오늘 맞춤 운동 짜줘`라고 말해 보세요.";

export function withHomeTip(message: string) {
  return `${message}\n\n${homeTip}`;
}

export const intentToolHint: Record<string, string> = {
  today: "get-daily-summary-chart",
  "diet-chart": "show-diet-chart",
  "inbody-chart": "show-inbody-chart",
  "habit-calendar": "show-habit-calendar",
  "workout-chart": "show-workout-chart",
  "workout-plan": "recommend-inbody-workout",
  "body-goal": "choose-body-goal",
  "workout-log": "log-workout",
  barcode: "scan-food-barcode",
  "meal-logs": "get-diet-period",
  login: "open-home intent=login 또는 open-login",
  name: "set-display-name",
  meal: "show-meal-entry-guide",
};

export function guideNextStep(step: "hand" | "inbody" | "meal") {
  if (step === "hand") {
    return {
      shown: withHomeTip(
        "다음으로 손 크기를 등록해요. 채팅에 카드+손 사진을 올리고, 참고 사진처럼 네 손가락이 손바닥을 덮는 형태로 생쌀 1줌을 쥔 뒤 무게(g) 또는 컵·그릇 지름·높이를 알려 주세요.",
      ),
      model: "다음이 손 크기·1줌 등록이다. 채팅 사진으로 preview-hand-size를 연다. 홈 안에 손 패널을 열라고 하지 마라. 답변 끝에 홈화면 안내를 넣으세요.",
    };
  }
  if (step === "inbody") {
    return {
      shown: withHomeTip(
        "다음으로 인바디를 등록해요. 결과지 사진은 필수예요. 지금 채팅에 올려 주세요.",
      ),
      model: "다음이 인바디 등록(필수). 채팅 결과지 사진으로 save-inbody. 건너뛰지 마세요. 답변 마지막에 홈화면 안내.",
    };
  }
  return {
    shown: withHomeTip(
      "준비됐어요. 이제 식사 사진 기록, 바코드 스캔, 맞춤 운동, 주간 차트를 말로 바로 불러올 수 있어요. 예: `식단 사진이랑 음식명 올릴게`, `바코드 찍을래`, `오늘 맞춤 운동 짜줘`, `탄단지 차트 보여줘`.",
    ),
    model: "온보딩 완료. 핵심 발화 4가지(식사 사진+음식명, 바코드, 맞춤 운동, 탄단지 차트)를 한 번만 안내하고 오늘 식사를 받아 주세요. 답변 끝에 홈화면 안내.",
  };
}

export function normalizeDisplayName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 16) return null;
  if (!/^[\p{L}\p{N} .·'-]+$/u.test(name)) return null;
  return name;
}

export async function accountId(
  extra: {
    mcpReq?: { _meta?: { "openai/subject"?: string } };
    http?: { authInfo?: { extra?: { subject?: string } } };
    authInfo?: { extra?: { subject?: string } };
  },
  accountKey?: string,
) {
  // Same login check as get-user and the home card, so a save is refused
  // exactly when home shows "로그인 필요" and never otherwise.
  const identity = await identify(extra, accountKey, { wait: true });
  if (identity.state === "ready") return identity.userId;
  const problem = identityProblem(identity);
  // Widgets print this message; only a model can hit the keyless states.
  throw new Error(
    identity.state === "login"
      ? problem.shown
      : `${problem.shown} ${problem.model}`,
  );
}

/** users.id for cards that open without saving; undefined unless logged in. */
export async function readyUserId(
  extra: Parameters<typeof identify>[0],
  accountKey?: string,
) {
  const identity = await identify(extra, accountKey, { wait: true });
  return identity.state === "ready" ? identity.userId : undefined;
}

/**
 * Key the host LLM should hold when it called without a logged-in key.
 * Empty when the caller is already known.
 */
export async function issueConversationKey(
  identity: Awaited<ReturnType<typeof identify>>,
  accountKey?: string,
) {
  if (identity.state === "ready") return "";
  const key = normalizeAccountKey(accountKey) ?? mintConversationKey();
  await markConversationKeyPending(key);
  return key;
}

export function accountKeyField() {
  return { accountKey: accountKeySchema };
}

/** Device local civil date + IANA TZ from the widget (or host if known). */
export function clientClockFields() {
  return {
    clientDate: z
      .string()
      .optional()
      .describe(
        "기기 로컬 날짜 YYYY-MM-DD. 홈·위젯이 넘긴다. date보다 기기 기준 ‘오늘’을 쓸 때 넣는다.",
      ),
    clientTimeZone: z
      .string()
      .optional()
      .describe(
        "기기 IANA 타임존. 예: Asia/Seoul, America/New_York. 위젯이 넘긴다.",
      ),
  };
}

export function guestKey(userId: string | undefined): string {
  if (!userId) return "";
  return userId.startsWith("guest_") || userId.startsWith("user_")
    ? userId
    : "";
}

export const etagField = z
  .string()
  .describe(
    "최근 15분 안에 조회 도구가 그 기록에 발급한 etag. 지어내지 않는다. 없거나 오래됐으면 조회 도구를 다시 호출한다.",
  );

export const etagFailure: Record<Exclude<EtagCheck, "ok">, string> = {
  missing: "etag가 없습니다. 기록을 먼저 조회한 뒤 다시 시도해 주세요.",
  expired: "조회한 지 15분이 지났습니다. 기록을 다시 조회한 뒤 시도해 주세요.",
  mismatch:
    "조회한 뒤에 기록이 바뀌었거나 etag가 맞지 않습니다. 기록을 다시 조회해 주세요.",
};

export function preconditionFailed(reason: Exclude<EtagCheck, "ok"> | "not_found") {
  const message =
    reason === "not_found"
      ? "그 기록을 찾지 못했습니다. 이미 지워졌을 수 있어요. 다시 조회해 주세요."
      : etagFailure[reason];
  return {
    content: [
      shown(message),
      modelOnly(
        `precondition_failed (${reason}). 수정·삭제를 하지 않았습니다. 조회 도구를 다시 호출해 새 etag를 받은 뒤, 사용자가 원하면 한 번 더 시도하세요.`,
      ),
    ],
    structuredContent: {
      ok: false,
      error: "precondition_failed",
      reason,
      message,
    },
    isError: true as const,
  };
}

/** Tone picker removed — always the same default meal-miss line. */
export function mealMissCopy() {
  return DEFAULT_MEAL_MISS;
}

export const workoutEntrySchema = z.object({
  exercise: z.string().describe("종목 이름. 예: 스쿼트, 벤치프레스, 러닝"),
  kind: z
    .enum(workoutKinds)
    .describe("strength는 중량 운동, cardio는 유산소"),
  weightKg: z
    .number()
    .nonnegative()
    .optional()
    .describe("한 세트의 중량(kg). 유산소나 맨몸이면 생략"),
  reps: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("세트당 횟수. 유산소면 생략"),
  sets: z.number().int().nonnegative().optional().describe("세트 수"),
  durationMin: z
    .number()
    .nonnegative()
    .optional()
    .describe("운동 시간(분). 사용자가 말했을 때만 넣는다"),
  burnedKcal: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "호스트가 추정한 소모 kcal. lookup-workout-burn·저장 시 이 값을 쓴다. MET를 사용자에게 묻지 않는다.",
    ),
});

export function normalizeWorkoutEntry(entry: z.infer<typeof workoutEntrySchema>) {
  return {
    exercise: entry.exercise.replace(/\s+/g, " ").trim(),
    kind: entry.kind,
    weightKg: entry.weightKg ?? 0,
    reps: entry.reps ?? 0,
    sets: entry.sets ?? 0,
    durationMin: entry.durationMin ?? 0,
    burnedKcal:
      typeof entry.burnedKcal === "number" && entry.burnedKcal > 0
        ? Math.round(entry.burnedKcal)
        : 0,
  };
}

export const homeIntentValues = [
  "today",
  "diet-chart",
  "inbody-chart",
  "inbody-setup",
  "name",
  "hand",
  "meal",
  "workout-log",
  "workout-plan",
  "body-goal",
  "workout-chart",
  "habit-calendar",
  "barcode",
  "meal-logs",
  "login",
] as const;

export const homeIntentSchema = z
  .enum(homeIntentValues)
  .optional()
  .describe(
    'accountKey가 없을 때 bootstrap용으로만 쓸 수 있다. 키가 있으면 이 intent 대신 해당 View Tool을 직접 호출한다. 예: inbody-chart→show-inbody-chart, workout-plan→recommend-inbody-workout, body-goal→choose-body-goal, barcode→scan-food-barcode, meal-logs→get-diet-period, login→로그인 카드. accountKey를 지어내지 않는다.',
  );

export function rememberAccountKey(userId: string) {
  return userId.startsWith("guest_") || userId.startsWith("user_")
    ? modelOnly(
        `이 사용자의 accountKey는 ${userId}이다. openai/subject가 없을 때는 이후 모든 사용자 도구에 accountKey로 이 값을 그대로 넘긴다. 사용자에게 보여 주거나 물어보지 않는다.`,
      )
    : null;
}

export const homeIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3.5 8.5 10 3.5l6.5 5V16a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V8.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 17v-5h4v5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
export const homeIcon = {
  src: `data:image/svg+xml,${encodeURIComponent(homeIconSvg)}`,
  mimeType: "image/svg+xml" as const,
};

export const emptyHomeProfile = {
  loginRequired: true,
  loginSaved: false,
  nameSaved: false,
  displayName: "",
  toneSaved: true,
  toneLevel: 0,
  toneTitle: "",
  handSaved: false,
  handLengthCm: 0,
  handWidthCm: 0,
  handfulVolumeMl: 0,
  inbodySaved: false,
  measuredOn: "",
  weightKg: 0,
  skeletalMuscleKg: 0,
  bodyFatKg: 0,
  bodyFatPercent: 0,
  bodyGoalSaved: false,
  bodyGoalTitle: "",
  targetDays: 0,
  mealLoggedToday: false,
  lastAuthProvider: "",
  email: "",
  lastLoginAt: "",
  energyToday: null as DailyEnergyPlan | null,
};

export async function todayEnergyFor(userId: string, user: Awaited<ReturnType<typeof getUserProfile>>) {
  const today = seoulToday();
  const meals = await listMealLogs(userId, today, today);
  const workouts = await listWorkoutLogs(userId, today, today);
  const intakeKcal = meals.reduce((sum, row) => sum + row.kcal, 0);
  const intakeCarbG = Math.round(
    meals.reduce((sum, row) => sum + row.carbG, 0),
  );
  const intakeProteinG = Math.round(
    meals.reduce((sum, row) => sum + row.proteinG, 0),
  );
  const intakeFatG = Math.round(meals.reduce((sum, row) => sum + row.fatG, 0));
  const intakeCarbKcal = Math.round(intakeCarbG * 4);
  const intakeProteinKcal = Math.round(intakeProteinG * 4);
  const intakeFatKcal = Math.round(intakeFatG * 9);
  const exerciseKcal = workouts.reduce((sum, row) => sum + row.burnedKcal, 0);
  return resolveDailyEnergyPlan(
    {
      weightKg: user?.weightKg ?? null,
      bodyFatKg: user?.bodyFatKg ?? null,
      heightCm: user?.heightCm ?? null,
      sex: user?.sex ?? null,
      targetBodyType: user?.targetBodyType ?? null,
      targetDays: user?.targetDays ?? null,
      goalKcal: user?.goalKcal ?? null,
      goalCarbG: user?.goalCarbG ?? null,
      goalProteinG: user?.goalProteinG ?? null,
      goalFatG: user?.goalFatG ?? null,
      goalBurnKcal: user?.goalBurnKcal ?? null,
    },
    {
      intakeKcal,
      intakeCarbKcal,
      intakeProteinKcal,
      intakeFatKcal,
      intakeCarbG,
      intakeProteinG,
      intakeFatG,
      exerciseKcal,
    },
  );
}

export async function loadHomeProfile(subject: string | undefined) {
  if (!subject) return emptyHomeProfile;
  const user = await getUserProfile(subject);
  const handSaved =
    user?.handLengthCm != null &&
    user.handWidthCm != null &&
    user.handfulVolumeMl != null &&
    user.handfulVolumeMl > 0;
  const inbodySaved =
    user?.weightKg != null &&
    user.skeletalMuscleKg != null &&
    user.bodyFatKg != null;
  // MVP: 실명은 쓰지 않고 고객님으로만 부른다.
  const rawDisplayName = user?.displayName?.trim() ?? "";
  const displayName = MVP_SKIP_USER_NAME ? MVP_CALL_NAME : rawDisplayName;
  const nameSaved = MVP_SKIP_USER_NAME ? true : rawDisplayName.length > 0;
  const bodyGoal = findBodyGoal(user?.targetBodyType);
  const today = seoulToday();
  const mealLoggedToday = await hasMealOnDate(subject, today);
  const energyToday = await todayEnergyFor(subject, user);
  return {
    nameSaved,
    displayName,
    toneSaved: true,
    toneLevel: 0,
    toneTitle: "",
    handSaved,
    handLengthCm: user?.handLengthCm ?? 0,
    handWidthCm: user?.handWidthCm ?? 0,
    handfulVolumeMl: user?.handfulVolumeMl ?? 0,
    inbodySaved,
    measuredOn: inbodySaved ? (user?.inbodyMeasuredOn ?? "") : "",
    weightKg: user?.weightKg ?? 0,
    skeletalMuscleKg: user?.skeletalMuscleKg ?? 0,
    bodyFatKg: user?.bodyFatKg ?? 0,
    bodyFatPercent: user?.bodyFatPercent ?? 0,
    bodyGoalSaved: bodyGoal !== null,
    bodyGoalTitle: bodyGoal?.title ?? "",
    targetDays: user?.targetDays ?? 0,
    mealLoggedToday,
    lastAuthProvider: user?.lastAuthProvider ?? "",
    email: user?.email ?? "",
    lastLoginAt: user?.lastLoginAt ?? "",
    energyToday,
  };
}

export function normalizeFood(food: {
  foodName: string;
  grams: number;
  kcal: number;
  carbG?: number;
  proteinG?: number;
  fatG?: number;
}) {
  return {
    foodName: food.foodName,
    grams: food.grams,
    kcal: food.kcal,
    carbG: food.carbG ?? 0,
    proteinG: food.proteinG ?? 0,
    fatG: food.fatG ?? 0,
  };
}

