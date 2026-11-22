import { FileRef, Skybridge, text } from "skybridge/server";
import { z } from "zod";
import { affiliateFor, affiliateRedirectDomains } from "./affiliate.js";
import { mountAuthRoutes } from "./auth-routes.js";
import { lookupBarcode } from "./barcode.js";
import {
  buildAuthorizeUrl,
  createLoginAttempt,
  listLinkedProviders,
  oauthConfigured,
  oauthPublicBase,
  readLoginAttempt,
  signOAuthState,
  type OAuthEnv,
  type OAuthProvider,
} from "./oauth.js";
import {
  addDays,
  daysBetween,
  deleteMealLog,
  deleteWorkoutLog,
  getDb,
  getEtagSecret,
  getHandProfile,
  getInbody,
  getLastMealDate,
  getMealLog,
  getUserProfile,
  getWorkoutLog,
  hasMealOnDate,
  INBODY_MIN_INTERVAL_DAYS,
  clearPendingWorkoutBurn,
  findExercisesByName,
  getPendingMealPortions,
  getPendingWorkoutBurn,
  insertExercises,
  insertWorkoutLogs,
  listExercises,
  upsertPendingMealPortions,
  upsertPendingWorkoutBurn,
  listInbodyReadings,
  listMealLogs,
  listWorkoutLogs,
  saveBodyProfile,
  saveDisplayName,
  saveGoals,
  saveHandProfile,
  saveInbody,
  saveMealPhoto,
  clearTargetBodyGoal,
  listWorkoutWeekPlansOverlapping,
  saveTargetBodyType,
  seoulToday,
  updateMealLogGrams,
  getWorkoutWeekPlan,
  upsertWorkoutWeekPlan,
} from "./db/client.js";
import { lookupFoods, nutrientSource } from "./db/food-lookup.js";
import {
  mealLogs,
  mealSlots,
  sexes,
  targetBodyTypes,
  workoutKinds,
  workoutModes,
} from "./db/schema.js";
import { checkEtag, type EtagCheck, issueEtag } from "./etag.js";
import {
  dayStatus,
  goalSourceLabel,
  resolveDailyEnergyPlan,
  resolveGoals,
  type DailyEnergyPlan,
} from "./goals.js";
import {
  bodyGoalLabel,
  bodyGoalPresets,
  findBodyGoal,
  type TargetBodyType,
} from "./body-goals.js";
import {
  injuredPartIds,
  injuredPartLabel,
  modeLabel,
  overrideCopy,
  persuasionCopy,
  regionValues,
  scaleTimer,
  homeEquipmentIds,
  homeEquipmentNeeded,
  normalizeHomeEquipment,
  trainingVenues,
  venueOf,
  workoutTimerModes,
  type HomeEquipment,
  type InjuredPart,
  type PlannedExercise,
  type StructuralIssue,
  type TrainingVenue,
  type WorkoutTimerMode,
} from "./inbody-analyzer.js";
import {
  estimate1RM,
  inferLiftCategory,
} from "./strength-calculator.js";
import {
  evidenceForPlan,
  evidenceRedirectDomains,
  formatEvidenceForModel,
} from "./workout-evidence.js";
import { glossaryList } from "./workout-glossary.js";
import { slotByRole, exerciseRoleIds } from "./workout-schedule.js";
import {
  buildWeekPlanPayload,
  homeEquipmentKey,
  parseWeekPlanPayload,
  pickWeekPlanDay,
  seoulWeekBounds,
  weekPlanFingerprint,
  weekPlanHasGaps,
  type WeekPlanPayload,
} from "./workout-week-plan.js";
import { resolveClientDay } from "./device-time.js";
import {
  TREE_STAGE_COUNT,
  TREE_STAGE_META,
  growthStageFromGoodDays,
} from "./habit-stickers.js";
import { searchExerciseHowto } from "./youtube-howto.js";
import { proposeMissingFood, foodEnergySearchQuery, sameFoodLabel } from "./missing-food.js";
import {
  findExactFood,
  searchFoodCandidatesMany,
} from "./db/food-lookup.js";
import { mealCoachMode } from "./meal-coach.js";
import {
  finalizePortionEnergy,
  parseAmountNote,
  parseStoredPortions,
  portionNeedsSavedHand,
  resolvePortionGrams,
  type PortionRequest,
} from "./meal-portions.js";
import { MVP_CALL_NAME, MVP_SKIP_USER_NAME } from "./mvp.js";
import {
  getTrainingDocChunks,
  listTrainingDocs,
  searchTrainingDocs,
  trainingDocTopics,
} from "./training-docs.js";
import { DEFAULT_MEAL_MISS } from "./tone.js";
import {
  claimConversationKey,
  identify,
  identityProblem,
  markConversationKeyPending,
  mintConversationKey,
} from "./identity.js";
import { accountKeySchema, normalizeAccountKey } from "./user-id.js";
import { estimateVolumes } from "./volume.js";
import {
  estimateBurnedKcal,
  estimateOneRm,
  parseWorkoutNote,
  weekStart,
  workoutVolume,
} from "./workout.js";

const inbodyMetrics = [
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
const chartMetrics = [
  "kcal",
  "carbG",
  "proteinG",
  "fatG",
  "balance",
  "burnedKcal",
] as const;
const chartVisuals = ["bar", "line", "area"] as const;
const chartAxes = ["left", "right"] as const;

const chartSeriesSchema = z.object({
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

const inbodySeriesSchema = z.object({
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

function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime() && dates.length < 366) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

const foodItemSchema = z.object({
  foodName: z.string().describe("음식 이름"),
  grams: z.number().describe("추정 중량(g)"),
  kcal: z.number().describe("그 중량의 칼로리"),
  carbG: z.number().optional().describe("탄수화물(g). 모르면 생략"),
  proteinG: z.number().optional().describe("단백질(g). 모르면 생략"),
  fatG: z.number().optional().describe("지방(g). 모르면 생략"),
});

function shown(value: string) {
  return text(value, { audience: ["user", "assistant"] });
}

function modelOnly(value: string) {
  return text(value, { audience: ["assistant"] });
}

/** Host models often send "10" or "10kcal". Drop the field instead of failing the tool. */
function loosePositive(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] ?? "")
        : Number.NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

function looseNonNegative(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] ?? "")
        : Number.NaN;
  return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}

const loosePositiveNumber = z.preprocess(
  loosePositive,
  z.number().positive().optional(),
);
const looseNonNegativeNumber = z.preprocess(
  looseNonNegative,
  z.number().nonnegative().optional(),
);

/** 사용자에게 보이는 모든 안내의 마지막 줄. */
const homeTip =
  "모르는 게 있을 때는 `홈화면`을 검색해 보세요. 모든 기능은 홈화면에서 볼 수 있어요.";

function withHomeTip(message: string) {
  return `${message}\n\n${homeTip}`;
}

function guideNextStep(step: "hand" | "inbody" | "meal") {
  if (step === "hand") {
    return {
      shown: withHomeTip(
        "다음으로 손 크기를 등록해요. 카드와 손 사진으로 치수를 재고, 참고 사진처럼 네 손가락이 손바닥을 덮는 형태로 생쌀 1줌을 쥔 뒤 무게(g) 또는 컵·그릇 지름·높이를 알려 주세요. 한식 반찬 kcal 계산에 씁니다.",
      ),
      model: "다음이 손 크기·1줌 등록이라고 짧게 말하세요. 카드+손 사진, 생쌀은 참고 사진처럼 네 손가락이 손바닥을 덮는 형태로 쥔 뒤 무게 또는 컵·그릇 지름·높이를 받습니다. 다른 손 사진을 또 찍으라고 하지 마세요. 홈 손 치수 카드 또는 preview-hand-size로 저장. 답변 끝에 홈화면 안내.",
    };
  }
  if (step === "inbody") {
    return {
      shown: withHomeTip(
        "다음으로 인바디를 등록해요. 결과지 사진은 필수예요. 지금 올려 주세요.",
      ),
      model: "사용자에게 다음이 인바디 등록(필수)이라고 짧게 말하고 결과지 사진을 지금 요청하세요. 건너뛰지 마세요. 답변 마지막에 홈화면 안내를 넣으세요.",
    };
  }
  return {
    shown: withHomeTip(
      "준비됐어요. 식사는 매일 기록해요. 사진 올리고, 차트·손·인바디는 홈화면에서 고를 수 있어요.",
    ),
    model: "온보딩이 끝났다. 매일 식사 기록이 필수라고 말하고 오늘 식사를 받아 주세요. 답변 마지막에 홈화면 안내를 넣으세요.",
  };
}

function normalizeDisplayName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 16) return null;
  if (!/^[\p{L}\p{N} .·'-]+$/u.test(name)) return null;
  return name;
}

async function accountId(
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
async function readyUserId(
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
async function issueConversationKey(
  identity: Awaited<ReturnType<typeof identify>>,
  accountKey?: string,
) {
  if (identity.state === "ready") return "";
  const key = normalizeAccountKey(accountKey) ?? mintConversationKey();
  await markConversationKeyPending(key);
  return key;
}

function accountKeyField() {
  return { accountKey: accountKeySchema };
}

/** Device local civil date + IANA TZ from the widget (or host if known). */
function clientClockFields() {
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

function guestKey(userId: string | undefined): string {
  if (!userId) return "";
  return userId.startsWith("guest_") || userId.startsWith("user_")
    ? userId
    : "";
}

const etagField = z
  .string()
  .describe(
    "최근 15분 안에 조회 도구가 그 기록에 발급한 etag. 지어내지 않는다. 없거나 오래됐으면 조회 도구를 다시 호출한다.",
  );

const etagFailure: Record<Exclude<EtagCheck, "ok">, string> = {
  missing: "etag가 없습니다. 기록을 먼저 조회한 뒤 다시 시도해 주세요.",
  expired: "조회한 지 15분이 지났습니다. 기록을 다시 조회한 뒤 시도해 주세요.",
  mismatch:
    "조회한 뒤에 기록이 바뀌었거나 etag가 맞지 않습니다. 기록을 다시 조회해 주세요.",
};

function preconditionFailed(reason: Exclude<EtagCheck, "ok"> | "not_found") {
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
function mealMissCopy() {
  return DEFAULT_MEAL_MISS;
}

const workoutEntrySchema = z.object({
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

function normalizeWorkoutEntry(entry: z.infer<typeof workoutEntrySchema>) {
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

const homeIntentValues = [
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
  "nutrient-flow",
  "barcode",
  "meal-logs",
  "login",
] as const;

const homeIntentSchema = z
  .enum(homeIntentValues)
  .optional()
  .describe(
    'Claude처럼 accountKey를 모를 때 쓴다. 인바디·차트·달력·영양 흐름·운동·바코드·로그인·이름을 채팅으로 물으면 open-home에 이 intent를 넣어 호출한다. 예: "인바디 보여줘" → inbody-chart, "오늘 운동 추천" → workout-plan, "목표 체형" → body-goal, "로그인" → login, "바코드 찍을게" → barcode, "어제 기록 고칠래" → meal-logs. 위젯이 저장된 accountKey로 바로 연다. accountKey를 지어내지 않는다.',
  );

function rememberAccountKey(userId: string) {
  return userId.startsWith("guest_") || userId.startsWith("user_")
    ? modelOnly(
        `이 사용자의 accountKey는 ${userId}이다. openai/subject가 없을 때는 이후 모든 사용자 도구에 accountKey로 이 값을 그대로 넘긴다. 사용자에게 보여 주거나 물어보지 않는다.`,
      )
    : null;
}

const homeIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3.5 8.5 10 3.5l6.5 5V16a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V8.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 17v-5h4v5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const homeIcon = {
  src: `data:image/svg+xml,${encodeURIComponent(homeIconSvg)}`,
  mimeType: "image/svg+xml" as const,
};

const emptyHomeProfile = {
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

async function todayEnergyFor(userId: string, user: Awaited<ReturnType<typeof getUserProfile>>) {
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

async function loadHomeProfile(subject: string | undefined) {
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

function normalizeFood(food: {
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

export const app = new Skybridge({
  name: "Hands-On Diet",
  version: "0.0.1",
  instructions:
    "이 앱의 이름은 Hands-On Diet이다. 말은 독해도 개그가 있어야 하고, 듣고 나서 기분만 나쁘면 실패다. 식단, 손 치수, 인바디, 이름은 ChatGPT의 openai/subject, 또는 Claude용 accountKey(guest_/user_ UUID)로 나뉜다. 사용자에게 아이디를 묻지 않는다. Claude·새 기기처럼 openai/subject가 없으면 Google/카카오 회원가입 또는 로그인이 이름보다 먼저다. Google·카카오는 이메일로 Cloudflare D1 사용자를 맞춘다. 가입 시 OAuth 닉네임이 displayName이 되며 nameSaved true이면 set-display-name을 건너뛴다. open-home 결과에는 그 대화에서 쓸 accountKey가 적혀 있고, 홈 위젯이 그 키를 이 기기의 로그인에 연결한다. 로그인 여부는 open-home이 아니라 그 accountKey로 부른 get-user의 loginRequired로만 판단한다. identityPending이나 needsBootstrap이 오면 ‘로그인이 안 됐다’고 말하지 않고, open-home이 준 accountKey로 다시 호출한다. get-user의 loginRequired가 true이면 이름·손을 묻지 말고 open-home을 intent login으로 열거나 홈이 로그인 카드를 띄우게 한다. 로그인 전에 set-display-name을 열지 않는다. ChatGPT는 openai/subject가 있으면 로그인이 된 것으로 본다. Claude처럼 subject가 없으면 홈·로그인·이름 카드가 준 accountKey(guest_/user_)를 이후 get-user·저장·차트 도구에 그대로 넘긴다. accountKey를 한 번 알면 그 대화에서 절대 버리지 말고 모든 사용자 도구에 넣는다. accountKey를 지어내거나 사용자에게 보여 주지 않는다. Claude에서 accountKey를 모르는 채 인바디·식단 차트·오늘 요약·운동·달력·영양 흐름·바코드·기록 수정·이름을 요청받으면, ‘식별값이 없어서 못 불러온다’고 말하지 말고 바로 open-home을 해당 intent(inbody-chart|diet-chart|today|workout-plan|body-goal|workout-log|workout-chart|habit-calendar|nutrient-flow|barcode|meal-logs|name|login)와 함께 호출한다. 홈 위젯이 저장된 accountKey로 차트를 연다. get-user가 nameSaved false여도 곧이어 이름 카드가 ‘이미 있어요’를 띄우면 이름을 다시 묻지 말고 그 accountKey로 다음 단계로 간다. 대화가 시작되면(첫 인사·첫 요청·커넥터만 켠 직후 포함) 다른 도구보다 먼저 무조건 open-home을 호출한다. get-user는 open-home 다음에, 위젯·컨텍스트의 accountKey를 넣어 호출한다. 홈·메뉴·기능 목록·홈화면을 묻거나 사이드바/패널에서 앱을 열면 open-home을 호출한다. loginRequired가 false인데 setupComplete가 false이거나 missingBasics가 있으면 사용자에게 ‘기본 설정을 등록하세요’라고 말하고, 비어 있는 항목(이름·손 치수·인바디)을 빠짐없이 이어서 등록한다. 인바디와 식사는 필수다. 인바디를 건너뛰지 않는다. MVP에서는 개인 이름을 묻지 말고 항상 ‘고객님’으로만 부른다. set-display-name을 열지 않는다. nameSaved는 항상 true로 본다. 로그인 다음 단계는 손 치수다. ‘다음으로 손 크기를 등록해요’라고 안내하고 카드와 손 사진을 요청한다. 손이 저장되면 ‘다음으로 인바디를 등록해요’라고 안내하고 결과지 사진을 요청한다. 인바디가 저장되면 매일 식사 기록을 하라고 안내한다. handSaved가 false면 신용카드(8.56cm × 5.4cm)와 손을 나란히 찍은 사진을 지금 올려 달라고 하고, 사진이 오면 preview-hand-size를 연다. 손이 저장되기 전에는 식사 사진을 분석하지 않는다. inbodySaved가 false면 결과지 사진을 지금 올려 달라고 하고, 사진이 오면 지표를 읽어 save-inbody로 저장한다. 결과지가 없다고 해서 넘기지 않는다. 인바디는 최소 약 1달(28일) 간격으로만 새로 등록한다. 같은 측정일 수정은 허용한다. setupComplete가 true이면 식사는 매일 등록이 필수다. get-user의 mealMissedDays가 1 이상이면 mealMissLine으로 짧게 혼내고, 오늘 식사 사진을 지금 올리게 한다. mealLoggedToday가 false이면 오늘 식사를 등록하라고 재촉한다. 독해도 유머 있게 말하고, 웃긴 비유 뒤에 다음 한 끼나 내일로 넘긴다. 사용자별 말투 단계 설정은 없다. 욕설은 쓰지 않는다. 손 치수는 카드와 손을 한 번만 저장한다. 그 뒤 식사 사진은 매번 손바닥이 그릇 옆에 보여야 한다. 식사 기록은 카드가 먼저다. 홈의 식사 기록 버튼은 위젯이 컬럼 카드를 바로 연다. 그 턴에는 write-meal-foods를 호출하지 마라. 사용자가 채팅으로 식사 기록을 말하면 사진이 없어도 write-meal-foods를 바로 연다. 채팅에 사진이 있으면 photos와 photoCount에 담는다. 끼니를 미리 묻지 않는다. 음식 이름을 추측하지 않는다. 카드에서 사진마다 아침·점심·저녁·간식과 구성을 고른 뒤 등록하기(record-meal-photos)로 저장한다. 간식은 주요 식사 외 섭취다. 저장이 끝나기 전에는 이미지 분석, preview-meal-photo, lookup-meal-photo를 하지 않는다. 부피·곡률 보정이 필요할 때만 lookup-meal-photo를 쓴다. 손바닥이 없으면 lookup-meal-photo를 호출하지 말고 다시 찍어 달라고 한다. 저장된 손바닥 폭은 그 사진의 손바닥과 그릇을 비교하는 기준이다. 몸무게나 체성분 변화를 물으면 show-inbody-chart를 호출한다. series는 질문 의도에 맞게 고르고, 1주·1달처럼 기간 모양을 고정하지 않는다. 체지방률은 yAxisId right, kg 지표는 left다. 인바디 결과지에 신장과 성별이 보이면 save-inbody에 함께 넣는다. C-I-D 체형 차트의 표준치가 그 둘로 정해진다. 차트는 질문에 맞춰 고른다. 하루 요약은 get-daily-summary-chart(목표 달성 링), 2주 안팎의 추세와 끼니·운동 비교는 show-diet-chart, 목표를 지켰는지는 show-diet-chart에 metric balance, 한 달이 넘는 성실도는 show-habit-calendar, 어떤 음식에서 영양소가 왔는지는 show-nutrient-flow, 운동 성장과 1RM은 show-workout-chart다. 목표 체형(워너비)이 없으면 choose-body-goal을 먼저 연다. 사용자가 인바디 맞춤 운동·오늘 운동 방법·운동 타이머를 물으면 recommend-inbody-workout을 연다. 카드가 추천한 타이머 모드·강도를 사용자가 처음 바꾸려 하면 즉시 바꾸지 말고, 목표 체형·인바디 수치로 설득한다. 그래도 힘들다고 재확인하면 변경을 허용한다. 운동을 마치면 카드가 save-workout-log로 저장한다. C자형·과체중 식사는 1접시 덜어먹기를, 저체중·증량은 한상차림 사진 1장과 공기밥·메인 리필을 안내한다. lookup-meal-photo의 밑반찬은 isSideDish true로 두고 1회 섭취참고량으로 계산한다. 사용자가 이미 한 운동을 종목·중량·횟수로만 말할 때는 log-workout에 넣은 뒤 카드에서 저장하게 한다. 말하지 않은 숫자를 채우지 않는다. 1일 권장 칼로리·탄단지·운동 코스를 설명하거나 고를 때는 먼저 search-training-docs(또는 list-training-docs)로 D1에 있는 참고 문서 청크를 읽고, 그 근거에 맞춰 말한다. topic은 daily_kcal(칼로리·가드레일·탄단지), exercise_selection(종목·분할·볼륨), inbody_1rm(인바디 처방·1RM·RIR)이다. 서버 resolveDailyEnergyPlan·recommend-inbody-workout 수치와 문서가 어긋나면 문서의 안전 가드레일을 우선 설득에 쓰고, 카드에 나온 클램프 값은 그대로 존중한다. 사용자가 목표 칼로리나 탄단지를 말하면 save-goals로 저장한다. 목표를 대신 정하지 않는다. 포장 식품을 바코드로 기록하겠다고 하면 scan-food-barcode를 연다. 저장된 식단을 고치거나 지우려면 먼저 get-diet-period를 호출해 그 줄의 id와 etag를 받고, 사용자가 고른 한 줄만 update-meal-log나 delete-meal-log로 처리한다. 운동 기록은 show-workout-chart의 etag로 delete-workout-log를 쓴다. etag는 15분 뒤 만료된다. precondition_failed가 오면 다시 조회한다. 여러 줄이나 하루치를 한꺼번에 지우지 않는다. 영양 수치를 말할 때는 출처(식품영양성분 데이터베이스, 바코드 제품은 도구가 준 source)를 함께 밝힌다. 추천 상품은 도구 결과에 affiliate.show가 true일 때만 언급하고, 제휴 링크 여부는 카드 표시를 따른다. 사용자에게 보이는 모든 답변의 마지막 줄은 반드시 이 문장이다: 모르는 게 있을 때는 `홈화면`을 검색해 보세요. 모든 기능은 홈화면에서 볼 수 있어요.",

  handler: (server) =>
    server
      .registerTool(
        {
          name: "get-user",
          description:
            "이 사용자의 로그인·손 치수·최신 인바디와 식사·인바디 습관 상태를 한 번에 불러온다. MVP에서는 개인 이름을 쓰지 않고 displayName은 항상 ‘고객님’, nameSaved는 true다. set-display-name을 열지 않는다. 대화 시작의 첫 도구는 open-home이다. open-home 다음에 이 도구를 호출하고, Claude에서는 알려진 accountKey를 넘긴다. accountKey가 비어 needsBootstrap true이면 ‘계정이 없다’·‘로그인이 안 됐다’고 말하지 말고 바로 open-home을 열어 그 결과의 accountKey로 다시 호출한다. identityPending true이면 홈 카드가 계정을 연결하는 중이니 같은 accountKey로 다시 호출한다. loginRequired true이면 이름·손보다 먼저 Google/카카오 회원가입 또는 로그인을 안내하고 open-home intent login 또는 open-login을 연다. loginRequired false이고 setupComplete false면 기본 설정 등록을 안내한다. handSaved false면 preview-hand-size로 손 치수를 받는다. inbodySaved false면 save-inbody로 인바디를 받는다(필수). mealMissedDays가 1 이상이면 식사 누락을 짧게 혼내고 오늘 식사를 받게 한다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Get user profile",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Loading the user profile…",
            "openai/toolInvocation/invoked": "User profile loaded.",
          },
        },
        async ({ accountKey }, extra) => {
          const identity = await identify(extra, accountKey, { wait: true });
          if (identity.state !== "ready") {
            // Only "login" means the device is not logged in. Without a key, or
            // before the home card has linked it, the answer is not known yet.
            const problem = identityProblem(identity);
            const loginRequired = identity.state === "login";
            return {
              content: [
                shown(withHomeTip(problem.shown)),
                modelOnly(problem.model),
              ],
              structuredContent: {
                ...emptyHomeProfile,
                needsBootstrap: identity.state === "unknown",
                identityPending: !loginRequired,
                loginRequired,
                loginSaved: false,
                accountKey:
                  identity.state === "unknown" ? "" : guestKey(identity.userId),
                muscleUpperLeftKg: 0,
                muscleUpperRightKg: 0,
                muscleCoreKg: 0,
                muscleLowerLeftKg: 0,
                muscleLowerRightKg: 0,
                setupComplete: false,
                missingBasics: loginRequired ? ["로그인"] : [],
              },
            };
          }
          const userId = identity.userId;
          const user = await getUserProfile(userId);
          const handSaved =
            user?.handLengthCm != null &&
            user.handWidthCm != null &&
            user.handfulVolumeMl != null &&
            user.handfulVolumeMl > 0;
          const inbodySaved =
            user?.weightKg != null &&
            user.skeletalMuscleKg != null &&
            user.bodyFatKg != null;
          // MVP: 실명 등록을 건너뛰고 고객님으로만 부른다.
          const rawDisplayName = user?.displayName?.trim() ?? "";
          const displayName = MVP_SKIP_USER_NAME
            ? MVP_CALL_NAME
            : rawDisplayName;
          const nameSaved = MVP_SKIP_USER_NAME
            ? true
            : rawDisplayName.length > 0;
          const today = seoulToday();
          const yesterday = addDays(today, -1);
          const lastMealDate = await getLastMealDate(userId);
          const mealLoggedToday = await hasMealOnDate(userId, today);
          const setupComplete =
            (MVP_SKIP_USER_NAME || nameSaved) && handSaved && inbodySaved;
          let mealMissedDays = 0;
          if (setupComplete) {
            if (!lastMealDate) {
              mealMissedDays = 1;
            } else if (lastMealDate < yesterday) {
              mealMissedDays = Math.max(1, daysBetween(lastMealDate, yesterday));
            }
          }
          const lastInbodyOn = inbodySaved ? (user?.inbodyMeasuredOn ?? "") : "";
          const daysSinceInbody =
            lastInbodyOn.length > 0 ? daysBetween(lastInbodyOn, today) : 0;
          const inbodyDue =
            setupComplete && daysSinceInbody >= INBODY_MIN_INTERVAL_DAYS;
          const bodyGoal = findBodyGoal(user?.targetBodyType);
          const energyToday = await todayEnergyFor(userId, user);
          const missingBasics = [
            MVP_SKIP_USER_NAME || nameSaved ? "" : "이름",
            handSaved ? "" : "손 치수",
            inbodySaved ? "" : "인바디",
          ].filter((item) => item.length > 0);
          const mealMissLine =
            mealMissedDays > 0 ? mealMissCopy() : "";
          const profile = {
            needsBootstrap: false,
            identityPending: false,
            loginRequired: false,
            loginSaved: true,
            accountKey: guestKey(userId),
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
            measuredOn: lastInbodyOn,
            weightKg: user?.weightKg ?? 0,
            skeletalMuscleKg: user?.skeletalMuscleKg ?? 0,
            bodyFatKg: user?.bodyFatKg ?? 0,
            bodyFatPercent: user?.bodyFatPercent ?? 0,
            bodyGoalSaved: bodyGoal !== null,
            bodyGoalTitle: bodyGoal?.title ?? "",
            targetDays: user?.targetDays ?? 0,
            lastAuthProvider: user?.lastAuthProvider ?? "",
            email: user?.email ?? "",
            lastLoginAt: user?.lastLoginAt ?? "",
            muscleUpperLeftKg: user?.muscleUpperLeftKg ?? 0,
            muscleUpperRightKg: user?.muscleUpperRightKg ?? 0,
            muscleCoreKg: user?.muscleCoreKg ?? 0,
            muscleLowerLeftKg: user?.muscleLowerLeftKg ?? 0,
            muscleLowerRightKg: user?.muscleLowerRightKg ?? 0,
            setupComplete,
            missingBasics,
            today,
            lastMealDate: lastMealDate ?? "",
            mealLoggedToday,
            mealMissedDays,
            mealMissLine,
            inbodyDue,
            daysSinceInbody,
            inbodyMinIntervalDays: INBODY_MIN_INTERVAL_DAYS,
            energyToday,
          };
          const keyHint = rememberAccountKey(userId);
          if (missingBasics.length > 0) {
            return {
              content: [
                shown(
                  withHomeTip(
                    `기본 설정을 등록하세요. 아직 비어 있는 항목: ${missingBasics.join(", ")}. 지금 이어서 등록할게요.`,
                  ),
                ),
                modelOnly(
                  MVP_SKIP_USER_NAME
                    ? `사용자를 '${MVP_CALL_NAME}'으로만 부르세요. 이름을 묻거나 set-display-name을 열지 마세요. 비어 있는 순서대로 진행합니다. 손은 카드와 손 사진으로 preview-hand-size, 인바디는 결과지 사진으로 save-inbody(필수, 건너뛰지 않음). 각 단계가 끝나면 다음 단계를 한 줄로 안내하고 답변 끝에 홈화면 안내를 넣으세요.`
                    : "사용자에게 기본 설정 등록을 요청하세요. 비어 있는 순서대로 진행합니다. 이름은 set-display-name, 손은 카드와 손 사진으로 preview-hand-size, 인바디는 결과지 사진으로 save-inbody(필수, 건너뛰지 않음). 각 단계가 끝나면 다음 단계를 한 줄로 안내하고 답변 끝에 홈화면 안내를 넣으세요. 이름·손·인바디가 끝나기 전에는 식단 잔소리만 하지 말고 설정 등록을 우선하세요.",
                ),
                ...(keyHint ? [keyHint] : []),
              ],
              structuredContent: profile,
            };
          }
          const habitLines = [
            mealMissedDays > 0
              ? mealMissLine
              : mealLoggedToday
                ? "오늘 식사 기록이 있어요."
                : "오늘 식사 기록이 아직 없어요. 식사 사진을 올려 주세요.",
            inbodyDue
              ? `마지막 인바디가 ${daysSinceInbody}일 전이에요. 한 달 간격이면 새 결과지를 올려도 됩니다.`
              : `인바디는 최소 ${INBODY_MIN_INTERVAL_DAYS}일 간격으로 등록합니다. 마지막 ${lastInbodyOn}.`,
          ];
          return {
            content: [
              shown(
                withHomeTip(
                  `${profile.displayName}. 손 ${profile.handLengthCm}×${profile.handWidthCm}cm, ${profile.measuredOn} 인바디 체중 ${profile.weightKg}kg.\n${habitLines.join("\n")}`,
                ),
              ),
              modelOnly(
                mealMissedDays > 0
                  ? `mealMissedDays=${mealMissedDays}. 식사 누락을 짧게 혼내고, 오늘 식사 사진을 지금 받아 write-meal-foods로 이어가세요. accountKey가 있으면 함께 넘기세요.`
                  : mealLoggedToday
                    ? "기본 설정 완료. 오늘 식사도 있음. 사용자가 원하는 기능으로 진행하세요."
                    : "기본 설정 완료. 오늘 식사가 없음. 오늘 식사 등록을 재촉하고 사진을 받으세요.",
              ),
              ...(keyHint ? [keyHint] : []),
            ],
            structuredContent: profile,
          };
        },
      )
      .registerTool(
        {
          name: "open-home",
          title: "홈",
          description:
            "Hands-On Diet 홈 화면을 연다. 대화가 시작되면(첫 인사·첫 요청·커넥터만 켠 직후 포함) 다른 어떤 도구보다 먼저 무조건 이 도구를 호출한다. 사이드바·대화 패널 진입점이다. 사용자가 메뉴·기능 목록·홈을 물을 때도 호출한다. Claude에서 accountKey를 모르는데 인바디·차트·이름을 보여 달라고 하면, 이 도구에 intent만 넣어 호출한다(예: inbody-chart). 위젯이 저장된 키로 바로 연다. 알려진 accountKey가 있으면 함께 넘긴다. accountKey 없이 호출하면 결과가 이 대화에서 쓸 accountKey를 준다. 그 값을 이후 모든 사용자 도구에 넘긴다. 이 도구의 결과만으로 로그인 여부를 말하지 않는다.",
          icons: [homeIcon],
          inputSchema: {
            ...accountKeyField(),
            intent: homeIntentSchema,
          },
          annotations: {
            title: "Home",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening Hands-On Diet…",
            "openai/toolInvocation/invoked": "Home ready.",
          },
          view: {
            component: "home",
            description: "Hands-On Diet home with feature buttons",
            csp: {
              resourceDomains: [
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
              ],
              redirectDomains: affiliateRedirectDomains,
            },
          },
          openai: {
            entrypoints: [{ type: "global" }, { type: "thread" }],
          },
        },
        async ({ accountKey, intent }, extra) => {
          const identity = await identify(extra, accountKey);
          const ready = identity.state === "ready";
          const userId = ready ? identity.userId : undefined;
          // The server cannot see the device's login here. It never tells the
          // model "not logged in" from this tool: it issues a key, and the home
          // card links that key to whatever login the device already has.
          const conversationKey = await issueConversationKey(
            identity,
            accountKey,
          );
          const profile = await loadHomeProfile(userId);
          const keyHint = userId ? rememberAccountKey(userId) : null;
          const env = (await import("cloudflare:workers")).env as OAuthEnv;
          const linked = userId ? await listLinkedProviders(userId) : [];
          const effectiveIntent = intent ?? "";
          const intentHint = !ready
            ? modelOnly(
                `identityPending=true. 이 대화의 accountKey는 ${conversationKey}이다. 이후 모든 사용자 도구(get-user, save-inbody 등)에 accountKey로 이 값을 그대로 넘긴다. 사용자에게 보여 주거나 물어보지 않는다. 홈 위젯이 이 기기에 저장된 로그인을 이 키에 연결한다. 로그인 여부는 아직 모른다. "로그인이 안 됐다"·"새 기기"라고 말하지 마세요. 로그인·설정 상태가 필요하면 이 accountKey로 get-user를 호출하고 그 결과의 loginRequired만 따르세요. open-login을 따로 호출하지 마세요.${
                  effectiveIntent
                    ? ` intent=${effectiveIntent}. 홈 위젯이 로그인을 확인한 뒤 이 기능을 연다.`
                    : ""
                }`,
              )
            : effectiveIntent
              ? modelOnly(
                  `intent=${effectiveIntent}. 홈 위젯이 저장된 accountKey로 이 기능을 바로 연다. 사용자에게 accountKey가 없거나 인바디를 못 불러왔다고 말하지 마세요. 이름을 다시 등록하라고 하지 마세요. 위젯 결과를 짧게 안내만 하세요.`,
                )
              : modelOnly(
                  "홈 화면을 열었습니다. 대화 시작의 첫 화면입니다. 이미 로그인된 계정입니다. 사용자가 버튼을 누르면 그 요청에 맞는 도구를 호출하세요. 사용자에게 식별 불가·계정 없음을 말하지 마세요. 설정이 비어 있으면 홈에서 이름부터 이어가세요.",
                );
          return {
            content: [intentHint, ...(keyHint ? [keyHint] : [])],
            structuredContent: {
              ...profile,
              // Not ready is "unknown", not "login required": the home card
              // decides from the device's own key and shows the login panel.
              loginRequired: false,
              loginSaved: ready,
              identityPending: !ready,
              intent: effectiveIntent,
              accountKey: guestKey(userId),
              conversationKey,
              // Login panel inside home — do not call open-login (view) from the widget.
              signedIn: ready,
              linked,
              googleReady: oauthConfigured(env, "google"),
              kakaoReady: oauthConfigured(env, "kakao"),
              cloudProfile: {
                displayName: profile.displayName,
                nameSaved: profile.nameSaved,
                lastAuthProvider: profile.lastAuthProvider,
                email: profile.email,
                lastLoginAt: profile.lastLoginAt,
              },
            },
          };
        },
      )
      .registerTool(
        {
          name: "open-login",
          description:
            "Google·카카오 회원가입/로그인 카드를 연다. 이메일이 D1 사용자 키다. Claude·새 기기에서 loginRequired true이면 이름보다 먼저 이 카드를 연다. 가입 시 OAuth 닉네임이 displayName이 된다. ChatGPT는 openai/subject가 있으면 필수는 아니다. Claude에서 accountKey를 모르면 open-home을 intent login으로 호출한다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Open login",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening the login card…",
            "openai/toolInvocation/invoked": "Login card ready.",
          },
          view: {
            component: "login",
            description: "Sign in with Google or Kakao",
            csp: {
              redirectDomains: [
                "https://accounts.google.com",
                "https://kauth.kakao.com",
              ],
            },
          },
        },
        async ({ accountKey }, extra) => {
          const identity = await identify(extra, accountKey);
          const userId =
            identity.state === "ready" ? identity.userId : undefined;
          const conversationKey = await issueConversationKey(
            identity,
            accountKey,
          );
          const env = (await import("cloudflare:workers")).env as OAuthEnv;
          const linked = userId ? await listLinkedProviders(userId) : [];
          const user = userId ? await getUserProfile(userId) : null;
          const rawName = user?.displayName?.trim() ?? "";
          const displayName = MVP_SKIP_USER_NAME ? MVP_CALL_NAME : rawName;
          const nameSaved = MVP_SKIP_USER_NAME ? true : rawName.length > 0;
          return {
            content: [
              shown(
                withHomeTip(
                  linked.length > 0
                    ? `로그인 계정(${displayName})이 연결되어 있어요.`
                    : "Google 또는 카카오로 로그인하면 저장되고, 다른 기기에서도 같은 기록을 불러와요.",
                ),
              ),
              modelOnly(
                `로그인 카드를 열었습니다. 사용자가 버튼을 누르면 start-oauth → finish-oauth 폴링으로 끝납니다. 카드가 로그인 성공 후 스스로 open-home을 엽니다.${
                  conversationKey
                    ? ` 이 대화의 accountKey는 ${conversationKey}이다. 카드가 로그인된 계정에 이 키를 연결한다. 이후 모든 사용자 도구에 accountKey로 그대로 넘기고, 로그인 여부는 이 키로 부른 get-user의 loginRequired만 따르세요. 사용자에게 보여 주지 않는다.`
                    : " 알려진 accountKey를 이후 도구에 그대로 쓰세요."
                }`,
              ),
            ],
            structuredContent: {
              signedIn: linked.length > 0,
              conversationKey,
              linked,
              cloudProfile: {
                displayName,
                nameSaved,
                lastAuthProvider: user?.lastAuthProvider ?? "",
                email: user?.email ?? "",
                lastLoginAt: user?.lastLoginAt ?? "",
              },
              googleReady: oauthConfigured(env, "google"),
              kakaoReady: oauthConfigured(env, "kakao"),
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "link-account-key",
          description:
            "홈·로그인 카드가, open-home·open-login이 준 conversationKey를 이 기기에 저장된 로그인 계정에 연결할 때 호출한다. 카드만 호출한다. 호스트 LLM이 직접 호출하지 않는다.",
          inputSchema: {
            conversationKey: z
              .string()
              .describe("open-home·open-login 결과의 conversationKey"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Link account key",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Checking the account…",
            "openai/toolInvocation/invoked": "Account checked.",
          },
        },
        async ({ conversationKey, accountKey }) => {
          const result = await claimConversationKey({
            conversationKey,
            deviceKey: accountKey,
          });
          return {
            content: [
              modelOnly(
                result.loginSaved
                  ? "이 대화의 accountKey를 로그인된 계정에 연결했습니다."
                  : "이 기기는 아직 로그인 전입니다.",
              ),
            ],
            structuredContent: result,
          };
        },
      )
      .registerTool(
        {
          name: "start-oauth",
          description:
            "로그인/회원가입 카드에서 Google 또는 카카오 인증 URL을 만든다. mode=signup|login. 카드만 호출한다. 호스트 LLM이 직접 호출하지 않는다.",
          inputSchema: {
            provider: z.enum(["google", "kakao"]),
            mode: z.enum(["signup", "login"]).default("login"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Start OAuth",
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: true,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Starting sign-in…",
            "openai/toolInvocation/invoked": "Sign-in URL ready.",
          },
        },
        async ({ provider, mode }) => {
          const env = (await import("cloudflare:workers")).env as OAuthEnv;
          const typed = provider as OAuthProvider;
          const authMode = mode === "signup" ? "signup" : "login";
          if (!oauthConfigured(env, typed)) {
            return {
              content: `${provider} 로그인이 아직 설정되지 않았습니다.`,
              structuredContent: {
                ok: false,
                authorizeUrl: "",
                attemptId: "",
                message: `${provider} 클라이언트 키가 없습니다. 서버 시크릿을 등록한 뒤 다시 시도하세요.`,
              },
            };
          }
          const { attemptId } = await createLoginAttempt({
            provider: typed,
            mode: authMode,
          });
          const state = await signOAuthState(env.OAUTH_STATE_SECRET!, attemptId);
          const baseUrl = oauthPublicBase(env);
          const authorizeUrl = buildAuthorizeUrl({
            env,
            provider: typed,
            state,
            baseUrl,
          });
          return {
            content:
              authMode === "signup"
                ? "회원가입 창 URL을 만들었습니다."
                : "로그인 창 URL을 만들었습니다.",
            structuredContent: {
              ok: true,
              authorizeUrl,
              attemptId,
              mode: authMode,
              message: "",
            },
          };
        },
      )
      .registerTool(
        {
          name: "finish-oauth",
          description:
            "로그인 카드가 OAuth 콜백이 끝났는지 폴링할 때 호출한다. 호스트 LLM이 직접 호출하지 않는다.",
          inputSchema: {
            attemptId: z.string().uuid(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Finish OAuth",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Checking sign-in…",
            "openai/toolInvocation/invoked": "Sign-in checked.",
          },
        },
        async ({ attemptId, accountKey: priorKey }) => {
          const attempt = await readLoginAttempt(attemptId);
          if (!attempt) {
            return {
              content: "로그인 시도를 찾지 못했습니다.",
              structuredContent: {
                status: "error" as const,
                accountKey: "",
                linked: [] as Awaited<ReturnType<typeof listLinkedProviders>>,
                message: "로그인 시도를 찾지 못했습니다. 다시 눌러 주세요.",
              },
            };
          }
          if (attempt.status === "pending") {
            return {
              content: "아직 로그인 중입니다.",
              structuredContent: {
                status: "pending" as const,
                accountKey: "",
                linked: [] as Awaited<ReturnType<typeof listLinkedProviders>>,
                message: "",
              },
            };
          }
          if (attempt.status === "error" || !attempt.userId) {
            return {
              content: attempt.errorMessage || "로그인에 실패했습니다.",
              structuredContent: {
                status: "error" as const,
                accountKey: "",
                linked: [] as Awaited<ReturnType<typeof listLinkedProviders>>,
                message: attempt.errorMessage || "로그인에 실패했습니다.",
              },
            };
          }
          const linked = await listLinkedProviders(attempt.userId);
          const { clientKeyForUserId, linkAccountAlias } = await import(
            "./oauth.js"
          );
          const key =
            attempt.clientAccountKey ||
            (await clientKeyForUserId(attempt.userId));
          // Keep the pre-login guest_ key resolving to this OAuth user so the
          // host LLM does not keep calling get-user with a "not logged in" guest.
          await linkAccountAlias(priorKey, attempt.userId);
          await linkAccountAlias(key, attempt.userId);
          const user = await getUserProfile(attempt.userId);
          const rawName = user?.displayName?.trim() ?? "";
          const displayName = MVP_SKIP_USER_NAME ? MVP_CALL_NAME : rawName;
          const nameSaved = MVP_SKIP_USER_NAME ? true : rawName.length > 0;
          const cloudProfile = {
            displayName,
            nameSaved,
            toneSaved: true,
            handSaved:
              user?.handLengthCm != null &&
              user.handWidthCm != null &&
              user.handfulVolumeMl != null &&
              user.handfulVolumeMl > 0,
            inbodySaved: user?.weightKg != null,
            lastAuthProvider: user?.lastAuthProvider ?? "",
            email: user?.email ?? "",
            lastLoginAt: user?.lastLoginAt ?? "",
          };
          const message = MVP_SKIP_USER_NAME
            ? `기록을 불러왔습니다. '${MVP_CALL_NAME}'으로 부르세요. 이름을 묻지 마세요. 이후 도구에 이 accountKey를 그대로 쓰세요.`
            : nameSaved
              ? `'${displayName}' 기록을 불러왔습니다. OAuth 닉네임을 Hands-On Diet 이름으로 씁니다. 이후 도구에 이 accountKey를 그대로 쓰세요.`
              : "계정을 저장했습니다. 홈에서 이름을 이어 등록하세요.";
          const remember = rememberAccountKey(key);
          return {
            content: [
              shown(
                MVP_SKIP_USER_NAME
                  ? `${MVP_CALL_NAME}, 기록을 불러왔어요.`
                  : nameSaved
                    ? `${displayName}으로 이어갈게요. 기록을 불러왔어요.`
                    : "계정을 저장했어요. 홈으로 이어갈게요.",
              ),
              modelOnly(
                MVP_SKIP_USER_NAME
                  ? `loginDone=true. loginRequired=false. accountKey=${key}. 사용자는 이미 로그인했다. '${MVP_CALL_NAME}'으로만 부르세요. set-display-name을 열지 마세요. "아직 로그인 전"·"로그인해 주세요"·"로그인 카드"를 말하지 마세요. 손·인바디로 이어가세요.`
                  : `loginDone=true. loginRequired=false. accountKey=${key}. 사용자는 이미 로그인했다. "아직 로그인 전"·"로그인해 주세요"·"로그인 카드"를 말하지 마세요. 인바디는 이 accountKey로 save-inbody를 바로 호출하세요. 예전 guest_ 키가 있어도 같은 계정이다.`,
              ),
              ...(remember ? [remember] : []),
            ],
            structuredContent: {
              status: "done" as const,
              accountKey: key,
              linked,
              cloudProfile,
              message,
            },
          };
        },
      )
      .registerTool(
        {
          name: "set-display-name",
          description:
            "MVP에서는 호출하지 않는다. 사용자는 ‘고객님’으로만 부른다. (이후 단계에서만) 사용자가 자기 이름을 적는 카드를 바로 연다. 저장 여부를 조회하지 않는다. 저장된 이름이 없거나 이름을 바꾸겠다고 하면 호출한다. 이름을 대화로 묻지 않는다. Claude에서는 알려진 accountKey를 넘긴다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Set display name",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening the name card…",
            "openai/toolInvocation/invoked": "Name card ready.",
          },
          view: {
            component: "set-display-name",
            description: "Type the name the trainer should use",
          },
        },
        async ({ accountKey }, extra) => {
          const userId = await readyUserId(extra, accountKey);
          return {
            content: [
              modelOnly(
                "이름 카드를 열었습니다. 사용자가 저장할 때까지 기다리세요. 대화로 이름을 받지 마세요.",
              ),
            ],
            structuredContent: {
              saved: false,
              displayName: "",
              accountKey: userId?.startsWith("guest_") ? userId : "",
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-display-name",
          description:
            "이름 카드에서 사용자가 적은 이름을 users.display_name에 저장한다. 카드 버튼으로만 호출한다. 계정 번호로 쓰지 않는다. Claude에서는 카드의 accountKey를 함께 넘긴다.",
          inputSchema: {
            name: z.string().describe("사용자가 카드에 적은 이름"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save display name",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the name…",
            "openai/toolInvocation/invoked": "Name saved.",
          },
        },
        async ({ name, accountKey }, extra) => {
          const displayName = normalizeDisplayName(name);
          if (!displayName) {
            return {
              content: [
                shown("이름은 1~16자의 글자로 저장합니다. 카드에서 다시 적어 주세요."),
              ],
              structuredContent: { saved: false, displayName: "", accountKey: "" },
              isError: true,
            };
          }
          const identity = await identify(extra, accountKey, { wait: true });
          if (identity.state !== "ready") {
            const problem = identityProblem(identity);
            return {
              content: [
                shown(withHomeTip(problem.shown)),
                modelOnly(problem.model),
              ],
              structuredContent: { saved: false, displayName: "", accountKey: "" },
              isError: true,
            };
          }
          const userId = identity.userId;
          await saveDisplayName(userId, displayName);
          const keyHint = rememberAccountKey(userId);
          const next = guideNextStep("hand");
          return {
            content: [
              shown(
                withHomeTip(
                  `${displayName} 이름으로 저장했습니다. 다음으로 손 크기를 등록해요.`,
                ),
              ),
              modelOnly(
                `이제 ${displayName}으로 부르세요. ${next.model}`,
              ),
              ...(keyHint ? [keyHint] : []),
            ],
            structuredContent: {
              saved: true,
              displayName,
              accountKey: guestKey(userId),
              nextStep: "hand",
            },
          };
        },
      )
      .registerTool(
        {
          name: "get-daily-summary-chart",
          description:
            "하루(생략하면 오늘) 요약을 목표 달성 링으로 보여 준다. 활동 칼로리·탄수화물·단백질·지방 달성률과 끼니별 칼로리가 나온다. 목표는 save-goals로 저장한 값이고, 없으면 인바디로 추정한다. Claude에서 accountKey를 모르면 open-home을 intent today로 호출한다. accountKey를 지어내지 않는다.",
          inputSchema: {
            date: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Daily diet summary",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Loading the diet summary…",
            "openai/toolInvocation/invoked": "Diet summary ready.",
          },
          view: {
            component: "daily-summary",
            description: "Daily goal rings and meal calories",
            csp: {
              resourceDomains: [
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
              ],
              redirectDomains: affiliateRedirectDomains,
            },
          },
        },
        async ({ date, accountKey }, extra) => {
          const day = date && date.length > 0 ? date : seoulToday();
          const userId = await accountId(extra, accountKey);
          const [meals, workouts, user] = await Promise.all([
            listMealLogs(userId, day, day),
            listWorkoutLogs(userId, day, day),
            getUserProfile(userId),
          ]);
          const totals = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
          let carb = 0;
          let protein = 0;
          let fat = 0;
          for (const row of meals) {
            totals[row.meal] += row.kcal;
            carb += row.carbG;
            protein += row.proteinG;
            fat += row.fatG;
          }
          const breakfast = Math.round(totals.breakfast);
          const lunch = Math.round(totals.lunch);
          const dinner = Math.round(totals.dinner);
          const snack = Math.round(totals.snack);
          const kcal = breakfast + lunch + dinner + snack;
          const carbG = Math.round(carb);
          const proteinG = Math.round(protein);
          const fatG = Math.round(fat);
          const burned = Math.round(
            workouts.reduce((sum, row) => sum + row.burnedKcal, 0),
          );
          const goals = resolveGoals(user);
          const ring = (
            key: "activity" | "carb" | "protein" | "fat",
            label: string,
            value: number,
            goal: number,
            unit: "kcal" | "g",
          ) => ({
            key,
            label,
            value,
            goal,
            unit,
            percent: goal > 0 ? Math.round((value / goal) * 100) : 0,
          });
          const rings = [
            ring("activity", "활동 칼로리", burned, goals.burnKcal, "kcal"),
            ring("carb", "탄수화물", carbG, goals.carbG, "g"),
            ring("protein", "단백질", proteinG, goals.proteinG, "g"),
            ring("fat", "지방", fatG, goals.fatG, "g"),
          ];
          const logged = meals.length > 0;
          const proteinGap = logged ? Math.max(0, goals.proteinG - proteinG) : 0;
          const remaining = goals.kcal - kcal;
          const feedback = !logged
            ? "이 날은 식사 기록이 없습니다. 한 끼만 올려도 링이 돌기 시작해요."
            : remaining < 0
              ? `목표보다 ${-remaining}kcal 많습니다. 다음 한 끼는 가볍게 가 봐요.`
              : `목표까지 ${remaining}kcal 남았어요. 다음 한 끼가 승부처입니다.`;
          const affiliate = await affiliateFor(
            proteinGap > 0 ? { kind: "protein", gapG: proteinGap } : null,
          );
          return {
            content: logged
              ? `${day} 섭취 ${kcal}kcal(목표 ${goals.kcal}kcal, ${goalSourceLabel[goals.source]}), 소모 ${burned}kcal. 아침 ${breakfast}, 점심 ${lunch}, 저녁 ${dinner}, 간식 ${snack}. 탄 ${carbG}g, 단 ${proteinG}g, 지 ${fatG}g. ${feedback} 출처: ${nutrientSource.ko}`
              : `${day} ${feedback}`,
            structuredContent: {
              date: day,
              breakfast,
              lunch,
              dinner,
              snack,
              kcal,
              carbG,
              proteinG,
              fatG,
              burned,
              goalKcal: goals.kcal,
              goalSource: goals.source,
              goalSourceLabel: goalSourceLabel[goals.source],
              rings,
              toneLevel: 0,
              feedback,
              source: logged ? nutrientSource : null,
              affiliate,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "preview-meal-kcal",
          description:
            "Open a meal correction card. The host reads the meal photo first and passes only structured fields: food name, kcal per 100g, and estimated grams. Prefer K-FCDB via lookup tools; if missing, estimate yourself or call estimate-food-kcal first, then pass baseKcal. Do not send the image to this tool. Do not use Workers AI.",
          inputSchema: {
            foodName: z
              .string()
              .describe("Food name the host read from the meal photo"),
            baseKcal: z
              .number()
              .describe(
                "Kcal per 100g from DB or host estimate (estimate-food-kcal).",
              ),
            estimatedGrams: z
              .number()
              .describe("Estimated grams the host read from the meal photo"),
          },
          annotations: {
            title: "Meal portion adjustment",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Opening the meal card…",
            "openai/toolInvocation/invoked": "Meal card ready.",
          },
          view: {
            component: "meal-widget",
          },
        },
        async (args) => {
          return {
            content: `${args.foodName}: ${args.estimatedGrams}g`,
            structuredContent: args,
          };
        },
      )
      .registerTool(
        {
          name: "save-daily-log",
          description:
            "Save one meal the user confirmed in the meal card. Inserts a single row and does not update or delete existing logs.",
          inputSchema: {
            foodName: z.string(),
            finalGrams: z.number(),
            finalKcal: z.number(),
            date: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. Defaults to today in Asia/Seoul."),
            meal: z
              .enum(mealSlots)
              .optional()
              .describe("breakfast, lunch, or dinner. Defaults to lunch."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save daily meal",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the meal…",
            "openai/toolInvocation/invoked": "Meal saved.",
          },
        },
        async (args, extra) => {
          const saved = {
            foodName: args.foodName,
            finalGrams: args.finalGrams,
            finalKcal: args.finalKcal,
            date: args.date && args.date.length > 0 ? args.date : seoulToday(),
            meal: args.meal ?? "lunch",
          };
          const db = await getDb();
          await db.insert(mealLogs).values({
            date: saved.date,
            meal: saved.meal,
            foodName: saved.foodName,
            grams: saved.finalGrams,
            kcal: saved.finalKcal,
            userId: await accountId(extra, args.accountKey),
            createdAt: new Date().toISOString(),
          });
          return {
            content: `${saved.foodName} (${saved.finalKcal}kcal) 저장 성공!`,
            structuredContent: saved,
          };
        },
      )
      .registerTool(
        {
          name: "estimate-food-kcal",
          description:
            "식품영양성분 DB에 없을 때, 호스트가 추정한 100g당 kcal를 서버에 확정·클램프한다. 이미지를 읽지 않는다. 호스트가 foodName과 kcalPer100g를 직접 넣는다(웹·지식·포장 표시). Workers AI를 쓰지 않는다. 예전 이름 analyze-food-with-workers-ai 대신 이 도구를 쓴다. DB에 있으면 lookup-meal-photo / lookup-meal-portions / lookup-barcode를 우선한다.",
          inputSchema: {
            foodName: z
              .string()
              .min(1)
              .describe("호스트가 식별한 음식 이름. 이미지가 아님."),
            kcalPer100g: z
              .number()
              .positive()
              .describe(
                "호스트가 추정한 100g당 kcal. 서버는 1~900으로 반올림·클램프한다.",
              ),
            source: z
              .string()
              .optional()
              .describe(
                "추정 근거 한 줄. 예: 일반 흰밥 영양 지식, 제품 라벨, 웹 요약.",
              ),
          },
          annotations: {
            title: "Host food kcal estimate",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Confirming host kcal estimate…",
            "openai/toolInvocation/invoked": "Host kcal estimate ready.",
          },
        },
        async (args) => {
          const { normalizeHostFoodKcal } = await import(
            "./food-kcal-estimate.js"
          );
          try {
            const estimated = normalizeHostFoodKcal({
              foodName: args.foodName,
              kcalPer100g: args.kcalPer100g,
              source: args.source,
            });
            return {
              content: [
                shown(
                  `${estimated.foodName}: 100g당 약 ${estimated.kcalPer100g}kcal (호스트 추정${estimated.source !== "host" ? ` · ${estimated.source}` : ""}).`,
                ),
                modelOnly(
                  `estimate-food-kcal 확정. foodName=${estimated.foodName}, kcalPer100g=${estimated.kcalPer100g}, estimatedBy=host, source=${estimated.source}. preview-meal-kcal의 baseKcal 또는 저장 흐름에 이 값을 쓰세요. Workers AI는 호출하지 마세요.`,
                ),
              ],
              structuredContent: estimated,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "kcal 추정이 올바르지 않습니다.";
            return {
              content: [
                shown(message),
                modelOnly(
                  `estimate-food-kcal 실패: ${message}. kcalPer100g를 다시 넣어 호출하세요.`,
                ),
              ],
              structuredContent: {
                foodName: args.foodName,
                kcalPer100g: 0,
                aiEstimatedKcal: 0,
                estimatedBy: "host" as const,
                source: args.source ?? "",
                error: message,
              },
              isError: true,
            };
          }
        },
      )
      .registerTool(
        {
          name: "preview-meal-photo",
          description:
            "사용자가 write-meal-foods에 적은 음식 이름과 추정 중량만 카드로 보여 준다. 적기 전에는 호출하지 않는다. 음식 이름을 사진에서 추측하지 않는다. 영양 성분은 lookup-meal-photo가 식품영양성분 데이터베이스에서 찾는다.",
          inputSchema: {
            meal: z
              .enum(mealSlots)
              .describe("breakfast, lunch, dinner, or snack"),
            date: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
            photo: FileRef.optional().describe(
              "The exact photo file the user uploaded",
            ),
            foods: z
              .array(foodItemSchema)
              .min(1)
              .describe("사진에서 구분한 음식 또는 성분"),
          },
          annotations: {
            title: "Meal photo review",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/fileParams": ["photo"],
            "openai/toolInvocation/invoking": "Opening the meal photo card…",
            "openai/toolInvocation/invoked": "Meal photo card ready.",
          },
          view: {
            component: "meal-photo",
            csp: {
              resourceDomains: [
                "https://files.oaiusercontent.com",
                "https://oaiusercontent.com",
              ],
            },
          },
        },
        async ({ meal, date, foods, photo }) => {
          const day = date && date.length > 0 ? date : seoulToday();
          const items = foods.map(normalizeFood);
          return {
            content: `${day} ${meal}: ${items.map((item) => item.foodName).join(", ")}`,
            structuredContent: {
              date: day,
              meal,
              foods: items,
              photoUrl: photo?.download_url ?? "",
              photo: {
                file_id: photo?.file_id ?? "",
                download_url: photo?.download_url ?? "",
                mime_type: photo?.mime_type ?? "",
                file_name: photo?.file_name ?? "",
              },
            },
          };
        },
      )
      .registerTool(
        {
          name: "get-hand-size",
          description:
            "저장된 손 길이·손바닥 폭·1줌 부피(ml)를 조회한다. 대화가 시작되면, 그리고 식사 사진(그릇·줌)을 분석하기 전에 호출한다. Claude에서는 accountKey를 넘긴다. saved가 false면 신용카드와 손·생쌀 1줌 사진을 요청하고 preview-hand-size로 저장한다. 글만 기록(기준 분량)은 손 없이도 가능하다. saved가 true여도 식사 사진에는 매번 손바닥이 그릇 옆에 보여야 한다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Get saved hand size",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Checking saved hand size…",
            "openai/toolInvocation/invoked": "Hand size checked.",
          },
        },
        async ({ accountKey }, extra) => {
          const profile = await getHandProfile(await accountId(extra, accountKey));
          if (!profile) {
            return {
              content: [
                shown("저장된 손 치수·1줌이 없습니다."),
                modelOnly(
                  "지금 신용카드(8.56cm × 5.4cm)와 손을 나란히 놓은 사진을 요청하세요. 생쌀 1줌은 참고 사진처럼 네 손가락이 손바닥을 덮는 형태로 쥔 뒤, 그 쌀의 무게(g) 또는 컵·그릇에 넣고 용기 지름·쌀이 쌓인 높이를 알려 달라고 하세요. 1줌은 한식 반찬 kcal 줌 계산에 쓰입니다. 홈 손 치수 카드 또는 preview-hand-size로 저장하세요. 사진·줌·그릇 경로에서는 저장 전에 식사 사진을 분석하지 마세요. 글만(바나나 1개 등)은 손 없이도 됩니다.",
                ),
              ],
              structuredContent: {
                saved: false,
                handLengthCm: 0,
                handWidthCm: 0,
                handfulVolumeMl: 0,
              },
            };
          }
          return {
            content: [
              shown(
                `손 길이 ${profile.handLengthCm}cm, 손바닥 폭 ${profile.handWidthCm}cm, 1줌 ${profile.handfulVolumeMl}ml이 저장되어 있습니다.`,
              ),
              modelOnly(
                "식사 사진에는 매번 손바닥이 그릇 옆에 보여야 합니다. 그릇 지름은 그 사진의 손바닥과 저장된 폭을 비교해 추정하세요. 한식 반찬·고기·튀김 줌은 handfulVolumeMl을 씁니다.",
              ),
            ],
            structuredContent: {
              saved: true,
              handLengthCm: profile.handLengthCm,
              handWidthCm: profile.handWidthCm,
              handfulVolumeMl: profile.handfulVolumeMl ?? 0,
            },
          };
        },
      )
      .registerTool(
        {
          name: "preview-hand-size",
          description:
            "신용카드(8.56cm × 5.4cm)와 손 사진에서 손 길이·폭을 읽고, 생쌀 1줌 부피(ml) 확인 카드를 연다. 카드의 손사진은 참고용이다. 손모양은 네 손가락이 손바닥을 덮는 형태. 사용자는 생쌀 무게(g) 또는 컵·그릇 지름·쌀 쌓인 높이를 알려 준다(다른 손 사진을 또 찍으라고 하지 않는다). 1줌은 한식 반찬 kcal 줌 계산에 쓰인다. riceGrams 또는 cupDiameterCm+riceHeightCm을 넣거나 카드에서 입력한다. get-hand-size saved true이면 다시 호출하지 않는다.",
          inputSchema: {
            handLengthCm: z
              .number()
              .positive()
              .describe("카드 기준으로 읽은 손 길이(cm)"),
            handWidthCm: z
              .number()
              .positive()
              .describe("카드 기준으로 읽은 손바닥 폭(cm)"),
            riceGrams: z
              .number()
              .nonnegative()
              .optional()
              .describe("생쌀 1줌 무게(g). 없으면 카드에서 입력"),
            cupDiameterCm: z
              .number()
              .nonnegative()
              .optional()
              .describe("쌀을 담은 컵/그릇 지름(cm)"),
            riceHeightCm: z
              .number()
              .nonnegative()
              .optional()
              .describe("컵 안 쌀이 쌓인 높이(cm)"),
            handfulVolumeMl: z
              .number()
              .positive()
              .optional()
              .describe("이미 계산한 1줌 부피(ml)"),
            photo: FileRef.optional().describe(
              "The exact photo file the user uploaded",
            ),
          },
          annotations: {
            title: "Confirm hand size",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/fileParams": ["photo"],
            "openai/toolInvocation/invoking": "Reading hand size…",
            "openai/toolInvocation/invoked": "Hand size ready to save.",
          },
          view: {
            component: "preview-hand-size",
            description: "Confirm hand size and one-handful volume",
            csp: {
              resourceDomains: [
                "https://files.oaiusercontent.com",
                "https://*.oaiusercontent.com",
                "https://oaiusercontent.com",
                "https://chatgpt.com",
              ],
            },
          },
        },
        async ({
          handLengthCm,
          handWidthCm,
          riceGrams,
          cupDiameterCm,
          riceHeightCm,
          handfulVolumeMl,
          photo,
        }) => {
          const { resolveHandfulVolumeMl } = await import("./handful.js");
          const resolved =
            handfulVolumeMl && handfulVolumeMl > 0
              ? {
                  volumeMl: handfulVolumeMl,
                  fromGramsMl: 0,
                  fromCupMl: 0,
                }
              : resolveHandfulVolumeMl({
                  riceGrams,
                  cupDiameterCm,
                  riceHeightCm,
                });
          return {
            content: [
              shown(
                `손 길이 ${handLengthCm}cm, 손바닥 폭 ${handWidthCm}cm${
                  resolved.volumeMl > 0
                    ? `, 1줌 약 ${resolved.volumeMl}ml`
                    : ""
                }.`,
              ),
              modelOnly(
                "카드에서 손 치수와 1줌 부피를 확인한 뒤 저장하세요. 1줌이 비어 있으면 카드에서 쌀 g 또는 컵 지름·높이를 받습니다.",
              ),
            ],
            structuredContent: {
              handLengthCm,
              handWidthCm,
              riceGrams: riceGrams ?? 0,
              cupDiameterCm: cupDiameterCm ?? 0,
              riceHeightCm: riceHeightCm ?? 0,
              handfulVolumeMl: resolved.volumeMl,
              photoUrl: photo?.download_url ?? "",
              photo: {
                file_id: photo?.file_id ?? "",
                download_url: photo?.download_url ?? "",
                mime_type: photo?.mime_type ?? "",
                file_name: photo?.file_name ?? "",
              },
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-hand-size",
          description:
            "확인 카드에서 사용자가 확정한 손 길이·손바닥 폭·1줌 부피(ml)를 저장한다. 카드의 저장 버튼으로만 호출한다.",
          inputSchema: {
            handLengthCm: z.number().positive(),
            handWidthCm: z.number().positive(),
            handfulVolumeMl: z.number().positive(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save hand size",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving hand size…",
            "openai/toolInvocation/invoked": "Hand size saved.",
          },
        },
        async (
          { handLengthCm, handWidthCm, handfulVolumeMl, accountKey },
          extra,
        ) => {
          const saved = await saveHandProfile(
            await accountId(extra, accountKey),
            handLengthCm,
            handWidthCm,
            handfulVolumeMl,
          );
          const next = guideNextStep("inbody");
          return {
            content: [
              shown(
                withHomeTip(
                  `손 길이 ${saved.handLengthCm}cm, 손바닥 폭 ${saved.handWidthCm}cm, 1줌 ${saved.handfulVolumeMl}ml을 저장했습니다. 다음으로 인바디를 등록해요.`,
                ),
              ),
              modelOnly(
                `다음 식사 사진부터는 이 폭·1줌을 기준으로 하고, 사진에는 매번 손바닥이 보여야 합니다. ${next.model}`,
              ),
            ],
            structuredContent: { ...saved, nextStep: "inbody" },
          };
        },
      )
      .registerTool(
        {
          name: "get-inbody",
          description:
            "users에 저장된 최신 인바디 분석을 조회한다. 대화가 시작되면 get-hand-size, get-hand-size와 함께 호출한다. Claude에서는 accountKey를 넘긴다. saved가 false면 결과지 사진을 지금 요청하고, 사진을 읽으면 save-inbody로 저장한다. 결과지가 없다고 하면 그 항목만 넘긴다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Get InBody",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Checking saved InBody…",
            "openai/toolInvocation/invoked": "InBody checked.",
          },
        },
        async ({ accountKey }, extra) => {
          const saved = await getInbody(await accountId(extra, accountKey));
          if (!saved || saved.inbodyMeasuredOn == null) {
            return {
              content: [
                shown("저장된 인바디가 없습니다."),
                modelOnly(
                  "지금 결과지 사진을 올려 달라고 하세요. 사진에서 체중, 골격근량, 체지방량, 체지방률, 상체 좌우·코어·하체 좌우 근육량을 읽어 save-inbody로 저장하세요. 결과지가 없다고 하면 이 항목만 넘기세요.",
                ),
              ],
              structuredContent: {
                saved: false,
                measuredOn: "",
                weightKg: 0,
                skeletalMuscleKg: 0,
                bodyFatKg: 0,
                bodyFatPercent: 0,
                muscleUpperLeftKg: 0,
                muscleUpperRightKg: 0,
                muscleCoreKg: 0,
                muscleLowerLeftKg: 0,
                muscleLowerRightKg: 0,
              },
            };
          }
          return {
            content: [
              shown(
                `${saved.inbodyMeasuredOn} 인바디. 체중 ${saved.weightKg}kg, 골격근량 ${saved.skeletalMuscleKg}kg, 체지방량 ${saved.bodyFatKg}kg, 체지방률 ${saved.bodyFatPercent}%.`,
              ),
            ],
            structuredContent: {
              saved: true,
              measuredOn: saved.inbodyMeasuredOn,
              weightKg: saved.weightKg ?? 0,
              skeletalMuscleKg: saved.skeletalMuscleKg ?? 0,
              bodyFatKg: saved.bodyFatKg ?? 0,
              bodyFatPercent: saved.bodyFatPercent ?? 0,
              muscleUpperLeftKg: saved.muscleUpperLeftKg ?? 0,
              muscleUpperRightKg: saved.muscleUpperRightKg ?? 0,
              muscleCoreKg: saved.muscleCoreKg ?? 0,
              muscleLowerLeftKg: saved.muscleLowerLeftKg ?? 0,
              muscleLowerRightKg: saved.muscleLowerRightKg ?? 0,
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-inbody",
          description:
            "호스트가 인바디 결과지에서 읽은 분석을 저장한다. 필수 등록이다. 대화·홈 위젯에 accountKey(guest_/user_)가 있으면 반드시 넣어 호출한다. 로그인 직후 채팅에 loginRequired=false·accountKey가 있으면 다시 로그인을 요구하지 말고 바로 이 도구로 저장한다. ‘로그인한 계정에만 저장’이라고 거절하지 않는다. 체중, 골격근량, 체지방량, 체지방률, 부위별 근육량(상체 좌/우, 코어, 하체 좌/우, kg)을 넣는다. 결과지 위쪽에 신장과 성별이 보이면 heightCm과 sex도 넣는다. C-I-D 체형 차트의 표준치가 이 둘로 정해진다. 보이지 않으면 생략하고 지어내지 않는다. users의 최신 분석은 이 값으로 바뀌고, 측정일별 기록은 남는다. 같은 측정일을 다시 저장하면 그 날짜의 점만 바뀐다. 다른 측정일은 마지막 기록과 최소 28일(약 1달) 간격이어야 한다. 영양 수치를 추정해서 넣지 않는다.",
          inputSchema: {
            measuredOn: z.string().describe("결과지 측정일 YYYY-MM-DD"),
            weightKg: z.number().positive().describe("체중(kg)"),
            skeletalMuscleKg: z.number().positive().describe("골격근량(kg)"),
            bodyFatKg: z.number().nonnegative().describe("체지방량(kg)"),
            bodyFatPercent: z.number().nonnegative().describe("체지방률(%)"),
            muscleUpperLeftKg: z.number().nonnegative().describe("상체 좌 근육량(kg)"),
            muscleUpperRightKg: z.number().nonnegative().describe("상체 우 근육량(kg)"),
            muscleCoreKg: z.number().nonnegative().describe("코어 근육량(kg)"),
            muscleLowerLeftKg: z.number().nonnegative().describe("하체 좌 근육량(kg)"),
            muscleLowerRightKg: z.number().nonnegative().describe("하체 우 근육량(kg)"),
            heightCm: z
              .number()
              .min(100)
              .max(230)
              .optional()
              .describe("결과지에 적힌 신장(cm). 보이지 않으면 생략"),
            sex: z
              .enum(sexes)
              .optional()
              .describe("결과지에 적힌 성별. 보이지 않으면 생략"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save InBody",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving InBody…",
            "openai/toolInvocation/invoked": "InBody saved.",
          },
          view: {
            component: "save-inbody",
            description: "InBody save confirmation",
          },
        },
        async (reading, extra) => {
          const userId = await accountId(extra, reading.accountKey);
          const existing = await listInbodyReadings(
            userId,
            "0000-01-01",
            "9999-12-31",
          );
          const last = existing.at(-1);
          if (
            last &&
            last.measuredOn !== reading.measuredOn &&
            daysBetween(last.measuredOn, reading.measuredOn) <
              INBODY_MIN_INTERVAL_DAYS
          ) {
            const wait =
              INBODY_MIN_INTERVAL_DAYS -
              daysBetween(last.measuredOn, reading.measuredOn);
            return {
              content: [
                shown(
                  withHomeTip(
                    `인바디는 최소 ${INBODY_MIN_INTERVAL_DAYS}일(약 1달) 간격으로 등록해요. 마지막 ${last.measuredOn} 기준 약 ${wait}일 뒤에 새 결과지를 올려 주세요. 같은 날 수정도 가능합니다.`,
                  ),
                ),
                modelOnly(
                  "인바디 간격이 짧아 저장하지 않았습니다. 사용자에게 1달 간격을 안내하세요. 같은 measuredOn 수정은 허용됩니다.",
                ),
              ],
              structuredContent: {
                saved: false,
                measuredOn: reading.measuredOn,
                lastMeasuredOn: last.measuredOn,
                minIntervalDays: INBODY_MIN_INTERVAL_DAYS,
              },
              isError: true,
            };
          }
          const saved = await saveInbody(userId, {
            inbodyMeasuredOn: reading.measuredOn,
            weightKg: reading.weightKg,
            skeletalMuscleKg: reading.skeletalMuscleKg,
            bodyFatKg: reading.bodyFatKg,
            bodyFatPercent: reading.bodyFatPercent,
            muscleUpperLeftKg: reading.muscleUpperLeftKg,
            muscleUpperRightKg: reading.muscleUpperRightKg,
            muscleCoreKg: reading.muscleCoreKg,
            muscleLowerLeftKg: reading.muscleLowerLeftKg,
            muscleLowerRightKg: reading.muscleLowerRightKg,
            heightCm: reading.heightCm,
            sex: reading.sex,
          });
          const next = guideNextStep("meal");
          return {
            content: [
              shown(
                withHomeTip(
                  `${saved.inbodyMeasuredOn} 인바디를 저장했습니다. 체중 ${saved.weightKg}kg, 골격근량 ${saved.skeletalMuscleKg}kg, 체지방량 ${saved.bodyFatKg}kg. 이제 매일 식사 기록이 필수예요.`,
                ),
              ),
              modelOnly(next.model),
            ],
            structuredContent: {
              saved: true,
              measuredOn: saved.inbodyMeasuredOn,
              weightKg: saved.weightKg,
              skeletalMuscleKg: saved.skeletalMuscleKg,
              bodyFatKg: saved.bodyFatKg,
              bodyFatPercent: saved.bodyFatPercent,
              nextStep: "meal",
            },
          };
        },
      )
      .registerTool(
        {
          name: "write-meal-foods",
          description:
            "한 끼만 연다. 사진은 0장 또는 1장이다. 홈의 식사 기록 버튼은 위젯이 카드를 바로 열므로 그 턴에는 이 도구를 호출하지 않는다. 채팅으로 식사 기록을 말하면 사진이 없어도 연다. 음식 이름을 추측하지 않는다. 간식이면 포장지 사진을 요청한다. 사진+음식명이 오면 호스트가 밥·국 그릇을 사진에서 판단한다: 개인 공기/국그릇은 손바닥과 저장된 손 폭으로 지름·높이를 vesselHints에 넣고, 냄비·후라이팬·전골 등 공유 그릇이면 sharedPot으로 줌을 요청한다. 그 외 음식은 사용자 단위. 줌은 손 1줌. DB 미스면 후보 목록 또는 kcal·탄단지. 저장은 record-meal-photos. 입력창에 쓰지 않는다.",
          inputSchema: {
            photoCount: z
              .number()
              .int()
              .min(0)
              .max(1)
              .describe(
                "이 끼니의 사진 장수. 0 또는 1. 0이면 글만 기록이다.",
              ),
            meal: z
              .enum(mealSlots)
              .optional()
              .describe(
                "사진 기본 끼니 힌트(breakfast|lunch|dinner|snack). 생략 시 lunch. 카드에서 사진마다 다시 고른다.",
              ),
            date: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
            photos: z
              .array(FileRef)
              .max(1)
              .optional()
              .describe(
                "호스트가 준 파일 참조가 있을 때만 넣는다. 최대 1장. 파일 참조가 없으면 비우고 photoCount만 넣는다. 값을 지어내지 않는다.",
              ),
            photo: FileRef.optional().describe(
              "photos를 쓰지 못할 때만 쓰는 사진 한 장",
            ),
            ...accountKeyField(),
          },
          annotations: {
            title: "Write what was eaten",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/fileParams": ["photos", "photo"],
            "openai/toolInvocation/invoking": "Opening the meal note…",
            "openai/toolInvocation/invoked": "Meal note ready.",
          },
          view: {
            component: "write-meal-foods",
            description: "The user writes what they ate",
            csp: {
              resourceDomains: [
                "https://files.oaiusercontent.com",
                "https://*.oaiusercontent.com",
                "https://oaiusercontent.com",
                "https://chatgpt.com",
              ],
            },
          },
        },
        async ({ meal, date, photos, photo, photoCount, accountKey }, extra) => {
          const day = date && date.length > 0 ? date : seoulToday();
          const defaultMeal = meal ?? "lunch";
          const files = (photos && photos.length > 0 ? photos : photo ? [photo] : [])
            .slice(0, 1)
            .map((file) => ({
              file_id: file.file_id,
              download_url: file.download_url,
              mime_type: file.mime_type ?? "",
              file_name: file.file_name ?? "",
            }));
          // Claude cannot hand chat images to a tool, so the photo count alone
          // must be enough to open the card. One meal is 0 or 1 photo.
          const count = files.length > 0 ? files.length : Math.min(photoCount, 1);
          const identity = await identify(extra, accountKey, { wait: true });
          let mealCoach: "reduce" | "bulk" | "maintain" | "" = "";
          let mealCoachDetail = "";
          let bodyShape = "";
          let handLengthCm = 0;
          let handWidthCm = 0;
          let handfulVolumeMl = 0;
          if (identity.state === "ready") {
            const user = await getUserProfile(identity.userId);
            if (user) {
              const coach = mealCoachMode({
                heightCm: user.heightCm ?? 0,
                sex: user.sex ?? "",
                weightKg: user.weightKg ?? 0,
                skeletalMuscleKg: user.skeletalMuscleKg ?? 0,
                bodyFatKg: user.bodyFatKg ?? 0,
              });
              mealCoach = coach.mode;
              mealCoachDetail = coach.detail;
              bodyShape = coach.shape;
              handLengthCm = user.handLengthCm ?? 0;
              handWidthCm = user.handWidthCm ?? 0;
              handfulVolumeMl = user.handfulVolumeMl ?? 0;
            }
          }
          return {
            content: [
              modelOnly(
                `식사 등록 카드(한 끼, 사진 ${files.length}장). 손 길이 ${handLengthCm}cm, 폭 ${handWidthCm}cm, 1줌 ${handfulVolumeMl}ml. 사용자가 구성을 적으면 음식 이름을 추측하지 마세요. 사진+이름이 오면 먼저 lookup-meal-portions에 vesselHints를 넣으세요: 개인 공기·국그릇은 사진 손바닥과 저장된 폭 ${handWidthCm}cm로 지름(containerDiameterCm)·높이(thicknessCm)를 추정하고, 냄비·후라이팬·전골냄비 등 같이 먹는 그릇이면 sharedPot true(줌으로 적게 안내). handInPhoto·palmComparison도 넣으세요. 확인 요청이 오면 foods로 분량 계산. 줌은 손 1줌 ${handfulVolumeMl}ml. DB 미스는 후보 목록·없으면 kcal·탄단지. 저장 전 record-meal-photos 금지. 입력창에 쓰지 마세요.`,
              ),
            ],
            structuredContent: {
              date: day,
              meal: defaultMeal,
              photos: files,
              photoCount: count,
              awaitingPhoto: false,
              mealCoach,
              mealCoachDetail,
              bodyShape,
              handLengthCm,
              handWidthCm,
              handfulVolumeMl,
            },
            _meta: { photos: files },
          };
        },
      )
      .registerTool(
        {
          name: "lookup-meal-photo",
          description:
            "홈 식사 기록의 열량 계산은 lookup-meal-portions를 쓴다. 이 도구는 사진 한 장의 부피 보정용이다. 주식은 손바닥과 그릇 지름·곡률·깊이로 부피를 계산한다. 국·반찬(isSideDish)은 접시 전체가 아니라 oneMealGrams(웹에서 확인한 1인 1끼 소비량 g)로 계산하고, DB의 100g당 kcal에 그 그램을 곱한다. 1회 섭취참고량으로 대체하지 않는다. 손바닥이 없으면 주식을 계산하지 않는다.",
          inputSchema: {
            meal: z
              .enum(mealSlots)
              .describe("breakfast, lunch, dinner, or snack"),
            date: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
            photo: FileRef.optional().describe(
              "The exact photo file the user uploaded",
            ),
            dishName: z
              .string()
              .describe("사진 속 음식명. 예: 비빔밥. 영양 수치는 넣지 않는다."),
            ingredients: z
              .array(
                z.object({
                  name: z
                    .string()
                    .describe("구성재료 이름. 예: 쌀밥, 소고기, 시금치나물"),
                  coverage: z
                    .number()
                    .min(0)
                    .max(1)
                    .describe(
                      "주식/메인만. 윗면 면적 비율(0~1). 밑반찬(isSideDish)은 0.",
                    ),
                  thicknessCm: z
                    .number()
                    .min(0)
                    .describe(
                      "주식/메인만. 가득 찼을 때 두께(cm). 밑반찬은 0.",
                    ),
                  densityGPerMl: z
                    .number()
                    .positive()
                    .optional()
                    .describe("재료 밀도(g/ml). 모르면 생략(1로 계산)."),
                  isSideDish: z
                    .boolean()
                    .optional()
                    .describe(
                      "국·김치·나물 등 놓고 먹는 반찬이면 true. 접시에 보이는 전체가 아니라 1인 1끼 소비량으로 계산한다.",
                    ),
                  oneMealGrams: z
                    .number()
                    .positive()
                    .optional()
                    .describe(
                      "국·반찬만. 웹에서 확인한 1인 1끼 소비량(g). DB가 100g당 kcal이면 서버가 이 그램으로 다시 환산한다.",
                    ),
                  oneMealSource: z
                    .string()
                    .optional()
                    .describe("1인 1끼 소비량을 확인한 출처 한 줄."),
                }),
              )
              .min(1)
              .describe("사진에서 구분한 구성재료. 중량(g)은 서버가 계산한다."),
            containerDiameterCm: z
              .number()
              .positive()
              .describe(
                "그릇 윗면 지름(cm). 사진 속 손바닥과 저장된 손바닥 폭(cm)을 비교해 추정한다. 사진에 손바닥이 없으면 값을 만들지 말고 도구를 호출하지 않는다.",
              ),
            fillRatio: z
              .number()
              .min(0)
              .max(1)
              .describe(
                "음식이 그릇 깊이 중 어디쯤까지 차 보이는지(0~1). 카드 슬라이더의 초기값이며, 사용자가 직접 맞춘다.",
              ),
            palmComparison: z
              .string()
              .describe(
                "사진 속 손바닥과 그릇을 어떻게 비교했는지 한 줄. 저장된 손바닥 폭(cm)을 기준이라고 적는다.",
              ),
            handInPhoto: z
              .boolean()
              .describe("그릇 옆에 사용자 손바닥이 보이면 true. false면 분석을 진행하지 않는다."),
            userNote: z
              .string()
              .describe(
                "이 사진에 사용자가 적은 음식. 다른 사진의 이름은 넣지 않는다. 이 문장의 음식만 이름으로 쓰고 DB에서 찾는다.",
              ),
            curvature: z
              .number()
              .min(0)
              .max(1)
              .describe(
                "그릇 곡률의 1차 추정. 0은 납작한 접시, 1은 반구형 볼. 사용자에게 묻지 않는다. 카드 슬라이더의 초기값이다.",
              ),
            ...accountKeyField(),
          },
          annotations: {
            title: "Look up meal nutrients",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/fileParams": ["photo"],
            "openai/toolInvocation/invoking": "Looking up nutrients…",
            "openai/toolInvocation/invoked": "Nutrients ready.",
          },
          view: {
            component: "lookup-meal-photo",
            description: "Meal nutrients from the food composition database",
            csp: {
              resourceDomains: [
                "https://files.oaiusercontent.com",
                "https://*.oaiusercontent.com",
                "https://oaiusercontent.com",
                "https://chatgpt.com",
              ],
            },
          },
        },
        async ({
          meal,
          date,
          photo,
          dishName,
          ingredients,
          containerDiameterCm,
          fillRatio,
          palmComparison,
          handInPhoto,
          curvature,
          userNote,
          accountKey,
        }, extra) => {
          const day = date && date.length > 0 ? date : seoulToday();
          const userId = await accountId(extra, accountKey);
          const profile = await getHandProfile(userId);
          const photoContent = {
            file_id: photo?.file_id ?? "",
            download_url: photo?.download_url ?? "",
            mime_type: photo?.mime_type ?? "",
            file_name: photo?.file_name ?? "",
          };
          const note = userNote.replace(/\s+/g, " ").trim();
          if (note.length === 0) {
            return {
              content: [
                modelOnly(
                  "사용자가 먹은 음식을 아직 적지 않았습니다. 칼로리를 말하지 마세요. write-meal-foods를 열어 적게 하세요. 적기 전에는 사진으로 음식 이름을 추측하지 마세요.",
                ),
              ],
              structuredContent: {
                date: day,
                meal,
                dishName,
                dish: null,
                ingredients: [],
                containerDiameterCm,
                fillRatio,
                palmComparison,
                handInPhoto,
                handSaved: profile !== null,
                handLengthCm: profile?.handLengthCm ?? 0,
                handWidthCm: profile?.handWidthCm ?? 0,
                curvature,
                userNote: "",
                source: null,
                photoUrl: photo?.download_url ?? "",
                photo: photoContent,
              },
            };
          }
          if (!handInPhoto) {
            const savedNote = profile
              ? `손 길이 ${profile.handLengthCm}cm, 손바닥 폭 ${profile.handWidthCm}cm은 이미 저장되어 있습니다.`
              : "손 치수도 아직 없습니다. 카드와 손을 한 번 저장하세요.";
            return {
              content: [
                shown("사진에 손바닥이 없어 용량을 계산하지 않았습니다."),
                modelOnly(
                  `칼로리를 말하지 마세요. 그릇 옆에 손바닥을 두고 다시 찍어 달라고 하세요. ${savedNote} 식사 사진에는 매번 손바닥이 보여야 합니다.`,
                ),
              ],
              structuredContent: {
                date: day,
                meal,
                dishName,
                dish: null,
                ingredients: [],
                containerDiameterCm,
                fillRatio,
                palmComparison,
                handInPhoto: false,
                handSaved: profile !== null,
                handLengthCm: profile?.handLengthCm ?? 0,
                handWidthCm: profile?.handWidthCm ?? 0,
                curvature,
                userNote: note,
                source: null,
                photoUrl: photo?.download_url ?? "",
                photo: photoContent,
              },
            };
          }
          const db = await getDb();
          const user = await getUserProfile(userId);
          const coach = mealCoachMode({
            heightCm: user?.heightCm ?? 0,
            sex: user?.sex ?? "",
            weightKg: user?.weightKg ?? 0,
            skeletalMuscleKg: user?.skeletalMuscleKg ?? 0,
            bodyFatKg: user?.bodyFatKg ?? 0,
          });
          // 국·반찬은 사진 위 전체 양이 아니라 1인 1끼 소비량. grams 0은 참고량으로 채우지 않는다.
          const flags = ingredients.map(
            (item) => Boolean(item.isSideDish) || item.coverage === 0,
          );
          const geometry = ingredients.map((item, index) => ({
            coverage: flags[index] ? 0 : item.coverage,
            thicknessCm: flags[index] ? 0 : item.thicknessCm,
            density: item.densityGPerMl ?? 1,
          }));
          const volumes = estimateVolumes({
            curvature,
            diameterCm: containerDiameterCm,
            fillRatio,
            ingredients: geometry,
          });
          const found = await lookupFoods(
            db,
            ingredients.map((item, index) => {
              const side = flags[index] === true;
              const oneMeal = item.oneMealGrams ?? 0;
              return {
                foodName: item.name,
                grams: side
                  ? oneMeal > 0
                    ? oneMeal
                    : 0
                  : volumes[index]?.grams ?? 0,
                exact: side,
                nameMatch: "exact" as const,
              };
            }),
          );
          const items = found.map((item, index) => {
            const side = flags[index] === true;
            const oneMeal = ingredients[index]?.oneMealGrams ?? 0;
            const servingG = side ? (oneMeal > 0 ? Math.round(oneMeal) : 0) : item.grams;
            return {
              ...item,
              coverage: geometry[index]?.coverage ?? 0,
              thicknessCm: geometry[index]?.thicknessCm ?? 0,
              density: geometry[index]?.density ?? 1,
              isSideDish: side,
              servingGrams: servingG,
              portions: 1,
            };
          });
          const totalGrams = items.reduce((sum, item) => sum + item.grams, 0);
          const [dish] = await lookupFoods(db, [
            { foodName: dishName, grams: totalGrams },
          ]);
          const ingredientKcal = items.reduce((sum, item) => sum + item.kcal, 0);
          const missingSides = items
            .filter((item) => item.isSideDish && item.grams <= 0)
            .map((item) => item.query || item.foodName);
          const sideNote =
            missingSides.length > 0
              ? ` 국·반찬 ${missingSides.join(", ")}은 1인 1끼 소비량(oneMealGrams)이 없어 0kcal입니다. 웹에서 1인 1끼 g를 확인해 다시 호출하세요. 1회 섭취참고량으로 채우지 마세요.`
              : "";
          const handNote = profile
            ? `저장된 손바닥 폭 ${profile.handWidthCm}cm과 이 사진의 손바닥을 비교했습니다. 다음 식사 사진에도 손바닥을 같이 찍으세요.`
            : "사진 속 손바닥으로 비교했습니다. 카드와 손을 한 번 저장하면 이후 사진의 손바닥을 cm로 환산합니다. 식사 사진에는 매번 손바닥이 있어야 합니다.";
          return {
            content: [
              shown(
                `${day} ${meal} ${note}: 요리 평균 ${dish?.kcal ?? 0}kcal, 재료 합산 ${ingredientKcal}kcal. ${coach.detail} 출처: ${nutrientSource.ko} (${nutrientSource.en})`,
              ),
              modelOnly(
                `${palmComparison}. ${handNote} 코칭 모드 ${coach.mode}. 이 문장에 없는 음식은 말하지 마세요.${sideNote}`,
              ),
            ],
            structuredContent: {
              date: day,
              meal,
              dishName,
              dish: dish ?? null,
              ingredients: items,
              containerDiameterCm,
              fillRatio,
              palmComparison,
              handInPhoto,
              handSaved: profile !== null,
              handLengthCm: profile?.handLengthCm ?? 0,
              handWidthCm: profile?.handWidthCm ?? 0,
              curvature,
              userNote: note,
              mealCoach: coach.mode,
              mealCoachDetail: coach.detail,
              bodyShape: coach.shape,
              goalKcal: user ? resolveGoals(user).kcal : 0,
              source: nutrientSource,
              photoUrl: photo?.download_url ?? "",
              photo: {
                file_id: photo?.file_id ?? "",
                download_url: photo?.download_url ?? "",
                mime_type: photo?.mime_type ?? "",
                file_name: photo?.file_name ?? "",
              },
            },
          };
        },
      )
      .registerTool(
        {
          name: "review-unknown-meal-food",
          description:
            "사용자가 적은 음식 이름이 식품 DB와 정확히 같지 않을 때 호출한다. 포함·접두·동의어(alsoSearch)로 DB 후보를 받는다. 사진이 있으면 비슷한 순으로 candidatePicks에 넣어 lookup-meal-portions를 호출한다. 사용자가 카드에서 고르기 전에는 matchedFoodName·nameConfirmed를 넣지 않는다. 후보가 비면 호스트가 단위 1개 kcal·탄단지 g를 넣는다. 사용자에게 이름 변경을 묻지 않는다. 웹은 하지 않는다. 꼭이면 '{음식명} {단위} 열량'만.",
          inputSchema: {
            name: z.string().min(1).describe("사용자가 적은 음식 이름."),
            amountNote: z
              .string()
              .optional()
              .describe("사용자가 적은 양. 예: 1줌, 2장, 3개. 줌은 바꾸지 않는다."),
            seenInPhoto: z
              .string()
              .optional()
              .describe(
                "식사 사진에서 본 음식. 사용자가 적은 이름과 다를 때만. 그 이름으로 DB를 같이 찾는다.",
              ),
            alsoSearch: z
              .array(z.string().min(1))
              .max(6)
              .optional()
              .describe(
                "동의어·표기 변형. 예: 계란→달걀. 호스트가 판단해 넣는다. 서버 사전 없음.",
              ),
            note: z
              .string()
              .optional()
              .describe("식사 카드가 준 구성 키. 있으면 그대로 다시 쓴다."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Review a food missing from the database",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Checking the photo against the food database…",
            "openai/toolInvocation/invoked": "Food database checked.",
          },
        },
        async (
          { name, amountNote, seenInPhoto, alsoSearch, note, accountKey },
          extra,
        ) => {
          const userId = await readyUserId(extra, accountKey);
          if (!userId) {
            return {
              content: [
                modelOnly("계정을 확인할 수 없습니다. accountKey로 다시 호출하세요."),
              ],
              isError: true as const,
            };
          }
          const db = await getDb();
          const profile = await getHandProfile(userId);
          const typed = name.trim();
          const noted = parseAmountNote(amountNote);
          const unit = noted.handfuls > 0 ? "줌" : noted.unit || "개";
          const unitEditable = unit !== "줌";
          const handfulVolumeMl = profile?.handfulVolumeMl ?? 0;
          const aliases = (alsoSearch ?? [])
            .map((item) => item.trim())
            .filter(Boolean);
          const photoName = seenInPhoto?.trim() ?? "";
          const typedHits = await searchFoodCandidatesMany(db, [
            typed,
            ...aliases,
          ]);
          const photoHits =
            photoName && photoName !== typed
              ? await searchFoodCandidatesMany(db, [photoName, ...aliases])
              : [];
          const mapHit = (food: (typeof typedHits)[number], query: string) => ({
            foodName: food.foodName,
            basis: food.basis,
            kcal: food.kcal ?? 0,
            servingWeight: food.servingWeight ?? "",
            sameName: sameFoodLabel(query, food.foodName),
          });
          const searchQuery = foodEnergySearchQuery(typed, unit);
          const exact = typedHits.some((food) => food.foodName === typed);
          const mergedNames = [
            ...new Set([
              ...typedHits.map((food) => food.foodName),
              ...photoHits.map((food) => food.foodName),
            ]),
          ];
          return {
            content: [
              modelOnly(
                exact
                  ? `${typed}은 식품 DB에 같은 이름이 있다. lookup-meal-portions에 그 이름을 그대로 넣어라. 입력창에 글을 넣지 마라. accountKey를 사용자에게 묻지 마라.`
                  : mergedNames.length > 0
                    ? `${typed}은 식품 DB에 같은 이름이 없다. typedHits·photoHits를 사진과 비교해 비슷한 순으로 food_name만 candidatePicks에 넣어 같은 note·accountKey로 lookup-meal-portions를 호출하라. 동의어가 있으면 alsoSearch에 넣어라(계란→달걀). 사용자가 카드에서 고르기 전에는 matchedFoodName·nameConfirmed를 넣지 마라. 사용자에게 이름 변경·바코드를 묻지 마라. 사진·손바닥을 다시 요구하지 마라. ${unitEditable ? `단위는 더 맞으면 amountNote만 고친다.` : `단위는 줌이다. 저장된 손 1줌 ${handfulVolumeMl}ml라 바꾸지 마라.`} 웹 검색은 하지 마라. note는 ${note?.trim() || "(카드 키)"} 그대로. 입력창에 글을 넣지 마라.`
                    : `${typed}은 식품 DB 후보가 없다. 동의어(alsoSearch)로 한 번 더 찾아도 없으면 1${unit}의 kcal·탄수화물g·단백질g·지방g를 kcalPerUnit·carbPerUnit·proteinPerUnit·fatPerUnit에 넣어 lookup-meal-portions를 호출한다. 사용자에게 묻지 마라. ${unitEditable ? `단위는 더 맞으면 amountNote만 고친다.` : `단위는 줌이다. 저장된 손 1줌 ${handfulVolumeMl}ml라 바꾸지 마라.`} 웹은 하지 말고 꼭이면 "${searchQuery}"만. nameConfirmed는 넣지 마라. note는 ${note?.trim() || "(카드 키)"} 그대로. 입력창에 글을 넣지 마라.`,
              ),
            ],
            structuredContent: {
              name: typed,
              amountNote: amountNote?.trim() || "",
              unit,
              unitEditable,
              handfulVolumeMl,
              note: note?.trim() || "",
              exact,
              alsoSearch: aliases,
              webSearchQuery: searchQuery,
              typedHits: typedHits.map((food) => mapHit(food, typed)),
              photoHits: photoHits.map((food) => mapHit(food, photoName)),
              suggestedPicks: mergedNames.slice(0, 8),
            },
          };
        },
      )
      .registerTool(
        {
          name: "lookup-meal-portions",
          description:
            "식사 카드가 열량 계산·확인을 요청하면 호출한다. 사진+음식명이 오면 먼저 vesselHints로 밥·국 그릇을 판단한다: 개인 공기/국그릇은 사진 손바닥과 저장된 손 폭을 비교해 containerDiameterCm·thicknessCm을 넣고, 냄비·후라이팬·전골냄비 등 같이 먹는 그릇이면 sharedPot true(카드가 줌 입력을 연다). foods로 분량·DB 조회. DB 미스면 후보 목록·또는 kcal·탄단지. foods·vesselHints 비우면 peek. note 그대로. 입력창에 쓰지 않는다.",
          inputSchema: {
            note: z
              .string()
              .describe("카드가 준 구성 키. peek와 저장 모두 이 문자열 그대로."),
            handInPhoto: z
              .boolean()
              .optional()
              .describe(
                "그릇 옆에 손바닥이 보이면 true. 손바닥이 없으면 false로 vesselHints와 함께 호출하고 지름을 넣지 않는다. 글만·간식 낱개에는 생략한다.",
              ),
            palmComparison: z
              .string()
              .optional()
              .describe(
                "사진 속 손바닥과 그릇 지름을 어떻게 비교했는지 한 줄. 저장된 손바닥 폭(cm)을 기준이라고 적는다. 손 폭을 지름으로 복사하지 말고 픽셀 비율로 추정했다고 적는다.",
              ),
            vesselHints: z
              .array(
                z.object({
                  name: z.string().min(1).describe("사용자가 적은 밥·국·찌개 이름."),
                  role: z
                    .enum(["rice", "soup", "side", "main", "meat", "fried", "snack"])
                    .optional()
                    .default("soup"),
                  sharedPot: z
                    .boolean()
                    .optional()
                    .describe(
                      "냄비·후라이팬·전골냄비·큰 뚝배기 등 같이 덜어 먹는 그릇이면 true. true면 개인 그릇 부피 대신 줌을 받게 한다.",
                    ),
                  containerDiameterCm: z
                    .number()
                    .positive()
                    .optional()
                    .describe(
                      "개인 공기·국그릇 윗면 외경(cm). 사진 손·그릇 픽셀 비율×저장된 손 폭. 손 폭을 그대로 복사 금지. 참고: 스텐 밥 ~10.5, 도자기 밥 11.3~12.5, 국 12.5~13.8, 면기 17~21. sharedPot·손 없으면 생략.",
                    ),
                  thicknessCm: z
                    .number()
                    .positive()
                    .optional()
                    .describe("개인 그릇 음식 높이(cm). 손 길이 눈금으로 추정. sharedPot·손 없으면 생략."),
                }),
              )
              .max(12)
              .optional()
              .describe(
                "사진+음식명만 있을 때 밥·국 그릇 판단. handInPhoto=false면 지름 없이 재촬영 안내만. 분량 계산 전에 카드에 반영한다.",
              ),
            foods: z
              .array(
                z.object({
                  slot: z.number().int().min(1).max(12).optional().default(1),
                  meal: z.enum(mealSlots).optional().default("lunch"),
                  name: z.string().min(1).describe("사용자가 적은 음식 이름."),
                  role: z
                    .enum([
                      "rice",
                      "meat",
                      "fried",
                      "snack",
                      "main",
                      "side",
                      "soup",
                    ])
                    .optional()
                    .default("side")
                    .describe(
                      "밥 rice, 고기 meat, 튀김 fried, 간식 snack, 양식 한 접시 main, 반찬 side, 국 soup.",
                    ),
                  cuisine: z
                    .enum(["korean", "western", "snack", "text"])
                    .optional()
                    .describe(
                      "한식 korean, 양식 western, 간식 snack, 사진 없는 글만 text. 생략 시 korean.",
                    ),
                  grams: z
                    .number()
                    .positive()
                    .optional()
                    .describe(
                      "이미 정한 섭취량(g). 그릇·줌 입력이 있으면 생략한다. 글만은 servingGrams를 쓴다.",
                    ),
                  coverage: z.number().min(0).max(1).optional(),
                  thicknessCm: z.number().min(0).optional(),
                  densityGPerMl: z.number().positive().optional(),
                  containerDiameterCm: z
                    .number()
                    .positive()
                    .optional()
                    .describe("밥·국·양식 그릇 윗면 지름(cm). 손 길이 눈금으로 맞춘 값."),
                  curvature: z.number().min(0).max(1).optional(),
                  fillRatio: z.number().min(0).max(1).optional(),
                  servings: z
                    .number()
                    .positive()
                    .optional()
                    .describe("밥·국 그릇이 1인분을 넘을 때 인분 수. 기본 1."),
                  handfuls: z
                    .number()
                    .positive()
                    .optional()
                    .describe("고기·튀김·반찬·간식 줌. 0.5 단위."),
                  handfulVolumeMl: z
                    .number()
                    .nonnegative()
                    .optional()
                    .describe(
                      "저장된 손 1줌 부피(ml). 생략하면 프로필 값을 쓴다. 0은 생략과 같다.",
                    ),
                  pieceCount: z
                    .number()
                    .positive()
                    .optional()
                    .describe("사용자가 적은 단위의 개수. 1장, 2개, 반 봉지처럼 줌이 아닐 때."),
                  amountNote: z
                    .string()
                    .optional()
                    .describe(
                      "사용자가 적은 양 그대로. 예: 1줌, 2장, 3개. 줌은 반찬 부피(손 1줌)로 계산한다. 그 외 단위는 호스트가 1단위 g와 개수를 판단해 servingGrams·pieceCount에 넣는다.",
                    ),
                  servingGrams: loosePositiveNumber.describe(
                    "DB 또는 포장 기준 1개·1회 제공량(g). 글만·간식 낱개에 쓴다.",
                  ),
                  servingKcal: z
                    .number()
                    .positive()
                    .optional()
                    .describe(
                      "1인분 kcal. 양식은 부피와 10% 비교. DB에 없을 때만 웹·라벨 값.",
                    ),
                  kcalPer100g: z
                    .number()
                    .positive()
                    .optional()
                    .describe(
                      "양식 그릇 비교에만. DB에 없는 반찬은 kcalPerUnit을 쓴다. 100g당으로 반찬 kcal를 넣지 않는다.",
                    ),
                  kcalPerUnit: loosePositiveNumber.describe(
                    "사용자가 적은 단위 1개의 kcal. 줌이면 저장된 손 1줌 한 줌의 kcal. 장·개·봉지 등은 그 1단위 kcal. g당 kcal가 아니다. 숫자 문자열도 받는다.",
                  ),
                  carbPerUnit: looseNonNegativeNumber.describe(
                    "같은 단위 1개의 탄수화물 g. DB에 없을 때 필수. 차트에 반영된다.",
                  ),
                  proteinPerUnit: looseNonNegativeNumber.describe(
                    "같은 단위 1개의 단백질 g. DB에 없을 때 필수. 차트에 반영된다.",
                  ),
                  fatPerUnit: looseNonNegativeNumber.describe(
                    "같은 단위 1개의 지방 g. DB에 없을 때 필수. 차트에 반영된다.",
                  ),
                  nameConfirmed: z
                    .boolean()
                    .optional()
                    .describe(
                      "사용자가 카드에서 이 음식과 1단위 열량·탄단지가 맞다고 확인했을 때만 true.",
                    ),
                  candidateName: z
                    .string()
                    .optional()
                    .describe(
                      "사진과 DB를 보고 고른 표시 이름. DB 이름과 다를 때 확인용. 사용자가 맞다고 하기 전에는 끼니 kcal에 쓰지 않는다.",
                    ),
                  matchedFoodName: z
                    .string()
                    .optional()
                    .describe(
                      "사용자가 카드 목록에서 고른 식품 DB food_name. 글자가 정확히 같아야 한다. nameConfirmed와 함께 넣는다.",
                    ),
                  alsoSearch: z
                    .array(z.string().min(1))
                    .max(6)
                    .optional()
                    .describe(
                      "동의어·표기 변형 검색어. 예: 계란일 때 달걀. 호스트가 판단한다.",
                    ),
                  candidatePicks: z
                    .array(z.string().min(1))
                    .max(12)
                    .optional()
                    .describe(
                      "사진과 비슷한 순의 DB food_name. 카드 목록 순서로 쓴다. 사용자가 고르기 전.",
                    ),
                  noneOfCandidates: z
                    .boolean()
                    .optional()
                    .describe(
                      "사용자가 카드에서 ‘목록에 없음’을 골랐을 때만 true. 그때 호스트가 kcal·탄단지를 채운다.",
                    ),
                }),
              )
              .optional()
              .describe(
                "비우면 peek. 있으면 그릇·줌·기준 분량으로 DB 열량을 환산해 저장한다.",
              ),
            ...accountKeyField(),
          },
          annotations: {
            title: "Estimate meal portions",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Estimating meal portions…",
            "openai/toolInvocation/invoked": "Meal portions ready.",
          },
        },
        async (
          {
            note,
            handInPhoto,
            palmComparison,
            vesselHints,
            foods,
            accountKey,
          },
          extra,
        ) => {
          const userId = await readyUserId(extra, accountKey);
          const key = (note ?? "").trim();
          const empty = {
            ok: false,
            waiting: false,
            note: key,
            handWidthCm: 0,
            palmComparison: "",
            foods: [] as ReturnType<typeof parseStoredPortions>,
            kcal: 0,
            carbG: 0,
            proteinG: 0,
            fatG: 0,
            message: "",
          };
          if (!userId) {
            return {
              content: [
                modelOnly("계정을 확인할 수 없습니다. accountKey로 다시 호출하세요."),
              ],
              structuredContent: {
                ...empty,
                message: "로그인된 accountKey가 필요합니다.",
              },
              isError: true as const,
            };
          }
          const profile = await getHandProfile(userId);
          const handWidthCm = profile?.handWidthCm ?? 0;
          const handLengthCm = profile?.handLengthCm ?? 0;
          const hints = vesselHints ?? [];
          if (hints.length > 0) {
            if (!key) {
              return {
                content: [
                  modelOnly(
                    "vesselHints에는 카드 note가 필요합니다. note를 그대로 넣어 다시 호출하세요.",
                  ),
                ],
                structuredContent: {
                  ...empty,
                  message: "vesselHints에는 note가 필요합니다.",
                },
                isError: true as const,
              };
            }
            if (handInPhoto === false) {
              const rows = hints.map((hint) => ({
                slot: 1,
                meal: "lunch",
                query: hint.name.trim(),
                foodName: hint.name.trim(),
                role: hint.role ?? "soup",
                grams: 0,
                kcal: 0,
                carbG: 0,
                proteinG: 0,
                fatG: 0,
                basis: "그릇",
                kcalPerBasis: 0,
                matched: false,
                amountSource: "",
                needsConfirm: false,
                needsVesselHint: false,
                sharedPot: false,
                photoDiameterCm: 0,
                thicknessCm: 0,
                handMissing: true,
                needsHandRetry: true,
                handInPhoto: false,
              }));
              await upsertPendingMealPortions(userId, {
                note: key,
                foodsJson: JSON.stringify(rows),
                palmComparison: (palmComparison ?? "").replace(/\s+/g, " ").trim(),
              });
              const names = rows.map((row) => row.query).filter(Boolean);
              return {
                content: [
                  shown(
                    "사진에 손바닥이 보이지 않아 그릇 지름을 판별할 수 없습니다. 그릇 옆에 손바닥을 두고 다시 찍어 올려 주세요.",
                  ),
                  modelOnly(
                    `손바닥이 없어 지름 힌트를 쓰지 않았다. 사용자에게 재촬영을 안내하라. 지름·kcal를 추측하지 마라. 입력창에 글을 넣지 마라.${
                      names.length > 0 ? ` 대상: ${names.join(", ")}.` : ""
                    }`,
                  ),
                ],
                structuredContent: {
                  ...empty,
                  handMissing: true,
                  needsHandRetry: true,
                  handInPhoto: false,
                  handWidthCm,
                  palmComparison: (palmComparison ?? "")
                    .replace(/\s+/g, " ")
                    .trim(),
                  foods: rows,
                  message:
                    "사진에 손바닥이 보이지 않아 그릇 지름을 판별할 수 없습니다. 그릇 옆에 손바닥을 두고 다시 찍어 올려 주세요.",
                },
              };
            }
            const rows = hints.map((hint) => {
              const shared = hint.sharedPot === true;
              return {
                slot: 1,
                meal: "lunch",
                query: hint.name.trim(),
                foodName: hint.name.trim(),
                role: hint.role ?? "soup",
                grams: 0,
                kcal: 0,
                carbG: 0,
                proteinG: 0,
                fatG: 0,
                basis: shared ? "줌" : "그릇",
                kcalPerBasis: 0,
                matched: false,
                amountSource: "",
                needsConfirm: false,
                needsVesselHint: true,
                sharedPot: shared,
                photoDiameterCm: shared
                  ? 0
                  : hint.containerDiameterCm ?? 0,
                thicknessCm: shared ? 0 : hint.thicknessCm ?? 0,
                handInPhoto: handInPhoto === true ? true : undefined,
              };
            });
            await upsertPendingMealPortions(userId, {
              note: key,
              foodsJson: JSON.stringify(rows),
              palmComparison: (palmComparison ?? "").replace(/\s+/g, " ").trim(),
            });
            const sharedNames = rows
              .filter((row) => row.sharedPot)
              .map((row) => row.query);
            const bowlNames = rows
              .filter((row) => !row.sharedPot)
              .map((row) => row.query);
            return {
              content: [
                sharedNames.length > 0
                  ? shown(
                      `${sharedNames.join(", ")}은(는) 냄비·팬처럼 같이 먹는 그릇으로 보여요. 먹은 양만 저장된 손 1줌(${profile?.handfulVolumeMl ?? "?"}ml) 기준으로 적어 주세요. 예: 1줌, 1.5줌.`,
                    )
                  : modelOnly(
                      "밥·국 개인 그릇 힌트를 카드에 전달했다. 끼니 kcal는 사용자가 분량을 확인한 뒤다.",
                    ),
                modelOnly(
                  [
                    bowlNames.length > 0
                      ? `개인 그릇(${bowlNames.join(", ")}): 사진 손바닥과 저장된 폭 ${handWidthCm}cm·길이 ${handLengthCm}cm로 지름·높이를 카드에 반영했다.`
                      : "",
                    sharedNames.length > 0
                      ? `공유 냄비·팬(${sharedNames.join(", ")}): 사용자에게 줌으로 적으라고 카드·채팅에 안내했다. 그릇 부피로 계산하지 마라.`
                      : "",
                    "입력창에 글을 넣지 마라.",
                  ]
                    .filter(Boolean)
                    .join(" "),
                ),
              ],
              structuredContent: {
                ...empty,
                needsVesselHints: true,
                handWidthCm,
                palmComparison: (palmComparison ?? "").replace(/\s+/g, " ").trim(),
                foods: rows,
                message:
                  sharedNames.length > 0
                    ? `${sharedNames.join(", ")} — 냄비·팬이면 줌으로 적어 주세요.`
                    : "사진 기준 그릇 크기를 카드에 반영했습니다.",
              },
            };
          }
          const listed = foods ?? [];
          if (listed.length === 0) {
            const pending = await getPendingMealPortions(userId);
            const normalizeNoteKey = (value: string) =>
              value.replace(/\s+/g, " ").trim();
            const noteTokens = (value: string) =>
              normalizeNoteKey(value)
                .split(/[,，、/\s]+/)
                .map((part) => part.trim())
                .filter((part) => part.length >= 2);
            const same =
              pending != null &&
              key.length > 0 &&
              normalizeNoteKey(pending.note) === normalizeNoteKey(key);
            const tokenOverlap =
              pending != null &&
              key.length > 0 &&
              (() => {
                const a = new Set(noteTokens(pending.note));
                const b = noteTokens(key);
                if (a.size === 0 || b.length === 0) return false;
                return b.some((token) => a.has(token));
              })();
            if (pending) {
              const updatedAtMs = Date.parse(pending.updatedAt || "");
              const ageMs = Number.isFinite(updatedAtMs)
                ? Date.now() - updatedAtMs
                : Number.POSITIVE_INFINITY;
              const stored = parseStoredPortions(pending.foodsJson);
              const handMissingRows = stored.filter(
                (item) =>
                  item.handMissing === true ||
                  item.needsHandRetry === true ||
                  item.handInPhoto === false,
              );
              if (
                (same || tokenOverlap) &&
                ageMs >= 0 &&
                ageMs < 5 * 60_000 &&
                handMissingRows.length > 0
              ) {
                return {
                  content: [
                    shown(
                      "사진에 손바닥이 보이지 않아 그릇 지름을 판별할 수 없습니다. 그릇 옆에 손바닥을 두고 다시 찍어 올려 주세요.",
                    ),
                    modelOnly(
                      "손바닥 재촬영이 필요하다. 지름·kcal를 추측하지 마라. 입력창에 글을 넣지 마라.",
                    ),
                  ],
                  structuredContent: {
                    ...empty,
                    handMissing: true,
                    needsHandRetry: true,
                    handInPhoto: false,
                    handWidthCm,
                    palmComparison: pending.palmComparison,
                    foods: handMissingRows,
                    message:
                      "사진에 손바닥이 보이지 않아 그릇 지름을 판별할 수 없습니다. 그릇 옆에 손바닥을 두고 다시 찍어 올려 주세요.",
                  },
                };
              }
              const vesselHintRows = stored.filter(
                (item) => item.needsVesselHint === true,
              );
              if (
                (same || (tokenOverlap && ageMs < 5 * 60_000)) &&
                ageMs >= 0 &&
                ageMs < 30 * 60_000 &&
                vesselHintRows.length > 0
              ) {
                return {
                  content: [
                    modelOnly(
                      "밥·국 그릇 힌트가 카드에 있다. 사용자가 분량을 맞출 때까지 끼니 kcal를 계산하지 마라.",
                    ),
                  ],
                  structuredContent: {
                    ...empty,
                    needsVesselHints: true,
                    handWidthCm,
                    palmComparison: pending.palmComparison,
                    foods: vesselHintRows,
                    message: "사진 기준 그릇·줌 안내를 카드에 반영하세요.",
                  },
                };
              }
              const waitingConfirm = stored.filter((item) => item.needsConfirm);
              const pickRows = waitingConfirm.filter(
                (item) =>
                  item.needsCandidatePick === true &&
                  (item.candidates?.length ?? 0) > 0,
              );
              const answeredConfirm = waitingConfirm.filter((item) => {
                if (item.needsCandidatePick) return false;
                const macros =
                  (item.carbPerUnit ?? 0) +
                  (item.proteinPerUnit ?? 0) +
                  (item.fatPerUnit ?? 0);
                return (item.kcalPerUnit ?? 0) > 0 && macros > 0;
              });
              // Same note: show the waiting panel. Host may rewrite the note —
              // only then reuse a pending row that already has 1-unit kcal, so an
              // empty "not in DB" panel does not stick on every peek.
              if (
                ageMs >= 0 &&
                ageMs < 30 * 60_000 &&
                waitingConfirm.length > 0 &&
                (same || answeredConfirm.length > 0 || pickRows.length > 0)
              ) {
                const rows = same
                  ? waitingConfirm
                  : [...pickRows, ...answeredConfirm];
                const names = rows
                  .map((item) => item.query || item.foodName)
                  .join(", ");
                const picking = rows.some(
                  (item) => item.needsCandidatePick === true,
                );
                return {
                  content: [
                    modelOnly(
                      picking
                        ? `${names}의 DB 후보가 카드에 있다. 사용자가 목록에서 고르거나 ‘목록에 없음’을 누를 때까지 끼니 kcal를 계산하지 마라. matchedFoodName·nameConfirmed는 사용자가 고른 뒤에만. 줌 단위는 바꾸지 마라.`
                        : answeredConfirm.length > 0
                          ? `${names}의 1단위 열량·탄단지가 카드에 있다. 끼니 kcal는 사용자가 맞다고 할 때까지 계산하지 마라. 줌 단위는 바꾸지 마라.`
                          : `${names}은 아직 사용자 확인 전이다. 끼니 kcal를 계산하지 말고, 카드에서 맞다고 할 때까지 기다려라. 줌 단위는 바꾸지 마라.`,
                    ),
                  ],
                  structuredContent: {
                    ...empty,
                    needsWebConfirm: true,
                    needsCandidatePick: picking,
                    handWidthCm,
                    foods: rows,
                    message: picking
                      ? `${names} — DB 후보 중 맞는 것을 고르거나 ‘목록에 없음’을 눌러 주세요.`
                      : answeredConfirm.length > 0
                        ? `${names}의 1단위 열량·탄단지를 카드에서 확인해 주세요.`
                        : `${names}은 식품 DB에 같은 이름이 없습니다. 사진 확인이 끝나면 1단위 열량이 카드에 표시됩니다.`,
                  },
                };
              }
              if (same && ageMs >= 0 && ageMs < 5 * 60_000 && stored.length > 0) {
                const kcal = stored.reduce((sum, item) => sum + item.kcal, 0);
                const carbG = stored.reduce((sum, item) => sum + item.carbG, 0);
                const proteinG = stored.reduce(
                  (sum, item) => sum + item.proteinG,
                  0,
                );
                const fatG = stored.reduce((sum, item) => sum + item.fatG, 0);
                return {
                  content: [
                    modelOnly(
                      `식사 분량 계산이 카드에 전달됐다. record-meal-photos는 사용자가 저장을 누를 때까지 호출하지 마세요.`,
                    ),
                  ],
                  structuredContent: {
                    ok: true,
                    waiting: false,
                    note: key,
                    handWidthCm,
                    palmComparison: pending.palmComparison,
                    foods: stored,
                    kcal: Math.round(kcal),
                    carbG: Math.round(carbG * 10) / 10,
                    proteinG: Math.round(proteinG * 10) / 10,
                    fatG: Math.round(fatG * 10) / 10,
                    message: `${stored.length}개 · ${Math.round(kcal)}kcal`,
                  },
                };
              }
            }
            return {
              content: [modelOnly("식사 분량 추정을 기다리는 중.")],
              structuredContent: {
                ...empty,
                waiting: true,
                handWidthCm,
                message: "그릇·줌·기준 분량을 기다리는 중.",
              },
            };
          }

          const savedVolume = profile?.handfulVolumeMl ?? 0;
          const requests: PortionRequest[] = listed.map((food) => {
            const requestedVolume = food.handfulVolumeMl ?? 0;
            return {
              slot: food.slot,
              meal: food.meal,
              name: food.name,
              role: food.role,
              cuisine: food.cuisine,
              grams: food.grams,
              coverage: food.coverage,
              thicknessCm: food.thicknessCm,
              densityGPerMl: food.densityGPerMl,
              containerDiameterCm: food.containerDiameterCm,
              curvature: food.curvature,
              fillRatio: food.fillRatio,
              servings: food.servings,
              handfuls: food.handfuls,
              handfulVolumeMl:
                requestedVolume > 0
                  ? requestedVolume
                  : savedVolume > 0
                    ? savedVolume
                    : undefined,
              pieceCount: food.pieceCount,
              amountNote: food.amountNote,
              nameConfirmed: food.nameConfirmed,
              candidateName: food.candidateName,
              matchedFoodName: food.matchedFoodName,
              alsoSearch: food.alsoSearch,
              candidatePicks: food.candidatePicks,
              noneOfCandidates: food.noneOfCandidates,
              servingGrams: food.servingGrams,
              servingKcal: food.servingKcal,
              kcalPer100g: food.kcalPer100g,
              kcalPerUnit: food.kcalPerUnit,
              carbPerUnit: food.carbPerUnit,
              proteinPerUnit: food.proteinPerUnit,
              fatPerUnit: food.fatPerUnit,
            };
          });
          if (requests.some((food) => portionNeedsSavedHand(food)) && !profile) {
            return {
              content: [
                shown(
                  "손 길이·폭·1줌이 없어 사진·줌·그릇은 계산하지 않았습니다.",
                ),
                modelOnly(
                  "손 길이·폭·1줌이 저장되어 있지 않습니다. 사진·줌·그릇 열량은 말하지 말고 손 치수를 먼저 저장하세요. 글만(기준 분량)과 간식 낱개(줌 없이 기준 g가 있을 때)는 손 없이 계산할 수 있습니다.",
                ),
              ],
              structuredContent: {
                ...empty,
                message: "사진·줌·그릇은 손 길이·폭·1줌이 필요합니다.",
              },
              isError: true as const,
            };
          }
          const vesselNeedsPalm = requests.some(
            (food) =>
              portionNeedsSavedHand(food) &&
              (food.containerDiameterCm ?? 0) > 0 &&
              food.cuisine !== "text" &&
              food.cuisine !== "snack" &&
              food.role !== "snack",
          );
          if (vesselNeedsPalm && handInPhoto === false) {
            return {
              content: [
                shown("사진에 손바닥이 없어 그릇 양을 계산하지 않았습니다."),
                modelOnly(
                  `저장된 손 길이 ${profile?.handLengthCm ?? 0}cm, 폭 ${handWidthCm}cm, 1줌 ${savedVolume}ml. 그릇 옆에 손바닥이 보이게 다시 찍어 달라고 하세요. 글만 기록은 cuisine=text로 손 없이 계산할 수 있습니다.`,
                ),
              ],
              structuredContent: {
                ...empty,
                handWidthCm,
                message: "그릇 분량은 사진 속 손바닥이 있어야 합니다.",
              },
              isError: true as const,
            };
          }

          const db = await getDb();
          for (const request of requests) {
            const noted = parseAmountNote(request.amountNote);
            if (!(request.handfuls && request.handfuls > 0) && noted.handfuls > 0) {
              request.handfuls = noted.handfuls;
            }
            if (!(request.pieceCount && request.pieceCount > 0) && noted.count > 0 && noted.handfuls <= 0) {
              request.pieceCount = noted.count;
            }
            const cuisine = request.cuisine ?? "korean";
            const usesHandful = (request.handfuls ?? 0) > 0;
            const textOnly = cuisine === "text";
            const counted =
              !usesHandful && ((request.pieceCount ?? 0) > 0 || noted.count > 0);
            const hasAmount =
              (request.servingGrams ?? 0) > 0 || (request.grams ?? 0) > 0;
            if ((counted || textOnly) && !hasAmount) {
              const [probe] = await lookupFoods(db, [
                {
                  foodName: request.name,
                  grams: 0,
                  exact: true,
                  nameMatch: "exact",
                },
              ]);
              const serving = Number.parseFloat(probe?.servingWeight ?? "");
              if (Number.isFinite(serving) && serving > 0) {
                request.servingGrams = serving;
              }
            }
          }

          const nameRows = await lookupFoods(
            db,
            requests.map((request) => ({
              foodName:
                request.matchedFoodName?.trim() || request.name,
              grams: 0,
              exact: true,
              nameMatch: "exact" as const,
            })),
          );
          const kept = await getPendingMealPortions(userId);
          const keptFoods =
            kept != null && kept.note.trim() === key
              ? parseStoredPortions(kept.foodsJson)
              : [];
          const pendingConfirm = (
            await Promise.all(
              requests.map(async (request, index) => {
                const macroSum =
                  (request.carbPerUnit ?? 0) +
                  (request.proteinPerUnit ?? 0) +
                  (request.fatPerUnit ?? 0);
                const pickedDb =
                  request.nameConfirmed === true &&
                  (request.matchedFoodName?.trim() ?? "").length > 0;
                const confirmedNutrition =
                  request.nameConfirmed === true &&
                  (request.kcalPerUnit ?? 0) > 0 &&
                  macroSum > 0;
                if (nameRows[index]?.matched || pickedDb || confirmedNutrition) {
                  return null;
                }
                const noted = parseAmountNote(request.amountNote);
                const previous = keptFoods.find(
                  (item) => item.needsConfirm && item.query === request.name,
                );
                const unit =
                  noted.handfuls > 0 || previous?.unit === "줌"
                    ? "줌"
                    : noted.unit || previous?.unit || "개";
                const skipPick = request.noneOfCandidates === true;
                const aliases = (request.alsoSearch ?? [])
                  .map((item) => item.trim())
                  .filter(Boolean);
                let candidates = skipPick
                  ? []
                  : await searchFoodCandidatesMany(db, [
                      request.name,
                      ...aliases,
                    ]);
                const picks = (request.candidatePicks ?? [])
                  .map((item) => item.trim())
                  .filter(Boolean);
                if (!skipPick && picks.length > 0) {
                  const byName = new Map(
                    candidates.map((food) => [food.foodName, food]),
                  );
                  const ordered = [];
                  for (const name of picks) {
                    const hit =
                      byName.get(name) ?? (await findExactFood(db, name));
                    if (hit) ordered.push(hit);
                  }
                  for (const food of candidates) {
                    if (!ordered.some((item) => item.foodName === food.foodName)) {
                      ordered.push(food);
                    }
                  }
                  candidates = ordered.slice(0, 8);
                } else if (!skipPick) {
                  candidates = candidates.slice(0, 8);
                }
                if (!skipPick && candidates.length > 0) {
                  return {
                    kind: "pick" as const,
                    query: request.name,
                    foodName: request.name,
                    unit,
                    candidates: candidates.map((food) => ({
                      foodName: food.foodName,
                      kcal: food.kcal ?? 0,
                      servingWeight: food.servingWeight ?? "",
                    })),
                  };
                }
                const proposal = await proposeMissingFood(db, {
                  name: request.name,
                  unit,
                  handfulVolumeMl: request.handfulVolumeMl,
                  density: request.densityGPerMl,
                  kcalPerUnit:
                    (request.kcalPerUnit ?? 0) > 0
                      ? request.kcalPerUnit
                      : previous?.kcalPerUnit,
                  candidateName:
                    request.candidateName || previous?.foodName,
                  matchedFoodName: request.matchedFoodName,
                  servingGrams:
                    (request.servingGrams ?? 0) > 0
                      ? request.servingGrams
                      : previous?.servingGrams,
                  carbPerUnit:
                    (request.carbPerUnit ?? 0) > 0
                      ? request.carbPerUnit
                      : previous?.carbPerUnit,
                  proteinPerUnit:
                    (request.proteinPerUnit ?? 0) > 0
                      ? request.proteinPerUnit
                      : previous?.proteinPerUnit,
                  fatPerUnit:
                    (request.fatPerUnit ?? 0) > 0
                      ? request.fatPerUnit
                      : previous?.fatPerUnit,
                });
                return {
                  kind: "nutrition" as const,
                  query: request.name,
                  foodName: proposal.candidateName,
                  grams: 0,
                  unit,
                  kcalPerUnit: proposal.kcalPerUnit,
                  carbPerUnit: proposal.carbPerUnit,
                  proteinPerUnit: proposal.proteinPerUnit,
                  fatPerUnit: proposal.fatPerUnit,
                  servingGrams: proposal.gramsPerUnit,
                  webMiss: proposal.webMiss,
                };
              }),
            )
          ).filter((item) => item !== null);
          if (pendingConfirm.length > 0) {
            const names = pendingConfirm.map((item) => item.query).join(", ");
            const picking = pendingConfirm.some((item) => item.kind === "pick");
            const prompts = pendingConfirm.map((item) => {
              if (item.kind === "pick") {
                return {
                  slot: 1,
                  meal: "lunch",
                  query: item.query,
                  foodName: item.foodName,
                  role: "side" as const,
                  grams: 0,
                  kcal: 0,
                  carbG: 0,
                  proteinG: 0,
                  fatG: 0,
                  basis: item.unit ? `1${item.unit}` : "1단위",
                  kcalPerBasis: 0,
                  matched: false,
                  amountSource: "",
                  needsConfirm: true,
                  needsCandidatePick: true,
                  candidates: item.candidates,
                  webMiss: false,
                  kcalPerUnit: 0,
                  carbPerUnit: 0,
                  proteinPerUnit: 0,
                  fatPerUnit: 0,
                  unit: item.unit,
                  servingGrams: 0,
                };
              }
              return {
                slot: 1,
                meal: "lunch",
                query: item.query,
                foodName: item.foodName,
                role: "side" as const,
                grams: 0,
                kcal: 0,
                carbG: 0,
                proteinG: 0,
                fatG: 0,
                basis: item.unit ? `1${item.unit}` : "1단위",
                kcalPerBasis: item.kcalPerUnit,
                matched: false,
                amountSource: "",
                needsConfirm: true,
                needsCandidatePick: false,
                candidates: [] as {
                  foodName: string;
                  kcal: number;
                  servingWeight: string;
                }[],
                webMiss: item.webMiss,
                kcalPerUnit: item.kcalPerUnit,
                carbPerUnit: item.carbPerUnit,
                proteinPerUnit: item.proteinPerUnit,
                fatPerUnit: item.fatPerUnit,
                unit: item.unit,
                servingGrams: item.servingGrams,
              };
            });
            await upsertPendingMealPortions(userId, {
              note: key,
              foodsJson: JSON.stringify(prompts),
              palmComparison: (palmComparison ?? "").replace(/\s+/g, " ").trim(),
            });
            return {
              content: [
                modelOnly(
                  picking
                    ? `${names}은 식품 DB에 같은 이름이 없습니다. 후보가 카드에 있습니다. 동의어가 있으면 alsoSearch·candidatePicks(사진 비슷한 순)로 같은 note·accountKey lookup-meal-portions를 다시 호출하세요. 사용자가 고르기 전에는 matchedFoodName·nameConfirmed를 넣지 마세요. 사용자에게 이름 변경·바코드를 묻지 마세요. 입력창에 글을 넣지 마세요.`
                    : `${names}은 식품 DB에 같은 이름이 없습니다. 사용자에게 이름 변경·일부만 저장·바코드를 묻지 마세요. 일반 지식으로라도 그 단위 1개당 kcal·탄수화물g·단백질g·지방g를 kcalPerUnit·carbPerUnit·proteinPerUnit·fatPerUnit에 넣어 같은 note·accountKey로 lookup-meal-portions를 지금 다시 호출하세요. 탄단지가 0이면 홈·기간 차트에 안 잡힙니다. 줌은 저장된 손 1줌이라 단위를 바꾸지 마세요. 웹은 하지 말고 꼭이면 "{음식명} {단위} 열량"만. nameConfirmed는 넣지 마세요. 입력창에 글을 넣지 마세요.`,
                ),
              ],
              structuredContent: {
                ...empty,
                needsWebConfirm: true,
                needsCandidatePick: picking,
                handWidthCm,
                foods: prompts,
                message: picking
                  ? `${names} — DB 후보 중 맞는 것을 고르거나 ‘목록에 없음’을 눌러 주세요.`
                  : `${names}은 식품 DB에 같은 이름이 없습니다. 1단위 열량·탄단지가 카드에 표시되면 확인해 주세요.`,
              },
            };
          }

          const resolved: { request: PortionRequest; grams: number; amountSource: string }[] =
            [];
          for (const request of requests) {
            const portion = resolvePortionGrams(request);
            if (!portion.ok) {
              return {
                content: [modelOnly(portion.message)],
                structuredContent: {
                  ...empty,
                  handWidthCm,
                  message: portion.message,
                },
                isError: true as const,
              };
            }
            resolved.push({
              request,
              grams: portion.grams,
              amountSource: portion.amountSource,
            });
          }

          const found = await lookupFoods(
            db,
            resolved.map((item) => ({
              foodName:
                item.request.matchedFoodName?.trim() || item.request.name,
              grams: item.grams,
              exact: true,
              nameMatch: "exact" as const,
            })),
          );
          // Misses were already gated above; re-check only for safety.
          const unconfirmed = found.flatMap((item, index) => {
            const request = resolved[index]?.request;
            const macroSum =
              (request?.carbPerUnit ?? 0) +
              (request?.proteinPerUnit ?? 0) +
              (request?.fatPerUnit ?? 0);
            const pickedDb =
              request?.nameConfirmed === true &&
              (request.matchedFoodName?.trim() ?? "").length > 0;
            const confirmed =
              request?.nameConfirmed === true &&
              (request.kcalPerUnit ?? 0) > 0 &&
              macroSum > 0;
            if (item.matched || pickedDb || confirmed) return [];
            const noted = parseAmountNote(request?.amountNote);
            return [
              {
                query: request?.name || item.query,
                foodName: request?.candidateName?.trim() || request?.name || item.query,
                unit: noted.handfuls > 0 ? "줌" : noted.unit || "개",
                kcalPerUnit: request?.kcalPerUnit ?? 0,
                carbPerUnit: request?.carbPerUnit ?? 0,
                proteinPerUnit: request?.proteinPerUnit ?? 0,
                fatPerUnit: request?.fatPerUnit ?? 0,
                servingGrams: request?.servingGrams ?? 0,
              },
            ];
          });
          if (unconfirmed.length > 0) {
            const names = unconfirmed.map((item) => item.query).join(", ");
            const prompts = unconfirmed.map((item) => ({
              slot: 1,
              meal: "lunch",
              query: item.query,
              foodName: item.foodName,
              role: "side" as const,
              grams: 0,
              kcal: 0,
              carbG: 0,
              proteinG: 0,
              fatG: 0,
              basis: item.unit ? `1${item.unit}` : "1단위",
              kcalPerBasis: item.kcalPerUnit,
              matched: false,
              amountSource: "",
              needsConfirm: true,
              needsCandidatePick: false,
              candidates: [] as {
                foodName: string;
                kcal: number;
                servingWeight: string;
              }[],
              webMiss: !(
                item.kcalPerUnit > 0 &&
                item.carbPerUnit + item.proteinPerUnit + item.fatPerUnit > 0
              ),
              kcalPerUnit: item.kcalPerUnit,
              carbPerUnit: item.carbPerUnit,
              proteinPerUnit: item.proteinPerUnit,
              fatPerUnit: item.fatPerUnit,
              unit: item.unit,
              servingGrams: item.servingGrams,
            }));
            await upsertPendingMealPortions(userId, {
              note: key,
              foodsJson: JSON.stringify(prompts),
              palmComparison: (palmComparison ?? "").replace(/\s+/g, " ").trim(),
            });
            return {
              content: [
                modelOnly(
                  `${names}은 식품 DB에 같은 이름이 없습니다. 사용자에게 이름 변경·일부만 저장·바코드를 묻지 마세요. 일반 지식으로라도 그 단위 1개당 kcal·탄수화물g·단백질g·지방g를 kcalPerUnit·carbPerUnit·proteinPerUnit·fatPerUnit에 넣어 같은 note·accountKey로 lookup-meal-portions를 지금 다시 호출하세요. 탄단지가 0이면 홈·기간 차트에 안 잡힙니다. 줌은 저장된 손 1줌이라 단위를 바꾸지 마세요. 웹은 하지 말고 꼭이면 "{음식명} {단위} 열량"만. nameConfirmed는 넣지 마세요. 입력창에 글을 넣지 마세요.`,
                ),
              ],
              structuredContent: {
                ...empty,
                needsWebConfirm: true,
                handWidthCm,
                foods: prompts,
                message: `${names}은 식품 DB에 같은 이름이 없습니다. 1단위 열량·탄단지가 카드에 표시되면 확인해 주세요.`,
              },
            };
          }
          const stored = found.map((item, index) => {
            const request = resolved[index]?.request;
            const volumeGrams = resolved[index]?.grams ?? item.grams;
            const energy = finalizePortionEnergy({
              cuisine: request?.cuisine,
              role: request?.role ?? "main",
              volumeGrams,
              servingKcal: request?.servingKcal,
              kcalPer100g: request?.kcalPer100g,
              kcalPerUnit: request?.kcalPerUnit,
              carbPerUnit: request?.carbPerUnit,
              proteinPerUnit: request?.proteinPerUnit,
              fatPerUnit: request?.fatPerUnit,
              unitCount: (() => {
                const noted = parseAmountNote(request?.amountNote);
                if ((request?.handfuls ?? 0) > 0 || noted.handfuls > 0) {
                  return (request?.handfuls ?? 0) > 0
                    ? request?.handfuls
                    : noted.handfuls;
                }
                return (request?.pieceCount ?? 0) > 0
                  ? request?.pieceCount
                  : noted.count;
              })(),
              unitLabel: parseAmountNote(request?.amountNote).label,
              lookup: {
                matched: item.matched,
                grams: item.grams,
                kcal: item.kcal,
                carbG: item.carbG,
                proteinG: item.proteinG,
                fatG: item.fatG,
                basis: item.basis,
                kcalPerBasis: item.kcalPerBasis,
                servingWeight: item.servingWeight,
              },
            });
            return {
              slot: request?.slot ?? 1,
              meal: request?.meal ?? "lunch",
              query: request?.name ?? item.query,
              foodName:
                item.matched
                  ? item.foodName
                  : request?.candidateName?.trim() ||
                    request?.matchedFoodName?.trim() ||
                    item.foodName,
              role: request?.role ?? "main",
              grams: energy.grams,
              kcal: energy.kcal,
              carbG: energy.carbG,
              proteinG: energy.proteinG,
              fatG: energy.fatG,
              basis: item.basis,
              kcalPerBasis: item.kcalPerBasis,
              matched: item.matched,
              amountSource:
                energy.amountSource ?? resolved[index]?.amountSource ?? "",
            };
          });
          const comparison = (palmComparison ?? "").replace(/\s+/g, " ").trim();
          await upsertPendingMealPortions(userId, {
            note: key,
            foodsJson: JSON.stringify(stored),
            palmComparison: comparison,
          });
          const kcal = stored.reduce((sum, item) => sum + item.kcal, 0);
          const lines = stored
            .map(
              (item) =>
                `${item.foodName} ${item.grams}g ${item.kcal}kcal (${item.amountSource}, ${item.basis}당 ${item.kcalPerBasis}kcal)`,
            )
            .join("; ");
          return {
            content: [
              shown(
                `그릇·줌·기준 분량으로 ${stored.length}개 · ${Math.round(kcal)}kcal. 출처: ${nutrientSource.ko}`,
              ),
              modelOnly(
                `${comparison || `손바닥 폭 ${handWidthCm}cm`}. ${lines}. 사용자가 저장을 누르기 전에는 record-meal-photos를 호출하지 마세요.`,
              ),
            ],
            structuredContent: {
              ok: true,
              waiting: false,
              note: key,
              handWidthCm,
              palmComparison: comparison,
              foods: stored,
              kcal: Math.round(kcal),
              carbG:
                Math.round(
                  stored.reduce((sum, item) => sum + item.carbG, 0) * 10,
                ) / 10,
              proteinG:
                Math.round(
                  stored.reduce((sum, item) => sum + item.proteinG, 0) * 10,
                ) / 10,
              fatG:
                Math.round(
                  stored.reduce((sum, item) => sum + item.fatG, 0) * 10,
                ) / 10,
              message: lines,
            },
          };
        },
      )
      .registerTool(
        {
          name: "record-meal-photos",
          description:
            "식사 카드에서 그릇·줌·기준 분량으로 열량을 확인한 뒤 사용자가 저장을 눌렀을 때만 호출한다. 각 entry.foods의 grams는 lookup-meal-portions가 확정한 값이다. 1회 섭취참고량으로 양을 채우지 않는다. 사진은 저장하지 않는다. 호스트 LLM이 직접 호출하지 않는다. 호스트 입력창에 글을 넣지 않는다.",
          inputSchema: {
            meal: z
              .enum(mealSlots)
              .optional()
              .describe("entry.meal이 없을 때 쓰는 기본 끼니."),
            date: z.string().describe("YYYY-MM-DD"),
            keepRatio: z
              .number()
              .min(0.4)
              .max(1)
              .optional()
              .describe(
                "덜어내기 비율. 1은 그대로, 0.4는 40%만 남김. C자형 슬라이더 값.",
              ),
            entries: z
              .array(
                z.object({
                  meal: z
                    .enum(mealSlots)
                    .optional()
                    .describe("그 사진의 끼니. 없으면 상위 meal."),
                  note: z
                    .string()
                    .min(1)
                    .describe(
                      "그 사진의 식사 구성. 예: 공기밥, 된장국, 김치. 쉼표·줄바꿈으로 여러 개.",
                    ),
                  photo: FileRef.optional().describe(
                    "그 사진 파일. 있으면 R2에 함께 저장한다.",
                  ),
                  imageJpeg: z
                    .string()
                    .optional()
                    .describe(
                      "카드에서 고른 사진의 jpeg base64. 길면 식단 저장은 하고 사진만 건너뛴다.",
                    ),
                  foods: z
                    .array(
                      z.object({
                        foodName: z.string().min(1),
                        grams: z
                          .number()
                          .positive()
                          .describe(
                            "lookup-meal-portions가 확정한 섭취량(g). 그릇·줌·기준 분량.",
                          ),
                        kcal: z
                          .number()
                          .nonnegative()
                          .optional()
                          .describe(
                            "카드에서 확인한 kcal. 있으면 이 이름·칼로리로 저장하고, DB의 다른 음식(김→김밥, 김치→김치전)으로 바꾸지 않는다.",
                          ),
                        carbG: z.number().nonnegative().optional(),
                        proteinG: z.number().nonnegative().optional(),
                        fatG: z.number().nonnegative().optional(),
                      }),
                    )
                    .min(1)
                    .describe(
                      "lookup-meal-portions가 확정한 음식과 그램. 이 그램으로 DB 열량을 환산한다.",
                    ),
                }),
              )
              .min(1)
              .describe("사진마다 끼니·구성. 한 번에 모두 저장한다."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Record all meal photos",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Recording all meal photos…",
            "openai/toolInvocation/invoked": "All meal photos recorded.",
          },
        },
        async ({ meal, date, entries, accountKey, keepRatio }, extra) => {
          const day = date.length > 0 ? date : seoulToday();
          const fallbackMeal = meal ?? "lunch";
          const keep =
            typeof keepRatio === "number" && keepRatio > 0 && keepRatio < 1
              ? keepRatio
              : 1;
          const userId = await accountId(extra, accountKey);
          const db = await getDb();
          const createdAt = new Date().toISOString();
          const saved: {
            meal: (typeof mealSlots)[number];
            note: string;
            foods: ReturnType<typeof normalizeFood>[];
          }[] = [];
          const byMealMap = new Map<
            (typeof mealSlots)[number],
            { foodCount: number; kcal: number }
          >();
          let totalKcal = 0;
          let totalCarb = 0;
          let totalProtein = 0;
          let totalFat = 0;
          let foodCount = 0;

          for (const entry of entries) {
            const slot = entry.meal ?? fallbackMeal;
            const namedFoods = entry.foods ?? [];
            if (namedFoods.length === 0) continue;
            const found = await lookupFoods(
              db,
              namedFoods.map((food) => ({
                foodName: food.foodName,
                grams: food.grams,
                exact: true,
                nameMatch: "exact" as const,
              })),
            );
            const items = namedFoods.map((food, index) => {
              const row = found[index];
              const grams = Math.max(1, Math.round(food.grams * keep));
              const confirmed = typeof food.kcal === "number";
              const sameName =
                row?.matched === true && row.foodName === food.foodName;
              if (confirmed || !sameName) {
                return normalizeFood({
                  foodName: food.foodName,
                  grams,
                  kcal: Math.round((food.kcal ?? 0) * keep),
                  carbG: Math.round((food.carbG ?? 0) * keep * 10) / 10,
                  proteinG: Math.round((food.proteinG ?? 0) * keep * 10) / 10,
                  fatG: Math.round((food.fatG ?? 0) * keep * 10) / 10,
                });
              }
              return normalizeFood({
                foodName: row?.foodName ?? food.foodName,
                grams,
                kcal: Math.round((row?.kcal ?? 0) * keep),
                carbG: Math.round((row?.carbG ?? 0) * keep * 10) / 10,
                proteinG: Math.round((row?.proteinG ?? 0) * keep * 10) / 10,
                fatG: Math.round((row?.fatG ?? 0) * keep * 10) / 10,
              });
            });
            let entryKcal = 0;
            for (const item of items) {
              await db.insert(mealLogs).values({
                date: day,
                meal: slot,
                foodName: item.foodName,
                grams: item.grams,
                kcal: item.kcal,
                carbG: item.carbG,
                proteinG: item.proteinG,
                fatG: item.fatG,
                photoKey: null,
                userId,
                createdAt,
              });
              totalKcal += item.kcal;
              totalCarb += item.carbG;
              totalProtein += item.proteinG;
              totalFat += item.fatG;
              entryKcal += item.kcal;
              foodCount += 1;
            }
            const bucket = byMealMap.get(slot) ?? { foodCount: 0, kcal: 0 };
            bucket.foodCount += items.length;
            bucket.kcal += entryKcal;
            byMealMap.set(slot, bucket);
            saved.push({ meal: slot, note: entry.note, foods: items });
          }

          if (foodCount === 0) {
            return {
              content: [
                shown("확정된 분량이 없어 저장하지 못했습니다."),
                modelOnly(
                  "record-meal-photos에 foods 그램이 없습니다. lookup-meal-portions로 그릇·줌·기준 분량을 먼저 계산하세요. 1회 섭취참고량으로 저장하지 마세요.",
                ),
              ],
              structuredContent: {
                ok: false,
                date: day,
                meal: fallbackMeal,
                foodCount: 0,
                kcal: 0,
                carbG: 0,
                proteinG: 0,
                fatG: 0,
                foods: [],
                byMeal: [],
                entries: [],
              },
              isError: true as const,
            };
          }

          const byMeal = [...byMealMap.entries()].map(([slot, row]) => ({
            meal: slot,
            foodCount: row.foodCount,
            kcal: Math.round(row.kcal),
          }));
          const mealSummary = byMeal
            .map((row) => `${row.meal} ${row.foodCount}개·${row.kcal}kcal`)
            .join(", ");

          return {
            content: [
              shown(
                `${day} 음식 ${foodCount}개 · ${Math.round(totalKcal)}kcal · 탄 ${Math.round(totalCarb)}g · 단 ${Math.round(totalProtein)}g · 지 ${Math.round(totalFat)}g (${mealSummary}). 그릇·줌·기준 분량으로 저장. 사진은 저장하지 않는다.`,
              ),
              modelOnly(
                `record-meal-photos 완료. 홈의 오늘 식사 상태가 갱신된다. lookup-meal-photo를 추가로 호출하지 마세요. 답변 끝에 홈화면 안내를 넣으세요.`,
              ),
            ],
            structuredContent: {
              ok: true,
              date: day,
              meal: fallbackMeal,
              foodCount,
              kcal: Math.round(totalKcal),
              carbG: Math.round(totalCarb * 10) / 10,
              proteinG: Math.round(totalProtein * 10) / 10,
              fatG: Math.round(totalFat * 10) / 10,
              foods: saved.flatMap((entry) =>
                entry.foods.map((food) => ({
                  meal: entry.meal,
                  foodName: food.foodName,
                  grams: food.grams,
                  kcal: food.kcal,
                  carbG: food.carbG,
                  proteinG: food.proteinG,
                  fatG: food.fatG,
                })),
              ),
              byMeal,
              entries: saved,
              source: nutrientSource,
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-meal-foods",
          description:
            "사용자가 식단 카드에서 확인한 음식과 올린 사진을 한 끼니로 저장한다. 사진은 업로드한 파일을 그대로 R2에 둔다. 기존 기록을 수정하거나 지우지 않는다. 여러 사진을 한 번에 저장할 때는 record-meal-photos를 쓴다.",
          inputSchema: {
            meal: z.enum(mealSlots),
            date: z.string().describe("YYYY-MM-DD"),
            foods: z.array(foodItemSchema).min(1),
            photo: FileRef.optional().describe(
              "The exact photo file the user uploaded",
            ),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save meal foods",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the meal foods…",
            "openai/toolInvocation/invoked": "Meal foods saved.",
          },
        },
        async ({ meal, date, foods, photo, accountKey }, extra) => {
          const day = date.length > 0 ? date : seoulToday();
          const items = foods.map(normalizeFood);
          const photoKey = photo
            ? await saveMealPhoto(photo, day, meal)
            : null;
          const db = await getDb();
          const createdAt = new Date().toISOString();
          for (const item of items) {
            await db.insert(mealLogs).values({
              date: day,
              meal,
              foodName: item.foodName,
              grams: item.grams,
              kcal: item.kcal,
              carbG: item.carbG,
              proteinG: item.proteinG,
              fatG: item.fatG,
              photoKey,
              userId: await accountId(extra, accountKey),
              createdAt,
            });
          }
          const kcal = items.reduce((sum, item) => sum + item.kcal, 0);
          return {
            content: `${day} ${meal} ${items.length}개, ${Math.round(kcal)}kcal 저장`,
            structuredContent: { date: day, meal, foods: items },
          };
        },
      )
      .registerTool(
        {
          name: "show-inbody-chart",
          description:
            "저장된 인바디 측정일의 체중·골격근·체지방·부위 근육 변화를 차트로 보여 준다. 근육 해부도, 5부위 방사형 차트, C-I-D 체형 막대(체중·골격근량·체지방량의 표준 대비 %)가 함께 나온다. 사용자가 ‘인바디 보여줘’처럼 물으면 이 도구를 쓴다. Claude에서 accountKey를 모르면 이 도구를 호출하지 말고 open-home을 intent inbody-chart로 호출한다. accountKey를 지어내지 않고, 사용자에게 식별 불가를 말하지 않는다. 1주·1달처럼 기간에 모양을 고정하지 않는다. 사용자가 말한 시작일·종료일과, 질문 의도에 맞춘 series를 넘긴다. 날짜를 생략하면 저장된 전체를 그린다. 체중·체성분 추세는 line, 측정일 크기 비교는 bar, 누적 경향은 area다. kg는 yAxisId left, 체지방률은 right다.",
          inputSchema: {
            startDate: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. 생략하면 첫 측정일."),
            endDate: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. 생략하면 마지막 측정일."),
            series: z
              .array(inbodySeriesSchema)
              .min(1)
              .optional()
              .describe(
                "한 차트에 겹칠 지표. 생략하면 체중·골격근·체지방 line. 체중 변화면 weightKg line, 체성분이면 골격근·체지방을 함께, 부위 균형이면 다섯 근육을 고른다.",
              ),
            ...accountKeyField(),
          },
          annotations: {
            title: "InBody change chart",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Drawing the InBody chart…",
            "openai/toolInvocation/invoked": "InBody chart ready.",
          },
          view: {
            component: "inbody-chart",
            description: "Weight and body-composition change chart",
            csp: { redirectDomains: affiliateRedirectDomains },
          },
        },
        async ({ startDate, endDate, series, accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          const body = await getUserProfile(userId);
          let all = await listInbodyReadings(userId, "0000-01-01", "9999-12-31");
          if (all.length === 0) {
            const latest = await getInbody(userId);
            if (
              latest?.inbodyMeasuredOn &&
              latest.weightKg != null &&
              latest.skeletalMuscleKg != null &&
              latest.bodyFatKg != null
            ) {
              await saveInbody(userId, {
                inbodyMeasuredOn: latest.inbodyMeasuredOn,
                weightKg: latest.weightKg,
                skeletalMuscleKg: latest.skeletalMuscleKg,
                bodyFatKg: latest.bodyFatKg,
                bodyFatPercent: latest.bodyFatPercent ?? 0,
                muscleUpperLeftKg: latest.muscleUpperLeftKg ?? 0,
                muscleUpperRightKg: latest.muscleUpperRightKg ?? 0,
                muscleCoreKg: latest.muscleCoreKg ?? 0,
                muscleLowerLeftKg: latest.muscleLowerLeftKg ?? 0,
                muscleLowerRightKg: latest.muscleLowerRightKg ?? 0,
              });
              all = await listInbodyReadings(userId, "0000-01-01", "9999-12-31");
            }
          }
          const start = startDate && startDate.length > 0 ? startDate : (all[0]?.measuredOn ?? seoulToday());
          const end = endDate && endDate.length > 0 ? endDate : (all.at(-1)?.measuredOn ?? start);
          const from = start <= end ? start : end;
          const to = start <= end ? end : start;
          const rows = all.filter(
            (row) => row.measuredOn >= from && row.measuredOn <= to,
          );
          const points = rows.map((row) => ({
            date: row.measuredOn,
            weightKg: row.weightKg,
            skeletalMuscleKg: row.skeletalMuscleKg,
            bodyFatKg: row.bodyFatKg,
            bodyFatPercent: row.bodyFatPercent,
            muscleUpperLeftKg: row.muscleUpperLeftKg,
            muscleUpperRightKg: row.muscleUpperRightKg,
            muscleCoreKg: row.muscleCoreKg,
            muscleLowerLeftKg: row.muscleLowerLeftKg,
            muscleLowerRightKg: row.muscleLowerRightKg,
          }));
          const first = points[0];
          const last = points.at(-1);
          const weightDelta =
            first && last ? Math.round((last.weightKg - first.weightKg) * 10) / 10 : 0;
          const fatDelta =
            first && last ? Math.round((last.bodyFatKg - first.bodyFatKg) * 10) / 10 : 0;
          const feedback =
            points.length === 0
              ? "이 기간에 저장된 인바디가 없습니다. 결과지를 올리면 여기부터 점이 찍힙니다."
              : points.length < 2
                ? "기록이 한 번뿐입니다. 다음 결과지를 올리면 변화가 선으로 이어집니다."
              : weightDelta > 0 || fatDelta > 0
                ? `체중 ${weightDelta}kg, 체지방 ${fatDelta}kg. 다음 측정 전에 한 끼를 정리해 봐요.`
                : `체중 ${weightDelta}kg, 체지방 ${fatDelta}kg. 다음 결과지까지 이 방향을 유지해 봐요.`;
          const lower = last
            ? last.muscleLowerLeftKg + last.muscleLowerRightKg
            : 0;
          const upper = last
            ? last.muscleUpperLeftKg + last.muscleUpperRightKg
            : 0;
          const drawn = (series ?? [
            {
              metric: "weightKg" as const,
              label: "체중",
              visualType: "line" as const,
              yAxisId: "left" as const,
            },
            {
              metric: "skeletalMuscleKg" as const,
              label: "골격근",
              visualType: "line" as const,
              yAxisId: "left" as const,
            },
            {
              metric: "bodyFatKg" as const,
              label: "체지방",
              visualType: "line" as const,
              yAxisId: "left" as const,
            },
          ]).map((item) => ({
            metric: item.metric,
            label: item.label,
            visualType: item.visualType,
            yAxisId: item.yAxisId,
          }));
          return {
            content: `${from}~${to} 인바디 ${points.length}회. ${drawn
              .map((item) => `${item.label} ${item.visualType}`)
              .join(", ")}. ${feedback}`,
            structuredContent: {
              startDate: from,
              endDate: to,
              points,
              series: drawn,
              heightCm: body?.heightCm ?? 0,
              sex: body?.sex ?? "",
              toneLevel: 0,
              feedback,
              affiliate: await affiliateFor(
                last !== undefined && lower < upper
                  ? { kind: "lower-body" }
                  : null,
              ),
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-body-profile",
          description:
            "신장과 성별을 users에 저장한다. C-I-D 체형 차트의 표준 체중·골격근량·체지방량이 이 둘로 정해진다. 인바디 카드의 입력칸에서 호출하거나, 사용자가 키·성별을 말했을 때 호출한다. 추측해서 넣지 않는다.",
          inputSchema: {
            heightCm: z.number().min(100).max(230).describe("신장(cm)"),
            sex: z.enum(sexes).describe("male 또는 female"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save height and sex",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving height and sex…",
            "openai/toolInvocation/invoked": "Height and sex saved.",
          },
        },
        async ({ heightCm, sex, accountKey }, extra) => {
          await saveBodyProfile(await accountId(extra, accountKey), { heightCm, sex });
          return {
            content: `신장 ${heightCm}cm, ${sex === "male" ? "남성" : "여성"}으로 저장했습니다.`,
            structuredContent: { saved: true, heightCm, sex },
          };
        },
      )
      .registerTool(
        {
          name: "save-goals",
          description:
            "하루 목표를 users에 저장한다. 사용자가 목표 칼로리·탄단지·활동 칼로리를 말했을 때만 호출하고, 말한 항목만 넣는다. 저장하지 않으면 인바디 제지방량으로 유지 칼로리를 추정해 쓴다. 목표를 대신 정해 주지 않는다.",
          inputSchema: {
            goalKcal: z.number().positive().optional().describe("하루 섭취 목표(kcal)"),
            goalCarbG: z.number().positive().optional().describe("하루 탄수화물 목표(g)"),
            goalProteinG: z.number().positive().optional().describe("하루 단백질 목표(g)"),
            goalFatG: z.number().positive().optional().describe("하루 지방 목표(g)"),
            goalBurnKcal: z
              .number()
              .positive()
              .optional()
              .describe("하루 운동 소모 목표(kcal)"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save daily goals",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving goals…",
            "openai/toolInvocation/invoked": "Goals saved.",
          },
        },
        async ({ accountKey, ...input }, extra) => {
          const userId = await accountId(extra, accountKey);
          await saveGoals(userId, input);
          const goals = resolveGoals(await getUserProfile(userId));
          return {
            content: `목표를 저장했습니다. 하루 ${goals.kcal}kcal, 탄 ${goals.carbG}g, 단 ${goals.proteinG}g, 지 ${goals.fatG}g, 활동 ${goals.burnKcal}kcal.`,
            structuredContent: { saved: true, ...goals },
          };
        },
      )
      .registerTool(
        {
          name: "show-diet-chart",
          description:
            "저장된 식단을 차트로 보여 준다. 카드 기본은 기간별 탄·단·지 kcal 누적 막대와 하루 권장 kcal 기준선이다. Claude에서 accountKey를 모르면 open-home을 intent diet-chart로 호출한다. accountKey를 지어내지 않는다. 생략하면 최근 30일이다. 질문 의도에 맞춘 series를 넘길 수 있다. 목표를 지켰는지 물으면 metric balance를 bar로 넣는다. 한 달이 넘는 성실도는 show-habit-calendar를 쓴다.",
          inputSchema: {
            startDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 30일 전."),
            endDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘."),
            series: z
              .array(chartSeriesSchema)
              .min(1)
              .optional()
              .describe(
                "한 차트에 겹칠 지표. 생략하면 kcal 누적 bar와 burnedKcal line. 질문 의도에 맞게 막대·꺾은선·영역을 조합한다.",
              ),
            goalKcal: z
              .number()
              .positive()
              .optional()
              .describe(
                "사용자가 이번 질문에서 말한 하루 목표 칼로리. 생략하면 저장한 목표나 인바디 추정치를 쓴다.",
              ),
            proteinGoalG: z
              .number()
              .positive()
              .optional()
              .describe("하루 단백질 목표(g). 평균이 이보다 낮으면 부족분 카드를 붙인다."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Diet chart",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Drawing the diet chart…",
            "openai/toolInvocation/invoked": "Diet chart ready.",
          },
          view: {
            component: "diet-chart",
            description: "Composable diet chart for the requested period",
            csp: { redirectDomains: affiliateRedirectDomains },
          },
        },
        async ({ startDate, endDate, series, goalKcal, proteinGoalG, accountKey }, extra) => {
          const today = seoulToday();
          const defaultStart = addDays(today, -29);
          const rawStart = startDate && startDate.length > 0 ? startDate : defaultStart;
          const rawEnd = endDate && endDate.length > 0 ? endDate : today;
          const start = rawStart <= rawEnd ? rawStart : rawEnd;
          const end = rawStart <= rawEnd ? rawEnd : rawStart;
          const userId = await accountId(extra, accountKey);
          const [rows, workouts, user] = await Promise.all([
            listMealLogs(userId, start, end),
            listWorkoutLogs(userId, start, end),
            getUserProfile(userId),
          ]);
          const emptyDay = () => ({
            kcal: 0,
            carbG: 0,
            proteinG: 0,
            fatG: 0,
            breakfast: 0,
            lunch: 0,
            dinner: 0,
            snack: 0,
            burnedKcal: 0,
          });
          const byDate = new Map<string, ReturnType<typeof emptyDay>>();
          for (const date of eachDate(start, end)) byDate.set(date, emptyDay());
          for (const row of rows) {
            const day = byDate.get(row.date) ?? emptyDay();
            day.kcal += row.kcal;
            day.carbG += row.carbG;
            day.proteinG += row.proteinG;
            day.fatG += row.fatG;
            day[row.meal] += row.kcal;
            byDate.set(row.date, day);
          }
          for (const row of workouts) {
            const day = byDate.get(row.date) ?? emptyDay();
            day.burnedKcal += row.burnedKcal;
            byDate.set(row.date, day);
          }
          const goals = resolveGoals(user, goalKcal);
          const goal = goals.kcal;
          const points = [...byDate.entries()].map(([date, totals]) => ({
            date,
            kcal: Math.round(totals.kcal),
            carbG: Math.round(totals.carbG),
            proteinG: Math.round(totals.proteinG),
            fatG: Math.round(totals.fatG),
            breakfast: Math.round(totals.breakfast),
            lunch: Math.round(totals.lunch),
            dinner: Math.round(totals.dinner),
            snack: Math.round(totals.snack),
            burnedKcal: Math.round(totals.burnedKcal),
            carbKcal: Math.round(totals.carbG * 4),
            proteinKcal: Math.round(totals.proteinG * 4),
            fatKcal: Math.round(totals.fatG * 9),
            // Days without a meal log have no balance to judge.
            balance: totals.kcal > 0 ? Math.round(totals.kcal - goal) : 0,
          }));
          const logged = points.filter((point) => point.kcal > 0);
          const dayCount = logged.length || 1;
          const avgProtein =
            logged.reduce((sum, point) => sum + point.proteinG, 0) / dayCount;
          const proteinTarget = proteinGoalG ?? goals.proteinG;
          const proteinGap =
            logged.length > 0
              ? Math.max(0, Math.round(proteinTarget - avgProtein))
              : 0;
          const avgKcal =
            logged.reduce((sum, point) => sum + point.kcal, 0) / dayCount;
          const surplus = logged.length > 0 && avgKcal > goal;
          const feedback = surplus
            ? "괜찮아요. 내일은 한 끼만 더 맞춰 봐요."
            : "이 기간 그래프는 정직합니다. 내일 한 끼가 다음 점입니다.";
          const drawn = (series ?? [
            {
              metric: "kcal" as const,
              label: "섭취 칼로리",
              visualType: "bar" as const,
              isStacked: true,
              yAxisId: "left" as const,
            },
            {
              metric: "burnedKcal" as const,
              label: "운동 소모",
              visualType: "line" as const,
              isStacked: false,
              yAxisId: "left" as const,
            },
          ]).map((item) => ({
            metric: item.metric,
            label: item.label,
            visualType: item.visualType,
            isStacked: item.isStacked ?? false,
            yAxisId: item.yAxisId,
          }));
          const hasIntake = logged.length > 0;
          return {
            content: hasIntake
              ? `${start}~${end} 차트 ${drawn
                  .map((item) => `${item.label} ${item.visualType}`)
                  .join(", ")}. ${feedback} 출처: ${nutrientSource.ko}`
              : `${start}~${end} ${feedback}`,
            structuredContent: {
              startDate: start,
              endDate: end,
              goalKcal: goal,
              goalCarbG: goals.carbG,
              goalProteinG: goals.proteinG,
              goalFatG: goals.fatG,
              goalCarbKcal: goals.carbKcal,
              goalProteinKcal: goals.proteinKcal,
              goalFatKcal: goals.fatKcal,
              ffmKg: goals.ffmKg,
              bmrKcal: goals.bmrKcal,
              tdeeKcal: goals.tdeeKcal,
              hasGoal: true,
              goalSource: goals.source,
              goalSourceLabel: goalSourceLabel[goals.source],
              points,
              series: drawn,
              source: hasIntake ? nutrientSource : null,
              toneLevel: 0,
              feedback,
              affiliate: await affiliateFor(
                proteinGap > 0 ? { kind: "protein", gapG: proteinGap } : null,
              ),
            },
          };
        },
      )
      .registerTool(
        {
          name: "get-diet-period",
          description:
            "시작일과 종료일 사이에 저장된 음식을 한 줄씩 표로 보여 준다. 사용자가 기록을 고치거나 지우려 할 때 먼저 호출한다. 각 줄에 id와 15분짜리 etag가 붙고, 카드에서 중량을 고치거나 한 줄을 지울 수 있다. update-meal-log와 delete-meal-log는 이 etag 없이는 동작하지 않는다. Claude에서 accountKey를 모르면 open-home을 intent meal-logs로 호출한다.",
          inputSchema: {
            startDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 6일 전."),
            endDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Diet period chart",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Loading the diet period…",
            "openai/toolInvocation/invoked": "Diet period ready.",
          },
          view: { component: "diet-period" },
        },
        async ({ startDate, endDate, accountKey }, extra) => {
          const today = seoulToday();
          const rawStart =
            startDate && startDate.length > 0 ? startDate : addDays(today, -6);
          const rawEnd = endDate && endDate.length > 0 ? endDate : today;
          const start = rawStart <= rawEnd ? rawStart : rawEnd;
          const end = rawStart <= rawEnd ? rawEnd : rawStart;
          const userId = await accountId(extra, accountKey);
          const [rows, secret] = await Promise.all([
            listMealLogs(userId, start, end),
            getEtagSecret(userId),
          ]);
          const byDate = new Map<
            string,
            { kcal: number; carbG: number; proteinG: number; fatG: number }
          >();
          for (const row of rows) {
            const day = byDate.get(row.date) ?? {
              kcal: 0,
              carbG: 0,
              proteinG: 0,
              fatG: 0,
            };
            day.kcal += row.kcal;
            day.carbG += row.carbG;
            day.proteinG += row.proteinG;
            day.fatG += row.fatG;
            byDate.set(row.date, day);
          }
          const days = [...byDate.entries()].map(([date, totals]) => ({
            date,
            kcal: Math.round(totals.kcal),
            carbG: Math.round(totals.carbG),
            proteinG: Math.round(totals.proteinG),
            fatG: Math.round(totals.fatG),
          }));
          const issuedAt = Date.now();
          const foods = await Promise.all(
            rows.map(async (row) => ({
              id: row.id,
              etag: await issueEtag(
                secret,
                "meal_log",
                row.id,
                row.updatedAt ?? row.createdAt,
                issuedAt,
              ),
              date: row.date,
              meal: row.meal,
              foodName: row.foodName,
              grams: Math.round(row.grams),
              kcal: Math.round(row.kcal),
              carbG: Math.round(row.carbG),
              proteinG: Math.round(row.proteinG),
              fatG: Math.round(row.fatG),
            })),
          );
          return {
            content: [
              shown(
                foods.length > 0
                  ? `${start}~${end}: ${days.length}일, ${foods.length}개 음식. 출처: ${nutrientSource.ko}`
                  : `${start}~${end}: 저장된 음식이 없습니다.`,
              ),
              modelOnly(
                "각 음식의 id와 etag는 15분 동안만 update-meal-log·delete-meal-log에 쓸 수 있습니다. 사용자가 고치거나 지우자고 한 기록 하나만 다룹니다.",
              ),
            ],
            structuredContent: {
              startDate: start,
              endDate: end,
              days,
              foods,
              source: foods.length > 0 ? nutrientSource : null,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "update-meal-log",
          description:
            "저장된 음식 기록 한 줄의 중량(g)을 고친다. 칼로리와 탄단지는 서버가 중량 비율로 다시 계산한다. get-diet-period가 최근 15분 안에 그 줄에 발급한 etag가 있어야 한다. etag가 없거나 오래됐거나 그 사이 기록이 바뀌었으면 precondition_failed로 거절한다. 한 번에 한 줄만 고친다.",
          inputSchema: {
            id: z.number().int().describe("get-diet-period가 돌려준 음식 기록 id"),
            etag: etagField,
            grams: z.number().positive().describe("고친 섭취 중량(g)"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Update one meal log",
            readOnlyHint: false,
            destructiveHint: true,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Updating the meal log…",
            "openai/toolInvocation/invoked": "Meal log updated.",
          },
        },
        async ({ id, etag, grams, accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          const row = await getMealLog(userId, id);
          if (!row) return preconditionFailed("not_found");
          const secret = await getEtagSecret(userId);
          const check = await checkEtag(
            secret,
            "meal_log",
            id,
            row.updatedAt ?? row.createdAt,
            etag,
          );
          if (check !== "ok") return preconditionFailed(check);
          const updated = await updateMealLogGrams(userId, id, grams);
          if (!updated) return preconditionFailed("not_found");
          const message = `${updated.date} ${updated.foodName}을(를) ${Math.round(updated.grams)}g, ${Math.round(updated.kcal)}kcal로 고쳤습니다.`;
          return {
            content: message,
            structuredContent: {
              ok: true,
              error: "",
              reason: "",
              message,
              food: {
                id,
                etag: await issueEtag(secret, "meal_log", id, updated.updatedAt),
                date: updated.date,
                meal: updated.meal,
                foodName: updated.foodName,
                grams: Math.round(updated.grams),
                kcal: Math.round(updated.kcal),
                carbG: Math.round(updated.carbG),
                proteinG: Math.round(updated.proteinG),
                fatG: Math.round(updated.fatG),
              },
            },
          };
        },
      )
      .registerTool(
        {
          name: "delete-meal-log",
          description:
            "저장된 음식 기록 한 줄을 지운다. 사용자가 그 기록을 지우자고 했을 때만 호출한다. get-diet-period가 최근 15분 안에 그 줄에 발급한 etag가 있어야 하고, 아니면 precondition_failed로 거절한다. 한 번에 한 줄만 지운다. 하루치나 기간 전체를 지우는 도구는 없다.",
          inputSchema: {
            id: z.number().int().describe("get-diet-period가 돌려준 음식 기록 id"),
            etag: etagField,
            ...accountKeyField(),
          },
          annotations: {
            title: "Delete one meal log",
            readOnlyHint: false,
            destructiveHint: true,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Deleting the meal log…",
            "openai/toolInvocation/invoked": "Meal log deleted.",
          },
        },
        async ({ id, etag, accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          const row = await getMealLog(userId, id);
          if (!row) return preconditionFailed("not_found");
          const check = await checkEtag(
            await getEtagSecret(userId),
            "meal_log",
            id,
            row.updatedAt ?? row.createdAt,
            etag,
          );
          if (check !== "ok") return preconditionFailed(check);
          await deleteMealLog(userId, id);
          const message = `${row.date} ${row.foodName} 기록을 지웠습니다.`;
          return {
            content: message,
            structuredContent: {
              ok: true,
              error: "",
              reason: "",
              message,
              deletedId: id,
            },
          };
        },
      )
      .registerTool(
        {
          name: "log-workout",
          description:
            "사용자가 한 운동을 문장 카드로 연다. 근력/유산소를 고르지 않는다. 카드 검색 시 호스트가 문장(예: 달리기 60분동안 3km)을 해석해 lookup-workout-burn에 note·exercise·kind·durationMin·distanceKm·burnedKcal를 넣는다. MET를 묻지 않는다. Claude에서 accountKey를 모르면 open-home을 intent workout-log로 호출한다.",
          inputSchema: {
            date: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
            entries: z
              .array(workoutEntrySchema)
              .min(1)
              .describe("종목마다 한 줄. 같은 종목을 중량을 바꿔 했으면 줄을 나눈다."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Confirm workout",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening the workout card…",
            "openai/toolInvocation/invoked": "Workout card ready.",
          },
          view: {
            component: "log-workout",
            description: "Confirm sets, reps and weight before saving",
          },
        },
        async ({ date, entries, accountKey }, extra) => {
          const userId = await readyUserId(extra, accountKey);
          const user = userId ? await getUserProfile(userId) : null;
          const day = date && date.length > 0 ? date : seoulToday();
          const items = entries.map(normalizeWorkoutEntry);
          return {
            content: [
              shown(
                `${day} 운동 ${items.map((item) => item.exercise).join(", ")}. 카드에서 확인하고 저장해 주세요.`,
              ),
              modelOnly(
                "운동 카드를 열었습니다. 사용자가 저장할 때까지 기다리세요. 저장 전에는 기록되지 않습니다.",
              ),
            ],
            structuredContent: {
              date: day,
              entries: items,
              bodyWeightKg: user?.weightKg ?? 0,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "lookup-workout-burn",
          description:
            "운동 기록 문장의 소모 kcal를 카드에 넣는다. 사용자는 '달리기 60분동안 3km를 뛰었어'처럼 자연어로 적는다. 카드가 note만 넘기면 서버가 문장에서 종목·시간·거리·세트를 읽고 MET·체중으로 kcal를 바로 계산한다. burnedKcal가 있으면 그 값을 쓴다. 채팅 입력창에 글을 넣지 않는다.",
          inputSchema: {
            note: z
              .string()
              .describe("카드에 적힌 운동 문장 원문. peek·저장 모두 이 문자열로 맞춘다."),
            exercise: z
              .string()
              .optional()
              .describe("문장에서 뽑은 짧은 종목명. 예: 달리기, 스쿼트"),
            kind: z
              .enum(workoutKinds)
              .optional()
              .describe("문장이 달리기·걷기·자전거·수영이면 cardio, 아니면 strength"),
            weightKg: z.number().nonnegative().optional(),
            reps: z.number().int().nonnegative().optional(),
            sets: z.number().int().nonnegative().optional(),
            durationMin: z.number().nonnegative().optional(),
            distanceKm: z
              .number()
              .nonnegative()
              .optional()
              .describe("문장에 있는 거리(km). 없으면 생략"),
            burnedKcal: z
              .number()
              .positive()
              .optional()
              .describe("호스트가 추정한 소모 kcal. 있으면 저장, 없으면 peek."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Lookup workout burn",
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Resolving workout kcal…",
            "openai/toolInvocation/invoked": "Workout kcal ready.",
          },
        },
        async (
          {
            note,
            exercise,
            kind,
            weightKg,
            reps,
            sets,
            durationMin,
            distanceKm,
            burnedKcal: burnedInput,
            accountKey,
          },
          extra,
        ) => {
          const userId = await readyUserId(extra, accountKey);
          const sentence = (note ?? "").replace(/\s+/g, " ").trim();
          if (!userId) {
            return {
              content: "계정을 확인할 수 없습니다.",
              structuredContent: {
                ok: false,
                waiting: false,
                note: sentence,
                exercise: "",
                matchedName: "",
                kind: kind ?? "strength",
                burnedKcal: 0,
                distanceKm: 0,
                message: "로그인·accountKey 후 다시 하세요.",
              },
              isError: true,
            };
          }
          const user = await getUserProfile(userId);
          const bodyWeightKg = user?.weightKg ?? 0;
          const weight = weightKg ?? 0;
          const repN = reps ?? 0;
          const setN = sets ?? 0;
          const minutesIn = durationMin ?? 0;
          const distance = distanceKm ?? 0;
          const hostBurn =
            typeof burnedInput === "number" &&
            Number.isFinite(burnedInput) &&
            burnedInput > 0
              ? Math.round(burnedInput)
              : 0;

          if (hostBurn > 0) {
            const shortName = (exercise ?? "").replace(/\s+/g, " ").trim();
            if (sentence.length === 0 || shortName.length === 0) {
              return {
                content: "문장과 종목 이름이 필요합니다.",
                structuredContent: {
                  ok: false,
                  waiting: false,
                  note: sentence,
                  exercise: shortName,
                  matchedName: "",
                  kind: kind ?? "strength",
                  burnedKcal: 0,
                  distanceKm: distance,
                  message: "note(원문)와 exercise, burnedKcal를 함께 넣으세요.",
                },
                isError: true,
              };
            }
            const hits = await findExercisesByName(shortName, 5);
            const hit = hits[0];
            const resolvedKind = hit?.kind ?? kind ?? "strength";
            const matchedName = hit?.nameKo ?? shortName;
            await upsertPendingWorkoutBurn(userId, {
              note: sentence,
              exercise: shortName,
              kind: resolvedKind,
              matchedName,
              burnedKcal: hostBurn,
              weightKg: weight,
              reps: repN,
              sets: setN,
              durationMin: minutesIn,
              distanceKm: distance,
            });
            const message = `${matchedName}: 약 ${hostBurn}kcal${
              distance > 0 ? ` · ${distance}km` : ""
            }${minutesIn > 0 ? ` · ${minutesIn}분` : ""}.`;
            return {
              content: message,
              structuredContent: {
                ok: true,
                waiting: false,
                note: sentence,
                exercise: shortName,
                matchedName,
                kind: resolvedKind,
                burnedKcal: hostBurn,
                bodyWeightKg,
                minutes: minutesIn,
                distanceKm: distance,
                volumeKg: Math.round(workoutVolume(weight, repN, setN)),
                weightKg: weight,
                reps: repN,
                sets: setN,
                durationMin: minutesIn,
                message,
                source: "host" as const,
              },
            };
          }

          const pending = await getPendingWorkoutBurn(userId);
          const sameNote =
            pending != null &&
            sentence.length > 0 &&
            pending.note.replace(/\s+/g, " ").trim() === sentence;
          if (pending && sameNote) {
            const updatedAtMs = Date.parse(pending.updatedAt || "");
            const ageMs = Number.isFinite(updatedAtMs)
              ? Date.now() - updatedAtMs
              : 0;
            if (ageMs >= 0 && ageMs < 5 * 60_000) {
              await clearPendingWorkoutBurn(userId);
              return {
                content: `${pending.matchedName || pending.exercise}: ${pending.burnedKcal}kcal`,
                structuredContent: {
                  ok: true,
                  waiting: false,
                  note: pending.note,
                  exercise: pending.exercise,
                  matchedName: pending.matchedName || pending.exercise,
                  kind: pending.kind,
                  burnedKcal: Math.round(pending.burnedKcal),
                  bodyWeightKg,
                  minutes: pending.durationMin,
                  distanceKm: pending.distanceKm,
                  volumeKg: Math.round(
                    workoutVolume(
                      pending.weightKg,
                      pending.reps,
                      pending.sets,
                    ),
                  ),
                  weightKg: pending.weightKg,
                  reps: pending.reps,
                  sets: pending.sets,
                  durationMin: pending.durationMin,
                  message: `${pending.matchedName || pending.exercise}: 약 ${Math.round(pending.burnedKcal)}kcal${
                    pending.distanceKm > 0 ? ` · ${pending.distanceKm}km` : ""
                  }${pending.durationMin > 0 ? ` · ${pending.durationMin}분` : ""}.`,
                  source: "host" as const,
                },
              };
            }
          }

          if (sentence.length === 0) {
            return {
              content: "운동 문장이 비어 있습니다.",
              structuredContent: {
                ok: false,
                waiting: false,
                note: "",
                exercise: "",
                matchedName: "",
                kind: kind ?? "strength",
                burnedKcal: 0,
                distanceKm: 0,
                message: "문장을 적은 뒤 검색하세요.",
              },
              isError: true,
            };
          }

          // 카드가 note만 넘기면 서버가 문장을 읽고 바로 kcal를 낸다(채팅 입력 없음).
          const parsed = parseWorkoutNote(sentence);
          const shortName = (
            (exercise ?? "").replace(/\s+/g, " ").trim() || parsed.exercise
          ).slice(0, 40);
          const hits = await findExercisesByName(shortName, 5);
          const hit = hits[0];
          const resolvedKind = hit?.kind ?? kind ?? parsed.kind;
          const matchedName = hit?.nameKo ?? shortName;
          const resolvedWeight = weight > 0 ? weight : parsed.weightKg;
          const resolvedReps = repN > 0 ? repN : parsed.reps;
          const resolvedSets = setN > 0 ? setN : parsed.sets;
          const resolvedMinutes =
            minutesIn > 0 ? minutesIn : parsed.durationMin;
          const resolvedDistance =
            distance > 0 ? distance : parsed.distanceKm;
          if (bodyWeightKg <= 0) {
            return {
              content: "체중이 없어 kcal를 계산하지 못했습니다.",
              structuredContent: {
                ok: false,
                waiting: false,
                note: sentence,
                exercise: shortName,
                matchedName,
                kind: resolvedKind,
                burnedKcal: 0,
                distanceKm: resolvedDistance,
                message: "인바디 체중을 먼저 저장한 뒤 다시 검색하세요.",
              },
              isError: true,
            };
          }
          const burned = estimateBurnedKcal(
            resolvedKind,
            resolvedMinutes,
            resolvedSets,
            bodyWeightKg,
            resolvedWeight,
            resolvedReps,
          );
          if (burned <= 0) {
            return {
              content: "시간이나 세트를 문장에서 읽지 못했습니다.",
              structuredContent: {
                ok: false,
                waiting: false,
                note: sentence,
                exercise: shortName,
                matchedName,
                kind: resolvedKind,
                burnedKcal: 0,
                distanceKm: resolvedDistance,
                message:
                  "예: 달리기 60분동안 3km를 뛰었어 / 스쿼트 60kg 10회 3세트",
              },
              isError: true,
            };
          }
          const message = `${matchedName}: 약 ${burned}kcal${
            resolvedDistance > 0 ? ` · ${resolvedDistance}km` : ""
          }${resolvedMinutes > 0 ? ` · ${resolvedMinutes}분` : ""}.`;
          return {
            content: message,
            structuredContent: {
              ok: true,
              waiting: false,
              note: sentence,
              exercise: shortName,
              matchedName,
              kind: resolvedKind,
              burnedKcal: burned,
              bodyWeightKg,
              minutes: resolvedMinutes,
              distanceKm: resolvedDistance,
              volumeKg: Math.round(
                workoutVolume(resolvedWeight, resolvedReps, resolvedSets),
              ),
              weightKg: resolvedWeight,
              reps: resolvedReps,
              sets: resolvedSets,
              durationMin: resolvedMinutes,
              message,
              source: "server" as const,
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-workout-logs",
          description:
            "운동 카드에서 사용자가 검색으로 확인한 운동을 저장한다. 종목마다 한 줄을 새로 넣고, 기존 기록을 고치거나 지우지 않는다. burnedKcal가 있으면 그 값을 쓰고, 없으면 체중·MET·중량·횟수·세트·시간으로 추정한다.",
          inputSchema: {
            date: z.string().describe("YYYY-MM-DD"),
            entries: z.array(workoutEntrySchema).min(1),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save workout",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the workout…",
            "openai/toolInvocation/invoked": "Workout saved.",
          },
        },
        async ({ date, entries, accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          const user = await getUserProfile(userId);
          const day = date.length > 0 ? date : seoulToday();
          const bodyWeightKg = user?.weightKg ?? 0;
          const items = entries
            .map(normalizeWorkoutEntry)
            .filter((item) => item.exercise.length > 0)
            .map((item) => ({
              ...item,
              burnedKcal:
                item.burnedKcal > 0
                  ? item.burnedKcal
                  : estimateBurnedKcal(
                      item.kind,
                      item.durationMin,
                      item.sets,
                      bodyWeightKg,
                      item.weightKg,
                      item.reps,
                    ),
            }));
          if (items.length === 0) {
            return {
              content: "종목 이름이 비어 있어 저장하지 않았습니다.",
              structuredContent: {
                saved: false,
                date: day,
                count: 0,
                burnedKcal: 0,
                volumeKg: 0,
              },
              isError: true,
            };
          }
          await insertWorkoutLogs(userId, day, items);
          const burnedKcal = items.reduce((sum, item) => sum + item.burnedKcal, 0);
          const volumeKg = Math.round(
            items.reduce(
              (sum, item) =>
                sum + workoutVolume(item.weightKg, item.reps, item.sets),
              0,
            ),
          );
          const burnNote =
            bodyWeightKg > 0
              ? `소모 약 ${burnedKcal}kcal(MET 추정)`
              : "저장된 체중이 없어 소모 칼로리는 계산하지 않았습니다";
          return {
            content: `${day} 운동 ${items.length}종목 저장. 총 볼륨 ${volumeKg}kg, ${burnNote}.`,
            structuredContent: {
              saved: true,
              date: day,
              count: items.length,
              burnedKcal,
              volumeKg,
            },
          };
        },
      )
      .registerTool(
        {
          name: "show-workout-chart",
          description:
            "저장된 운동의 성장을 차트로 보여 준다. 종목별 주간 총 볼륨(중량 kg × 횟수 × 세트)은 영역 차트, 추정 1RM(Epley)은 산점도로 그린다. 점진적 과부하나 ‘스쿼트 늘었어?’ 같은 질문에 쓴다. exercise를 생략하면 가장 자주 한 종목을 고르고, 카드에서 종목을 바꿀 수 있다. 최근 기록에는 id와 etag가 붙고, delete-workout-log는 그 etag로만 지운다. Claude에서 accountKey를 모르면 open-home을 intent workout-chart로 호출한다.",
          inputSchema: {
            exercise: z.string().optional().describe("먼저 보여 줄 종목. 생략 가능"),
            startDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 12주 전."),
            endDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Workout volume and 1RM",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Drawing the workout chart…",
            "openai/toolInvocation/invoked": "Workout chart ready.",
          },
          view: {
            component: "workout-chart",
            description: "Weekly volume area chart and 1RM scatter chart",
          },
        },
        async ({ exercise, startDate, endDate, accountKey }, extra) => {
          const today = seoulToday();
          const rawStart =
            startDate && startDate.length > 0 ? startDate : addDays(today, -83);
          const rawEnd = endDate && endDate.length > 0 ? endDate : today;
          const start = rawStart <= rawEnd ? rawStart : rawEnd;
          const end = rawStart <= rawEnd ? rawEnd : rawStart;
          const userId = await accountId(extra, accountKey);
          const [rows, secret] = await Promise.all([
            listWorkoutLogs(userId, start, end),
            getEtagSecret(userId),
          ]);
          const lastWeek = weekStart(end);
          const names = [...new Set(rows.map((row) => row.exercise))];
          const exercises = names
            .map((name) => {
              const own = rows.filter((row) => row.exercise === name);
              const volumeByWeek = new Map<string, number>();
              const burnedByWeek = new Map<string, number>();
              const oneRmByDate = new Map<
                string,
                { oneRm: number; weightKg: number; reps: number }
              >();
              for (const row of own) {
                const week = weekStart(row.date);
                volumeByWeek.set(
                  week,
                  (volumeByWeek.get(week) ?? 0) +
                    workoutVolume(row.weightKg, row.reps, row.sets),
                );
                burnedByWeek.set(
                  week,
                  (burnedByWeek.get(week) ?? 0) + row.burnedKcal,
                );
                const oneRm = estimateOneRm(row.weightKg, row.reps);
                const best = oneRmByDate.get(row.date);
                if (oneRm > 0 && (!best || oneRm > best.oneRm)) {
                  oneRmByDate.set(row.date, {
                    oneRm,
                    weightKg: row.weightKg,
                    reps: row.reps,
                  });
                }
              }
              const weekly: {
                week: string;
                volume: number;
                burnedKcal: number;
              }[] = [];
              let week = weekStart(own[0]?.date ?? end);
              while (week <= lastWeek && weekly.length < 60) {
                weekly.push({
                  week,
                  volume: Math.round(volumeByWeek.get(week) ?? 0),
                  burnedKcal: Math.round(burnedByWeek.get(week) ?? 0),
                });
                week = addDays(week, 7);
              }
              return {
                exercise: name,
                kind: own[0]?.kind ?? "strength",
                sessions: new Set(own.map((row) => row.date)).size,
                weekly,
                oneRm: [...oneRmByDate.entries()].map(([date, best]) => ({
                  date,
                  ...best,
                })),
              };
            })
            .sort((a, b) => b.sessions - a.sessions);
          const wanted = exercise?.trim().toLowerCase() ?? "";
          const selected =
            (wanted.length > 0
              ? exercises.find((item) =>
                  item.exercise.toLowerCase().includes(wanted),
                )
              : undefined) ?? exercises[0];
          const issuedAt = Date.now();
          const logs = await Promise.all(
            rows
              .slice(-30)
              .reverse()
              .map(async (row) => ({
                id: row.id,
                etag: await issueEtag(
                  secret,
                  "workout_log",
                  row.id,
                  row.createdAt,
                  issuedAt,
                ),
                date: row.date,
                exercise: row.exercise,
                kind: row.kind,
                weightKg: row.weightKg,
                reps: row.reps,
                sets: row.sets,
                durationMin: row.durationMin,
                burnedKcal: Math.round(row.burnedKcal),
                volume: Math.round(
                  workoutVolume(row.weightKg, row.reps, row.sets),
                ),
              })),
          );
          // Strength grows in volume (kg), cardio in burned kcal.
          const strength = selected?.kind !== "cardio";
          const weekValue = (offset: number) => {
            const week = selected?.weekly.at(offset);
            return week ? (strength ? week.volume : week.burnedKcal) : 0;
          };
          const recent = weekValue(-1);
          const previous = weekValue(-2);
          const measure = strength ? "주간 볼륨이" : "주간 소모가";
          const unit = strength ? "kg" : "kcal";
          const feedback = !selected
            ? "이 기간에 저장된 운동이 없습니다. 오늘 한 운동을 말해 주면 여기부터 선이 시작됩니다."
            : selected.weekly.length < 2
              ? `${selected.exercise} 기록이 한 주뿐입니다. 다음 주 기록이 붙으면 성장이 보입니다.`
              : recent > previous
                ? `${selected.exercise} ${measure}이(가) ${previous}${unit}에서 ${recent}${unit}로 올랐어요. 다음 주에도 한 칸만 더 올려 봐요.`
                : recent === previous
                  ? `${selected.exercise} ${measure}이(가) 지난주와 같은 ${recent}${unit}입니다. 다음 운동에서 한 세트만 더 채워 봐요.`
                  : `${selected.exercise} ${measure}이(가) ${previous}${unit}에서 ${recent}${unit}로 내려왔어요. 다음 운동에서 한 세트만 더 채워 봐요.`;
          return {
            content: [
              shown(
                `${start}~${end} 운동 ${rows.length}줄, ${exercises.length}종목. ${feedback}`,
              ),
              modelOnly(
                "logs의 id와 etag는 15분 동안만 delete-workout-log에 쓸 수 있습니다. 사용자가 지우자고 한 기록 하나만 지웁니다.",
              ),
            ],
            structuredContent: {
              startDate: start,
              endDate: end,
              selected: selected?.exercise ?? "",
              exercises,
              logs,
              totalBurnedKcal: Math.round(
                rows.reduce((sum, row) => sum + row.burnedKcal, 0),
              ),
              toneLevel: 0,
              feedback,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "delete-workout-log",
          description:
            "저장된 운동 기록 한 줄을 지운다. 사용자가 그 기록을 지우자고 했을 때만 호출한다. show-workout-chart가 최근 15분 안에 그 줄에 발급한 etag가 있어야 하고, 아니면 precondition_failed로 거절한다. 한 번에 한 줄만 지운다.",
          inputSchema: {
            id: z.number().int().describe("show-workout-chart가 돌려준 운동 기록 id"),
            etag: etagField,
            ...accountKeyField(),
          },
          annotations: {
            title: "Delete one workout log",
            readOnlyHint: false,
            destructiveHint: true,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Deleting the workout log…",
            "openai/toolInvocation/invoked": "Workout log deleted.",
          },
        },
        async ({ id, etag, accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          const row = await getWorkoutLog(userId, id);
          if (!row) return preconditionFailed("not_found");
          const check = await checkEtag(
            await getEtagSecret(userId),
            "workout_log",
            id,
            row.createdAt,
            etag,
          );
          if (check !== "ok") return preconditionFailed(check);
          await deleteWorkoutLog(userId, id);
          const message = `${row.date} ${row.exercise} 기록을 지웠습니다.`;
          return {
            content: message,
            structuredContent: {
              ok: true,
              error: "",
              reason: "",
              message,
              deletedId: id,
            },
          };
        },
      )
      .registerTool(
        {
          name: "show-habit-calendar",
          description:
            "한 달이 넘는 식단·운동 성실도를 월별 달력 한 장으로 보여 준다(식단/운동 탭 없음). ‘오늘’은 기기 로컬 날짜(clientDate·clientTimeZone)를 쓴다. 칸 색은 섭취 목표. 스티커는 워너비 체형 시작일(targetStartedOn)~기한 끝날에만, 기기 오후 12시 이후: 미기록·섭취 과다=노력하세요, 기록+소모 충분=참잘했어요. 달력 아래 성장 나무도 같은 기간의 참잘했어요를 6단계로 균등 분배한다. 홈 위젯이 clientDate를 넘긴다. Claude에서 accountKey를 모르면 open-home을 intent habit-calendar로 호출한다.",
          inputSchema: {
            startDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 90일 전."),
            endDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 기기 오늘."),
            goalKcal: z
              .number()
              .positive()
              .optional()
              .describe(
                "사용자가 이번 질문에서 말한 하루 목표 칼로리. 생략하면 저장한 목표나 인바디 추정치를 쓴다.",
              ),
            ...clientClockFields(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Habit calendar",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Drawing the habit calendar…",
            "openai/toolInvocation/invoked": "Habit calendar ready.",
          },
          view: {
            component: "habit-calendar",
            description: "Monthly habit calendar with day numbers",
          },
        },
        async (
          { startDate, endDate, goalKcal, accountKey, clientDate, clientTimeZone },
          extra,
        ) => {
          const clock = resolveClientDay(clientDate, clientTimeZone);
          const today = clock.day;
          const rawStart =
            startDate && startDate.length > 0 ? startDate : addDays(today, -89);
          const rawEnd = endDate && endDate.length > 0 ? endDate : today;
          const end = rawStart <= rawEnd ? rawEnd : rawStart;
          const firstAsked = rawStart <= rawEnd ? rawStart : rawEnd;
          // The heatmap holds at most one year.
          const start =
            daysBetween(firstAsked, end) > 365 ? addDays(end, -365) : firstAsked;
          const userId = await accountId(extra, accountKey);
          // Need profile first so growth window (targetDays) can widen the fetch.
          const user = await getUserProfile(userId);
          const targetDays =
            typeof user?.targetDays === "number" && user.targetDays > 0
              ? user.targetDays
              : 0;
          const targetStartedOn =
            typeof user?.targetStartedOn === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(user.targetStartedOn)
              ? user.targetStartedOn
              : "";
          const targetEndedOnRaw =
            typeof user?.targetEndedOn === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(user.targetEndedOn)
              ? user.targetEndedOn
              : "";
          const bodyGoalSaved = Boolean(
            user?.targetBodyType && targetDays > 0 && targetStartedOn,
          );
          // Stickers + tree: only the saved body-goal window (prefer stored end).
          const growthPeriodStart = bodyGoalSaved ? targetStartedOn : "";
          const growthPeriodEnd = bodyGoalSaved
            ? targetEndedOnRaw ||
              addDays(targetStartedOn, Math.max(0, targetDays - 1))
            : "";
          const fetchStart =
            bodyGoalSaved && growthPeriodStart && growthPeriodStart < start
              ? growthPeriodStart
              : start;
          const stickerRangeStart = growthPeriodStart || fetchStart;
          const stickerRangeEnd = growthPeriodEnd || end;
          const [meals, workouts, weekPlanRows] = await Promise.all([
            listMealLogs(userId, fetchStart, end),
            listWorkoutLogs(userId, fetchStart, end),
            // Rest-day stickers only matter inside a saved body-goal window.
            bodyGoalSaved
              ? listWorkoutWeekPlansOverlapping(
                  userId,
                  stickerRangeStart,
                  stickerRangeEnd,
                )
              : Promise.resolve([]),
          ]);
          // Newest plan wins when the same date appears in multiple venue rows.
          const markByDay = new Map<string, "O" | "X">();
          for (const row of [...weekPlanRows].reverse()) {
            const plan = parseWeekPlanPayload(row.planJson);
            if (!plan) continue;
            for (const slot of plan.days) {
              if (
                slot?.date &&
                (slot.mark === "O" || slot.mark === "X") &&
                slot.date >= stickerRangeStart &&
                slot.date <= stickerRangeEnd
              ) {
                markByDay.set(slot.date, slot.mark);
              }
            }
          }
          const restDays = [...markByDay]
            .filter(([, mark]) => mark === "X")
            .map(([day]) => day)
            .sort();
          const goals = resolveGoals(user, goalKcal);
          const kcalByDay = new Map<string, number>();
          for (const row of meals) {
            kcalByDay.set(row.date, (kcalByDay.get(row.date) ?? 0) + row.kcal);
          }
          const burnedByDay = new Map<string, number>();
          for (const row of workouts) {
            burnedByDay.set(
              row.date,
              (burnedByDay.get(row.date) ?? 0) + row.burnedKcal,
            );
          }
          // Include growth-window logs even when they fall before the calendar start.
          const dataDays = eachDate(fetchStart, end);
          const days = dataDays
            .filter((day) => kcalByDay.has(day) || burnedByDay.has(day))
            .map((day) => {
              const kcal = Math.round(kcalByDay.get(day) ?? 0);
              return {
                day,
                kcal,
                burnedKcal: Math.round(burnedByDay.get(day) ?? 0),
                status: kcalByDay.has(day)
                  ? dayStatus(kcal, goals.kcal)
                  : ("none" as const),
                worked: burnedByDay.has(day),
              };
            });
          const calendarDays = days.filter(
            (item) => item.day >= start && item.day <= end,
          );
          const allDays = eachDate(start, end);
          const count = (status: string) =>
            calendarDays.filter((item) => item.status === status).length;
          const loggedDays = calendarDays.filter(
            (item) => item.status !== "none",
          ).length;
          let currentStreak = 0;
          let cursor = kcalByDay.has(end) ? end : addDays(end, -1);
          while (cursor >= start && kcalByDay.has(cursor)) {
            currentStreak += 1;
            cursor = addDays(cursor, -1);
          }
          const summary = {
            totalDays: allDays.length,
            loggedDays,
            metDays: count("met"),
            overDays: count("over"),
            farOverDays: count("far-over"),
            missedDays: allDays.length - loggedDays,
            workoutDays: calendarDays.filter((item) => item.worked).length,
            currentStreak,
          };
          const feedback =
            summary.loggedDays === 0
              ? "이 기간에 식사 기록이 없습니다. 오늘 한 끼부터 칸을 채워 봐요."
              : summary.missedDays > 0
                ? `${summary.totalDays}일 중 ${summary.missedDays}일이 회색입니다. ${
                    mealMissCopy()
                  }`
                : `${summary.totalDays}일을 하루도 빠짐없이 기록했어요. 초록 ${summary.metDays}일, 내일도 한 칸 더 심어 봐요.`;
          // Growth stage is finalized in the widget (device noon). Server sends the window.
          const growthStage = bodyGoalSaved
            ? growthStageFromGoodDays(0, targetDays)
            : 1;
          const growthLabel =
            TREE_STAGE_META[Math.max(0, growthStage - 1)]?.label ?? "씨앗";
          return {
            content: `${start}~${end} ${summary.totalDays}일 중 기록 ${summary.loggedDays}일(목표 안 ${summary.metDays}, 초과 ${summary.overDays}, 크게 초과 ${summary.farOverDays}), 운동 ${summary.workoutDays}일, 연속 ${summary.currentStreak}일. 목표 ${goals.kcal}kcal(${goalSourceLabel[goals.source]}). ${feedback}${
              bodyGoalSaved
                ? ` 스티커·성장나무는 ${growthPeriodStart}~${growthPeriodEnd}(워너비 ${targetDays}일)에만 적용. 주간 코스 휴식일(X)은 참잘했어요. 참잘을 ${TREE_STAGE_COUNT}단계로 균등 분배(위젯 계산).`
                : " 워너비 체형·시작일이 없으면 스티커는 없고 성장나무는 1단계(씨앗)만 보여 준다."
            }`,
            structuredContent: {
              startDate: start,
              endDate: end,
              goalKcal: goals.kcal,
              goalBurnKcal: goals.burnKcal,
              goalSource: goals.source,
              goalSourceLabel: goalSourceLabel[goals.source],
              days,
              restDays,
              summary,
              toneLevel: 0,
              feedback,
              clientDate: today,
              clientTimeZone: clock.timeZone,
              targetDays,
              targetStartedOn: targetStartedOn || null,
              targetEndedOn: growthPeriodEnd || null,
              growth: {
                bodyGoalSaved,
                targetDays,
                targetStartedOn: targetStartedOn || null,
                targetEndedOn: growthPeriodEnd || null,
                periodStart: growthPeriodStart,
                periodEnd: growthPeriodEnd,
                stageCount: TREE_STAGE_COUNT,
                // Placeholder; widget recounts with device noon.
                goodDays: 0,
                stage: growthStage,
                stageLabel: growthLabel,
              },
            },
          };
        },
      )
      .registerTool(
        {
          name: "show-nutrient-flow",
          description:
            "어떤 끼니·음식에서 탄수화물·단백질·지방 칼로리가 왔는지 산키 흐름도로 보여 준다. 왼쪽이 끼니 또는 음식, 오른쪽이 탄수화물·단백질·지방이다. ‘지방을 어디서 제일 많이 먹었지?’, ‘칼로리 주범이 뭐야?’ 같은 질문에 쓴다. 카드에서 끼니별과 음식별을 바꿔 볼 수 있다. Claude에서 accountKey를 모르면 open-home을 intent nutrient-flow로 호출한다.",
          inputSchema: {
            startDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 7일 전."),
            endDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Nutrient source flow",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Drawing the nutrient flow…",
            "openai/toolInvocation/invoked": "Nutrient flow ready.",
          },
          view: {
            component: "nutrient-flow",
            description: "Sankey diagram from meals and foods to macros",
          },
        },
        async ({ startDate, endDate, accountKey }, extra) => {
          const today = seoulToday();
          const rawStart =
            startDate && startDate.length > 0 ? startDate : addDays(today, -6);
          const rawEnd = endDate && endDate.length > 0 ? endDate : today;
          const start = rawStart <= rawEnd ? rawStart : rawEnd;
          const end = rawStart <= rawEnd ? rawEnd : rawStart;
          const userId = await accountId(extra, accountKey);
          const rows = await listMealLogs(userId, start, end);
          const macros = [
            { id: "macro:carb", label: "탄수화물", key: "carb" },
            { id: "macro:protein", label: "단백질", key: "protein" },
            { id: "macro:fat", label: "지방", key: "fat" },
          ] as const;
          type MacroKcal = { carb: number; protein: number; fat: number };
          const kcalOf = (row: (typeof rows)[number]): MacroKcal => ({
            carb: row.carbG * 4,
            protein: row.proteinG * 4,
            fat: row.fatG * 9,
          });
          const group = (labelOf: (row: (typeof rows)[number]) => string) => {
            const totals = new Map<string, MacroKcal>();
            for (const row of rows) {
              const label = labelOf(row);
              const own = totals.get(label) ?? { carb: 0, protein: 0, fat: 0 };
              const add = kcalOf(row);
              own.carb += add.carb;
              own.protein += add.protein;
              own.fat += add.fat;
              totals.set(label, own);
            }
            return [...totals.entries()]
              .map(([label, value]) => ({
                label,
                ...value,
                total: value.carb + value.protein + value.fat,
              }))
              .filter((item) => item.total > 0)
              .sort((a, b) => b.total - a.total);
          };
          const flow = (sources: ReturnType<typeof group>) => {
            const links = sources.flatMap((item, index) =>
              macros
                .map((macro) => ({
                  source: `source:${index}`,
                  target: macro.id,
                  value: Math.round(item[macro.key]),
                }))
                .filter((link) => link.value > 0),
            );
            const used = new Set(links.flatMap((link) => [link.source, link.target]));
            return {
              nodes: [
                ...sources.map((item, index) => ({
                  id: `source:${index}`,
                  label: item.label,
                  side: "source" as const,
                })),
                ...macros.map((macro) => ({
                  id: macro.id,
                  label: macro.label,
                  side: "macro" as const,
                })),
              ].filter((node) => used.has(node.id)),
              links,
            };
          };
          const mealName = {
            breakfast: "아침",
            lunch: "점심",
            dinner: "저녁",
            snack: "간식",
          } as const;
          const foods = group((row) => row.foodName);
          const TOP_FOODS = 7;
          const rest = foods.slice(TOP_FOODS);
          const topFoods =
            rest.length > 0
              ? [
                  ...foods.slice(0, TOP_FOODS),
                  rest.reduce(
                    (sum, item) => ({
                      label: `기타 ${rest.length}개`,
                      carb: sum.carb + item.carb,
                      protein: sum.protein + item.protein,
                      fat: sum.fat + item.fat,
                      total: sum.total + item.total,
                    }),
                    { label: "", carb: 0, protein: 0, fat: 0, total: 0 },
                  ),
                ]
              : foods;
          const topBy = (key: "carb" | "protein" | "fat" | "total") =>
            [...foods].sort((a, b) => b[key] - a[key])[0]?.label ?? "";
          const totals = {
            carbKcal: Math.round(foods.reduce((sum, item) => sum + item.carb, 0)),
            proteinKcal: Math.round(
              foods.reduce((sum, item) => sum + item.protein, 0),
            ),
            fatKcal: Math.round(foods.reduce((sum, item) => sum + item.fat, 0)),
          };
          const topSources = {
            kcal: topBy("total"),
            carb: topBy("carb"),
            protein: topBy("protein"),
            fat: topBy("fat"),
          };
          const feedback =
            foods.length === 0
              ? "이 기간에 탄단지가 기록된 음식이 없습니다. 식사를 기록하면 흐름이 그려집니다."
              : `칼로리는 ${topSources.kcal}, 지방은 ${topSources.fat}에서 가장 많이 왔어요. 다음 한 끼에서 그 음식만 반으로 줄여 봐요.`;
          return {
            content:
              foods.length > 0
                ? `${start}~${end} 탄수화물 ${totals.carbKcal}kcal, 단백질 ${totals.proteinKcal}kcal, 지방 ${totals.fatKcal}kcal. ${feedback} 출처: ${nutrientSource.ko}`
                : `${start}~${end} ${feedback}`,
            structuredContent: {
              startDate: start,
              endDate: end,
              byMeal: flow(group((row) => mealName[row.meal])),
              byFood: flow(topFoods),
              totals,
              topSources,
              toneLevel: 0,
              feedback,
              source: foods.length > 0 ? nutrientSource : null,
            },
          };
        },
      )
      .registerTool(
        {
          name: "choose-body-goal",
          description:
            "워너비 체형과 달성 기한을 고르는 카드를 연다. 이미 저장돼 있으면 현재 체형·시작일·종료일을 보여 주고 운동기록 취소(clear-body-goal) 또는 수정으로 이어진다. 저장 시 시작일·종료일을 D1에 넣으며, 성실도 스티커는 그 기간에만 붙는다. Claude에서 accountKey를 모르면 open-home을 intent body-goal로 호출한다.",
          inputSchema: {
            ...clientClockFields(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Choose want-to-be body",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening body goal choices…",
            "openai/toolInvocation/invoked": "Body goal choices ready.",
          },
          view: {
            component: "choose-body-goal",
            description: "Pick a want-to-be body type from body photos",
          },
        },
        async ({ accountKey, clientDate, clientTimeZone }, extra) => {
          const userId = await readyUserId(extra, accountKey);
          const user = userId ? await getUserProfile(userId) : null;
          const clock = resolveClientDay(clientDate, clientTimeZone);
          const goal = findBodyGoal(user?.targetBodyType);
          const targetDays = user?.targetDays ?? 0;
          const targetStartedOn =
            typeof user?.targetStartedOn === "string" ? user.targetStartedOn : "";
          const targetEndedOn =
            typeof user?.targetEndedOn === "string" && user.targetEndedOn
              ? user.targetEndedOn
              : targetStartedOn && targetDays > 0
                ? addDays(targetStartedOn, Math.max(0, targetDays - 1))
                : "";
          const bodyGoalSaved = Boolean(
            goal && targetDays > 0 && targetStartedOn && targetEndedOn,
          );
          return {
            content: [
              shown(
                bodyGoalSaved
                  ? `현재 워너비는 '${goal!.title}' · ${targetStartedOn}~${targetEndedOn}입니다. 카드에서 취소하거나 수정할 수 있습니다.`
                  : "워너비 체형을 골라 주세요. 닮고 싶은 사진을 누르면 됩니다.",
              ),
              modelOnly(
                bodyGoalSaved
                  ? "이미 워너비가 저장돼 있습니다. 사용자가 수정·취소하기 전에는 recommend-inbody-workout이 이 목표를 따릅니다."
                  : "목표 체형 카드를 열었습니다. 사용자가 사진과 기한을 고르고 저장하기 전에는 recommend-inbody-workout의 운동 코스·설득에 목표가 반영되지 않습니다.",
              ),
            ],
            structuredContent: {
              bodyGoalSaved,
              selected: goal?.id ?? "",
              selectedTitle: goal?.title ?? "",
              targetDays,
              targetStartedOn: targetStartedOn || null,
              targetEndedOn: targetEndedOn || null,
              presets: bodyGoalPresets.map((item) => ({
                id: item.id,
                title: item.title,
                detail: item.detail,
              })),
              sex: user?.sex ?? "male",
              heightCm: user?.heightCm ?? 0,
              bodyFatKg: user?.bodyFatKg ?? 0,
              bodyFatPercent: user?.bodyFatPercent ?? 0,
              today: clock.day,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-body-goal",
          description:
            "워너비 체형·기한을 저장한다. 시작일=기기 오늘(clientDate), 종료일=시작+(targetDays-1)을 users.target_started_on·target_ended_on에 함께 넣는다. 성실도 스티커는 이 기간에만 붙는다.",
          inputSchema: {
            targetBodyType: z.enum(targetBodyTypes),
            targetDays: z
              .number()
              .int()
              .min(14)
              .max(365)
              .describe("목표 체형까지 잡은 기한. 14일에서 365일."),
            ...clientClockFields(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save body goal",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the body goal…",
            "openai/toolInvocation/invoked": "Body goal saved.",
          },
        },
        async (
          { targetBodyType, targetDays, accountKey, clientDate, clientTimeZone },
          extra,
        ) => {
          const userId = await accountId(extra, accountKey);
          const clock = resolveClientDay(clientDate, clientTimeZone);
          const startedOn = clock.day;
          // Inclusive window: start .. start+(targetDays-1)
          const endedOn = addDays(startedOn, Math.max(0, targetDays - 1));
          await saveTargetBodyType(
            userId,
            targetBodyType,
            targetDays,
            startedOn,
            endedOn,
          );
          const label = bodyGoalLabel[targetBodyType as TargetBodyType];
          const message = `'${label}' 목표를 ${startedOn}부터 ${targetDays}일(${endedOn}까지)로 저장했습니다. 성실도 스티커와 성장 나무는 이 기간에만 붙습니다.`;
          return {
            content: message,
            structuredContent: {
              saved: true,
              bodyGoalSaved: true,
              targetBodyType,
              targetDays,
              targetStartedOn: startedOn,
              targetEndedOn: endedOn,
              until: endedOn,
              message,
            },
          };
        },
      )
      .registerTool(
        {
          name: "clear-body-goal",
          description:
            "저장된 워너비 체형·기한·시작일·종료일을 지운다(운동기록 취소). 성실도 스티커·성장 나무가 더 이상 붙지 않는다. 식사·운동 로그는 지우지 않는다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Clear body goal",
            readOnlyHint: false,
            destructiveHint: true,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Clearing the body goal…",
            "openai/toolInvocation/invoked": "Body goal cleared.",
          },
        },
        async ({ accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          await clearTargetBodyGoal(userId);
          const message =
            "워너비 체형과 기한을 취소했습니다. 성실도 스티커는 다시 목표를 정할 때까지 붙지 않습니다.";
          return {
            content: message,
            structuredContent: {
              cleared: true,
              bodyGoalSaved: false,
              message,
            },
          };
        },
      )
      .registerTool(
        {
          name: "list-training-docs",
          description:
            "D1에 저장된 Hands-On Diet 참고 문서 목록을 본다. 1일 권장 칼로리·운동 종목 선정·인바디 1RM 처방 문서를 고르기 전에 호출한다. 본문은 search-training-docs 또는 get-training-doc으로 읽는다.",
          inputSchema: {},
          annotations: {
            title: "List training reference docs",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Listing training docs…",
            "openai/toolInvocation/invoked": "Training docs listed.",
          },
        },
        async () => {
          const docs = await listTrainingDocs();
          return {
            content: [
              text(
                docs.length === 0
                  ? "참고 문서가 아직 없습니다. 시드가 적용됐는지 확인하세요."
                  : docs
                      .map(
                        (d) =>
                          `- ${d.id} [${d.topic}] ${d.title}: ${d.summary}`,
                      )
                      .join("\n"),
              ),
            ],
            structuredContent: { docs },
          };
        },
      )
      .registerTool(
        {
          name: "search-training-docs",
          description:
            "R2/D1에 둔 과학 근거 플레이북을 검색한다. 1일 권장 칼로리·탄단지·급격한 다이어트 차단을 말할 때 topic=daily_kcal. 종목·분할·볼륨은 topic=exercise_selection. 인바디 Phase·타이머·1RM·RIR은 topic=inbody_1rm. 칼로리 설명 전, 또는 recommend-inbody-workout이 source=fresh이거나 사용자가 근거·왜?를 물을 때만 호출한다. weekPlan.source=cache면 다시 부르지 않는다. 반환된 excerpt만 근거로 쓴다.",
          inputSchema: {
            query: z
              .string()
              .min(2)
              .describe("검색어. 예: EA 30, Alpert, 분수 볼륨, Mayhew, rest_timer."),
            topic: z
              .enum(trainingDocTopics)
              .optional()
              .describe(
                "daily_kcal | exercise_selection | inbody_1rm. 생략하면 전체.",
              ),
            limit: z
              .number()
              .int()
              .min(1)
              .max(12)
              .optional()
              .describe("최대 청크 수. 기본 6."),
          },
          annotations: {
            title: "Search training reference docs",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Searching training docs…",
            "openai/toolInvocation/invoked": "Training docs searched.",
          },
        },
        async ({ query, topic, limit }) => {
          const hits = await searchTrainingDocs({ query, topic, limit });
          return {
            content: [
              text(
                hits.length === 0
                  ? "맞는 청크가 없습니다. query를 짧게 바꾸거나 topic을 빼 보세요."
                  : hits
                      .map(
                        (h, i) =>
                          `[${i + 1}] ${h.title} · ${h.heading || `(chunk ${h.chunkIndex})`}\n${h.excerpt}`,
                      )
                      .join("\n\n---\n\n"),
              ),
            ],
            structuredContent: { query, topic: topic ?? null, hits },
          };
        },
      )
      .registerTool(
        {
          name: "get-training-doc",
          description:
            "참고 문서 하나(daily-kcal | exercise-selection | inbody-1rm)의 앞쪽 청크를 순서대로 읽는다. search-training-docs로 범위를 좁힌 뒤 더 필요할 때만 쓴다.",
          inputSchema: {
            docId: z
              .enum(["daily-kcal", "exercise-selection", "inbody-1rm"])
              .describe("문서 id."),
            limit: z
              .number()
              .int()
              .min(1)
              .max(40)
              .optional()
              .describe("앞에서부터 읽을 청크 수. 기본 12."),
          },
          annotations: {
            title: "Get training reference doc",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Loading training doc…",
            "openai/toolInvocation/invoked": "Training doc loaded.",
          },
        },
        async ({ docId, limit }) => {
          const result = await getTrainingDocChunks(docId, limit ?? 12);
          if (!result) {
            return {
              content: [text(`문서 ${docId}가 없습니다.`)],
              structuredContent: { found: false, docId },
            };
          }
          return {
            content: [
              text(
                `${result.doc.title}\n${result.doc.summary}\nR2: ${result.doc.r2Key}\n\n` +
                  result.chunks
                    .map(
                      (c) =>
                        `## ${c.heading || `chunk ${c.chunkIndex}`}\n${c.body}`,
                    )
                    .join("\n\n"),
              ),
            ],
            structuredContent: {
              found: true,
              doc: result.doc,
              chunks: result.chunks,
            },
          };
        },
      )
      .registerTool(
        {
          name: "recommend-inbody-workout",
          description:
            "저장된 인바디와 워너비 체형으로 맞춤 운동 카드를 연다. ‘오늘’·이번 주(월~일)는 기기 로컬 날짜(clientDate·clientTimeZone, 없으면 date) 기준이다. 그 주 계획이 DB에 있으면 불러오기만 한다(weekPlan.source=cache). 없으면 월~일 코스를 짜서 저장한다(source=fresh). source=cache이면 search-training-docs를 다시 부르지 않는다. 홈 위젯이 clientDate를 넘긴다. trainingVenue(gym|home)·homeEquipment만 장소로 넘긴다. missingSlots면 add-catalog-exercises 후 다시 연다. Claude에서 accountKey를 모르면 open-home을 intent workout-plan으로 호출한다.",
          inputSchema: {
            date: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. clientDate가 있으면 clientDate 우선."),
            trainingVenue: z
              .enum(trainingVenues)
              .optional()
              .describe("gym=헬스장(기본), home=홈트레이닝."),
            homeEquipment: z
              .array(z.enum(homeEquipmentIds))
              .optional()
              .describe(
                "홈트레이닝일 때 집에 있는 기구. bodyweight|dumbbell|kettlebell|band|pullup_bar|bench. 생략하면 맨몸만.",
              ),
            injuredParts: z
              .array(z.enum(injuredPartIds))
              .optional()
              .describe(
                "불편·부상 부위. shoulder|wrist|elbow|low_back|knee|ankle|neck. 없으면 생략하거나 빈 배열.",
              ),
            ecwRatio: z
              .number()
              .min(0.3)
              .max(0.5)
              .optional()
              .describe("인바디 세포외수분비 ECW/TBW. 결과지에 있으면 넣는다."),
            visceralFatLevel: z
              .number()
              .int()
              .min(1)
              .max(30)
              .optional()
              .describe("인바디 내장지방레벨(VFL). 결과지에 있으면 넣는다."),
            ...clientClockFields(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Recommend InBody workout",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Loading or building this week’s workout…",
            "openai/toolInvocation/invoked": "Workout plan ready.",
          },
          view: {
            component: "inbody-workout",
            description: "InBody-based workout plan with timer modes",
            csp: {
              redirectDomains: [
                ...evidenceRedirectDomains,
                "https://www.youtube.com",
                "https://youtube.com",
                "https://m.youtube.com",
              ],
            },
          },
        },
        async (
          {
            date,
            accountKey,
            injuredParts,
            ecwRatio,
            visceralFatLevel,
            trainingVenue,
            homeEquipment,
            clientDate,
            clientTimeZone,
          },
          extra,
        ) => {
          const userId = await accountId(extra, accountKey);
          const clock = resolveClientDay(
            clientDate && clientDate.length > 0
              ? clientDate
              : date && date.length > 0
                ? date
                : undefined,
            clientTimeZone,
          );
          const day = clock.day;
          const venue: TrainingVenue =
            trainingVenue === "home" ? "home" : "gym";
          const gear: HomeEquipment[] =
            venue === "home"
              ? normalizeHomeEquipment(homeEquipment as HomeEquipment[] | undefined)
              : [];
          const user = await getUserProfile(userId);
          const emptyRadar = [
            { region: "상체 좌", actual: 0, standard: 0 },
            { region: "상체 우", actual: 0, standard: 0 },
            { region: "코어", actual: 0, standard: 0 },
            { region: "하체 좌", actual: 0, standard: 0 },
            { region: "하체 우", actual: 0, standard: 0 },
          ];
          if (
            !user?.inbodyMeasuredOn ||
            !(user.weightKg && user.weightKg > 0)
          ) {
            return {
              content: [
                shown(
                  "인바디가 아직 없어 맞춤 운동을 만들지 못했습니다. 결과지 사진을 올려 주세요.",
                ),
                modelOnly(
                  "인바디가 없다. save-inbody로 저장한 뒤 recommend-inbody-workout을 다시 호출하세요.",
                ),
              ],
              structuredContent: {
                inbodySaved: false,
                bodyGoalSaved: false,
                message:
                  "인바디 결과지를 먼저 저장해 주세요. 저장되면 체형과 좌우 밸런스에 맞춰 운동과 타이머를 짜 드립니다.",
                date: day,
                clientDate: day,
                clientTimeZone: clock.timeZone,
                weekPlan: null as WeekPlanPayload | null,
                shape: "I",
                phase: 1,
                phaseLabel: "",
                isImbalanced: false,
                recommendedMode: "emom" as const,
                recommendedIntensity: 0.7,
                reason: "",
                inbodyReasoning: "",
                safetyNotes: [] as string[],
                injuredParts: [] as string[],
                prescription: null,
                evidence: [] as ReturnType<typeof evidenceForPlan>,
                glossary: [] as ReturnType<typeof glossaryList>,
                persuasion: {},
                persuasionIntensity: {},
                overrideLine: {},
                weakLabels: [] as string[],
                targetLabels: [] as string[],
                targetBodyType: "",
                targetBodyLabel: "",
                trainingVenue: venue,
                sessionFocus: "full" as const,
                sessionKind: "full" as const,
                sessionLabel: "",
                scheduleBias: "balanced" as const,
                scheduleReason: "",
                weekHint: "",
                splitLabel: "",
                missingSlots: [] as Array<{
                  role: string;
                  label: string;
                  region: string;
                  muscles: string;
                  hint: string;
                }>,
                recentExerciseNames: [] as string[],
                homeEquipment: gear,
                splitRecommended: false,
                splitHint: "",
                catalog: [] as Array<{
                  slug: string;
                  nameKo: string;
                  kind: "strength" | "cardio";
                  laterality: "unilateral" | "bilateral";
                  region: "upper" | "core" | "lower" | "full";
                  isolation: number;
                  cue: string;
                }>,
                snapshot: null,
                e1RmByExercise: {} as Record<string, number>,
                structuralIssues: [] as StructuralIssue[],
                exercises: [] as PlannedExercise[],
                timer: scaleTimer("emom", 1),
                radar: emptyRadar,
                sex: user?.sex ?? "",
                bodyFatKg: 0,
                toneLevel: user?.toneLevel ?? 0,
                accountKey: guestKey(userId),
              },
            };
          }
          const catalog = (await listExercises()).map((row) => ({
            slug: row.slug,
            nameKo: row.nameKo,
            kind: row.kind,
            laterality: row.laterality,
            region: row.region,
            isolation: row.isolation,
            cue: row.cue,
          }));
          const recentLogs = await listWorkoutLogs(
            userId,
            addDays(day, -56),
            day,
          );
          const e1RmByExercise: Record<string, number> = {};
          for (const row of recentLogs) {
            if (row.weightKg <= 0 || row.reps < 1 || row.reps > 10) continue;
            const category = inferLiftCategory(row.exercise, row.exercise);
            const e1 = estimate1RM({
              weightKg: row.weightKg,
              performedReps: row.reps,
              category,
            });
            if (e1 <= 0) continue;
            const prev = e1RmByExercise[row.exercise] ?? 0;
            if (e1 > prev) e1RmByExercise[row.exercise] = e1;
          }
          const priorLogs = recentLogs.filter((row) => row.date < day);
          const lastTrainDate = priorLogs.reduce(
            (max, row) => (row.date > max ? row.date : max),
            "",
          );
          const recentExerciseNames = lastTrainDate
            ? [
                ...new Set(
                  priorLogs
                    .filter((row) => row.date === lastTrainDate)
                    .map((row) => row.exercise),
                ),
              ]
            : [];
          const snapshot = {
            heightCm: user.heightCm ?? 0,
            sex: (user.sex === "female" ? "female" : "male") as "male" | "female",
            weightKg: user.weightKg ?? 0,
            skeletalMuscleKg: user.skeletalMuscleKg ?? 0,
            bodyFatKg: user.bodyFatKg ?? 0,
            bodyFatPercent: user.bodyFatPercent ?? 0,
            muscleUpperLeftKg: user.muscleUpperLeftKg ?? 0,
            muscleUpperRightKg: user.muscleUpperRightKg ?? 0,
            muscleCoreKg: user.muscleCoreKg ?? 0,
            muscleLowerLeftKg: user.muscleLowerLeftKg ?? 0,
            muscleLowerRightKg: user.muscleLowerRightKg ?? 0,
            ecwRatio: ecwRatio ?? null,
            visceralFatLevel: visceralFatLevel ?? null,
          };
          const goalId = findBodyGoal(user.targetBodyType)?.id ?? null;
          const injured = (injuredParts ?? []) as InjuredPart[];
          const { weekStart, weekEnd } = seoulWeekBounds(day);
          const gearKey = homeEquipmentKey(venue, gear);
          const fingerprint = weekPlanFingerprint({
            targetBodyType: goalId,
            targetDays: user.targetDays ?? null,
            injuredParts: injured,
            inbodyMeasuredOn: user.inbodyMeasuredOn,
            weightKg: snapshot.weightKg,
            skeletalMuscleKg: snapshot.skeletalMuscleKg,
            bodyFatKg: snapshot.bodyFatKg,
            muscleUpperLeftKg: snapshot.muscleUpperLeftKg,
            muscleUpperRightKg: snapshot.muscleUpperRightKg,
            muscleCoreKg: snapshot.muscleCoreKg,
            muscleLowerLeftKg: snapshot.muscleLowerLeftKg,
            muscleLowerRightKg: snapshot.muscleLowerRightKg,
            catalogSlugs: catalog.map((row) => row.slug),
          });

          let weekPlan: WeekPlanPayload | null = null;
          const savedRow = await getWorkoutWeekPlan({
            userId,
            weekStart,
            venue,
            homeEquipment: gearKey,
          });
          if (savedRow) {
            const parsed = parseWeekPlanPayload(savedRow.planJson);
            if (
              parsed &&
              savedRow.fingerprint === fingerprint &&
              !weekPlanHasGaps(parsed)
            ) {
              weekPlan = { ...parsed, source: "cache" };
            }
          }
          if (!weekPlan) {
            weekPlan = buildWeekPlanPayload({
              weekStart,
              weekEnd,
              snapshot,
              catalog,
              targetBodyType: goalId,
              injuredParts: injured,
              e1RmByExercise,
              trainingVenue: venue,
              homeEquipment: gear,
              recentExerciseNames,
              targetDays: user.targetDays ?? null,
              fingerprint,
            });
            await upsertWorkoutWeekPlan({
              userId,
              weekStart,
              weekEnd,
              venue,
              homeEquipment: gearKey,
              fingerprint,
              planJson: JSON.stringify({ ...weekPlan, source: "fresh" }),
            });
            weekPlan = { ...weekPlan, source: "fresh" };
          }

          const daySlice =
            pickWeekPlanDay(weekPlan, day) ??
            weekPlan.days.find((slot) => slot.mark === "O") ??
            weekPlan.days[0]!;
          const restToday = daySlice.mark === "X";
          const dayPrescription = daySlice.prescription;
          const plan = {
            shape: weekPlan.shape as "C" | "I" | "D",
            phase: weekPlan.phase,
            phaseLabel: weekPlan.phaseLabel,
            isImbalanced: weekPlan.isImbalanced,
            upper: { gapKg: 0, gapPct: 0, weaker: null as "left" | "right" | null },
            lower: { gapKg: 0, gapPct: 0, weaker: null as "left" | "right" | null },
            weakLabels: weekPlan.weakLabels,
            targetLabels: weekPlan.targetLabels,
            targetBodyType: (weekPlan.targetBodyType ||
              null) as TargetBodyType | null,
            targetBodyLabel: weekPlan.targetBodyLabel,
            trainingVenue: weekPlan.venue,
            sessionFocus: daySlice.sessionFocus,
            sessionKind: restToday ? ("full" as const) : daySlice.sessionKind === "rest" ? ("full" as const) : daySlice.sessionKind,
            sessionLabel: daySlice.sessionLabel,
            scheduleBias: weekPlan.scheduleBias,
            scheduleReason: weekPlan.scheduleReason,
            weekHint: weekPlan.weekHint,
            splitLabel: daySlice.sessionLabel,
            missingSlots: daySlice.missingSlots,
            homeEquipment: weekPlan.homeEquipment,
            splitRecommended: false,
            splitHint: weekPlan.weekHint,
            recommendedMode: daySlice.recommendedMode,
            recommendedIntensity: daySlice.recommendedIntensity,
            prescription:
              dayPrescription ??
              ({
                mode: "rest_timer" as const,
                sets: 0,
                reps: 0,
                targetRir: 2,
                pct1RmMin: 0,
                pct1RmMax: 0,
                restSec: 0,
                limitSec: 0,
                roundSec: 0,
                intensityFactor: 1,
                bandLabel: "휴식",
              } as const),
            reason: `${weekPlan.scheduleReason} ${weekPlan.weekHint}`.trim(),
            inbodyReasoning: `${weekPlan.phaseLabel} · ${weekPlan.shape}자형 · ${weekPlan.weekHint}`,
            safetyNotes: daySlice.safetyNotes,
            injuredParts: injured,
            structuralIssues: weekPlan.structuralIssues,
            exercises: restToday ? ([] as PlannedExercise[]) : daySlice.exercises,
            timer: dayPrescription
              ? scaleTimer(dayPrescription.mode, dayPrescription)
              : scaleTimer("rest_timer", 1),
            energy: daySlice.energy ?? {
              targetExerciseKcal: 0,
              strengthBurnKcal: 0,
              cardioBurnKcal: 0,
              cardioMinutes: 0,
              goalIntakeKcal: 0,
              bmrKcal: 0,
            },
          };
          const weekPlanSource = weekPlan.source;
          const values = regionValues(snapshot);
          const mean =
            values.filter((item) => item.kg > 0).reduce((sum, item) => sum + item.kg, 0) /
              Math.max(1, values.filter((item) => item.kg > 0).length) || 0;
          const label = {
            upperLeft: "상체 좌",
            upperRight: "상체 우",
            core: "코어",
            lowerLeft: "하체 좌",
            lowerRight: "하체 우",
          } as const;
          const radar = values.map((item) => ({
            region: label[item.key],
            actual: Math.round(item.kg * 10) / 10,
            standard: Math.round(mean * 10) / 10,
          }));
          const toneLevel = user.toneLevel ?? 0;
          const persuasion: Record<string, string> = {};
          const persuasionIntensity: Record<string, string> = {};
          const overrideLine: Record<string, string> = {};
          for (const mode of workoutTimerModes) {
            if (mode === plan.recommendedMode) continue;
            persuasion[mode] = persuasionCopy({
              recommendedMode: plan.recommendedMode,
              requestedMode: mode,
              isImbalanced: plan.isImbalanced,
              shape: plan.shape,
              bodyFatKg: snapshot.bodyFatKg,
              upperGapKg: plan.upper.gapKg,
              upperGapPct: plan.upper.gapPct,
              lowerGapKg: plan.lower.gapKg,
              lowerGapPct: plan.lower.gapPct,
              weakLabels: plan.weakLabels,
              targetBodyLabel: plan.targetBodyLabel,
              toneLevel,
              kind: "mode",
            });
            overrideLine[mode] = overrideCopy(mode);
          }
          for (const step of [0.7, 0.85, 1, 1.15, 1.3]) {
            if (Math.abs(step - plan.recommendedIntensity) < 0.01) continue;
            persuasionIntensity[String(step)] = persuasionCopy({
              recommendedMode: plan.recommendedMode,
              requestedMode: plan.recommendedMode,
              isImbalanced: plan.isImbalanced,
              shape: plan.shape,
              bodyFatKg: snapshot.bodyFatKg,
              upperGapKg: plan.upper.gapKg,
              upperGapPct: plan.upper.gapPct,
              lowerGapKg: plan.lower.gapKg,
              lowerGapPct: plan.lower.gapPct,
              weakLabels: plan.weakLabels,
              targetBodyLabel: plan.targetBodyLabel,
              toneLevel,
              kind: "intensity",
              recommendedIntensity: plan.recommendedIntensity,
              requestedIntensity: step,
            });
          }
          const goalNote = goalId
            ? ""
            : " 워너비 체형이 없으면 choose-body-goal을 먼저 열라고 안내하세요.";
          const structuralNote =
            plan.structuralIssues.length > 0
              ? ` 구조 문제: ${plan.structuralIssues.map((issue) => `${issue.title}: ${issue.detail}`).join(" ")} 체중·체지방과 상관없이 왜 꼭 해야 하는지 설명하고, 모드·강도를 바꿔도 필수 교정 종목은 빼지 마세요.`
              : "";
          const exerciseBrief = plan.exercises
            .map((item, index) => {
              const load =
                item.workingWeightKg > 0
                  ? `${item.workingWeightKg}kg`
                  : "무게 탐색";
              return `${index + 1}. ${item.nameKo}${item.required ? "(필수)" : ""} — ${item.sets || "AMRAP"}×${item.reps}회 · ${load} · 방법: ${item.method} · 이유: ${item.why}`;
            })
            .join("\n");
          const injuryAsk =
            injured.length === 0
              ? " 아직 injuredParts가 비어 있으면, 운동 전에 어깨·손목·허리·무릎 등 불편한 곳이 있는지 한 줄로 묻고 다시 호출하세요."
              : ` 불편 부위: ${injured
                  .map((p) => injuredPartLabel[p] ?? p)
                  .join(", ")}.`;
          const evidence = evidenceForPlan({
            isImbalanced: plan.isImbalanced,
            shape: plan.shape,
            phase: plan.phase,
            recommendedMode: plan.recommendedMode,
            hasWeakPriority: plan.weakLabels.length > 0,
          });
          const evidenceBlock = formatEvidenceForModel(evidence);
          const missingNote =
            plan.missingSlots.length > 0
              ? `\nDB에 없는 역할이 있습니다. 사용자에게 빈 역할을 운동인 것처럼 말하지 마세요. 먼저 add-catalog-exercises를 호출하세요. role은 아래만, 장소는 ${venue}, 홈 기구는 ${gear.join(",") || "bodyweight"}. 역할마다 종목 1개. 넣은 뒤 recommend-inbody-workout을 같은 trainingVenue·homeEquipment로 다시 여세요.\n${plan.missingSlots.map((slot) => `- ${slot.role}: ${slot.label} (${slot.muscles}). ${slot.hint}`).join("\n")}`
              : "";
          const cacheNote =
            weekPlanSource === "cache"
              ? ` 이번 주(${weekStart}~${weekEnd}) 계획은 이미 DB에 있어서 불러오기만 했다(weekPlan.source=cache). search-training-docs를 다시 부르지 마세요. 사용자가 근거·왜?를 물을 때만 검색하세요.`
              : ` 이번 주(${weekStart}~${weekEnd}) 코스를 새로 짜서 DB에 저장했다(weekPlan.source=fresh).`;
          return {
            content: [
              shown(
                restToday
                  ? `${plan.phaseLabel} · ${plan.shape}자형 · ${day}은 휴식(X)입니다. 이번 주 ${weekStart}~${weekEnd} 코스는 ${weekPlanSource === "cache" ? "저장된 계획" : "새로 저장"}입니다.`
                  : `${plan.phaseLabel} · ${plan.shape}자형 · ${venue === "home" ? "홈트레이닝" : "헬스장"} · ${plan.sessionLabel} · ${modeLabel[plan.recommendedMode]} · ${plan.prescription.bandLabel}. ${plan.exercises.map((item) => (item.required ? `${item.nameKo}(필수)` : item.nameKo)).join(", ")}.`,
              ),
              modelOnly(
                `맞춤 운동 카드를 열었습니다.${cacheNote} ${plan.scheduleReason} ${plan.weekHint}. ${plan.inbodyReasoning}. 부위는 트레이너가 정했다. 사용자에게 상체/하체/전신을 고르라고 하지 마세요. 헬스장/홈트레이닝과 집 기구만 카드에서 바꿉니다. 사용자에게 코스 요약과 각 종목의 method·why를 설명해 주세요.\n${exerciseBrief || "(오늘은 휴식)"}
모드·중량을 단순 회피로 낮추려 하면 설득하고, 부상·통증이면 즉시 대체합니다.${structuralNote}${goalNote}${injuryAsk}${missingNote}\n사용자가 "왜?", "근거가 뭐야?", "논문/링크 보여줘"라고 하면 structuredContent.evidence의 pitch와 links URL을 그대로 보여 주세요. 지어내지 마세요. AMRAP·EMOM·RIR·%1RM 등 용어를 물을 때는 structuredContent.glossary의 body로 쉽게 설명해 주세요.\n과학적 근거:\n${evidenceBlock}`,
              ),
            ],
            structuredContent: {
              inbodySaved: true,
              bodyGoalSaved: Boolean(goalId),
              message: goalId
                ? weekPlanSource === "cache"
                  ? `이번 주(${weekStart}~${weekEnd}) 저장된 코스를 불러왔습니다.`
                  : `이번 주(${weekStart}~${weekEnd}) 코스를 짜서 저장했습니다.`
                : "워너비 체형 사진을 고르면 운동 코스와 설득 멘트가 그 목표를 따라갑니다.",
              date: day,
              clientDate: day,
              clientTimeZone: clock.timeZone,
              weekPlan,
              shape: plan.shape,
              phase: plan.phase,
              phaseLabel: plan.phaseLabel,
              isImbalanced: plan.isImbalanced,
              recommendedMode: plan.recommendedMode,
              recommendedIntensity: plan.recommendedIntensity,
              reason: plan.reason,
              inbodyReasoning: plan.inbodyReasoning,
              safetyNotes: plan.safetyNotes,
              injuredParts: plan.injuredParts,
              prescription: plan.prescription,
              evidence,
              glossary: glossaryList().map((item) => ({
                id: item.id,
                label: item.label,
                title: item.title,
                body: item.body,
              })),
              persuasion,
              persuasionIntensity,
              overrideLine,
              weakLabels: plan.weakLabels,
              targetLabels: plan.targetLabels,
              targetBodyType: plan.targetBodyType ?? "",
              targetBodyLabel: plan.targetBodyLabel,
              trainingVenue: plan.trainingVenue,
              sessionFocus: plan.sessionFocus,
              sessionKind: plan.sessionKind,
              sessionLabel: plan.sessionLabel,
              scheduleBias: plan.scheduleBias,
              scheduleReason: plan.scheduleReason,
              weekHint: plan.weekHint,
              splitLabel: plan.splitLabel,
              missingSlots: plan.missingSlots,
              recentExerciseNames,
              homeEquipment: plan.homeEquipment,
              splitRecommended: plan.splitRecommended,
              splitHint: plan.splitHint,
              catalog,
              snapshot,
              e1RmByExercise,
              structuralIssues: plan.structuralIssues,
              exercises: plan.exercises,
              timer: plan.timer,
              radar,
              sex: snapshot.sex,
              bodyFatKg: snapshot.bodyFatKg,
              targetDays: user.targetDays ?? 0,
              energy: plan.energy,
              toneLevel,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "add-catalog-exercises",
          description:
            "맞춤 운동 DB에 없는 역할만 종목으로 넣는다. recommend-inbody-workout의 missingSlots에 있는 role만 받는다. 이미 DB에 있는 종목은 다시 넣지 않는다. 뷰를 바꾸지 않는다. 넣은 뒤 recommend-inbody-workout을 같은 장소·기구로 다시 연다.",
          inputSchema: {
            trainingVenue: z
              .enum(trainingVenues)
              .describe("지금 카드의 장소. gym 또는 home."),
            homeEquipment: z
              .array(z.enum(homeEquipmentIds))
              .optional()
              .describe("home일 때 집에 있는 기구. gym이면 생략."),
            exercises: z
              .array(
                z.object({
                  role: z
                    .enum(exerciseRoleIds as [string, ...string[]])
                    .describe("missingSlots의 role. 그 외는 거절된다."),
                  slug: z
                    .string()
                    .min(3)
                    .max(40)
                    .describe("영문 소문자와 하이픈. 예: incline-db-press"),
                  nameKo: z.string().min(2).max(40).describe("한글 종목 이름"),
                  laterality: z
                    .enum(["unilateral", "bilateral"])
                    .describe("한 팔·한 다리면 unilateral, 양쪽이면 bilateral"),
                  cue: z
                    .string()
                    .min(4)
                    .max(160)
                    .describe("한 줄 수행 포인트"),
                }),
              )
              .min(1)
              .max(8),
          },
          annotations: {
            title: "Add catalog exercises",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Adding missing exercises…",
            "openai/toolInvocation/invoked": "Catalog updated.",
          },
        },
        async ({ trainingVenue, homeEquipment, exercises }) => {
          const venue: TrainingVenue =
            trainingVenue === "home" ? "home" : "gym";
          const gear = new Set(
            normalizeHomeEquipment(
              venue === "home" ? (homeEquipment as HomeEquipment[]) : undefined,
            ),
          );
          const accepted: {
            slug: string;
            nameKo: string;
            kind: "strength";
            laterality: "unilateral" | "bilateral";
            region: "upper" | "core" | "lower" | "full";
            isolation: number;
            cue: string;
          }[] = [];
          const rejected: string[] = [];
          for (const item of exercises) {
            const slot = slotByRole(item.role);
            if (!slot) {
              rejected.push(`${item.role}: 알 수 없는 역할`);
              continue;
            }
            const slug = item.slug
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, "")
              .slice(0, 40);
            const nameKo = item.nameKo.trim();
            if (slug.length < 3 || nameKo.length < 2) {
              rejected.push(`${item.nameKo}: 이름 형식이 맞지 않습니다`);
              continue;
            }
            const draft = { slug, nameKo };
            if (
              venue === "home" &&
              (venueOf(draft) === "gym" || !gear.has(homeEquipmentNeeded(draft)))
            ) {
              rejected.push(
                `${nameKo}: 홈에서 고른 기구(${[...gear].join(", ")})로 할 수 없습니다`,
              );
              continue;
            }
            accepted.push({
              slug,
              nameKo,
              kind: "strength",
              laterality: item.laterality,
              region: slot.region,
              isolation: slot.isolation,
              cue: item.cue.trim(),
            });
          }
          const saved =
            accepted.length > 0 ? await insertExercises(accepted) : { saved: [], skipped: [] };
          const line = [
            saved.saved.length > 0 ? `추가: ${saved.saved.join(", ")}` : "",
            saved.skipped.length > 0 ? `이미 있음: ${saved.skipped.join(", ")}` : "",
            rejected.length > 0 ? `거절: ${rejected.join(" / ")}` : "",
          ]
            .filter(Boolean)
            .join(". ");
          return {
            content: [
              shown(line || "넣을 종목이 없습니다."),
              modelOnly(
                `${line || "변경 없음."} 이어서 recommend-inbody-workout을 trainingVenue=${venue}${venue === "home" ? `, homeEquipment=${[...gear].join(",")}` : ""}로 다시 여세요. 부위를 사용자에게 고르라고 하지 마세요. 거절된 종목은 기구에 맞게 다시 넣으세요.`,
              ),
            ],
            structuredContent: {
              saved: saved.saved,
              skipped: saved.skipped,
              rejected,
            },
          };
        },
      )
      .registerTool(
        {
          name: "lookup-exercise-howto",
          description:
            "운동 종목 이름을 유튜브에서 '{종목} 하는법'으로 검색해 영상 링크를 돌려준다. 맞춤 운동 카드의 '운동방법 찾기'가 호출한다. 뷰를 바꾸지 않는다.",
          inputSchema: {
            exerciseName: z
              .string()
              .min(1)
              .max(80)
              .describe("운동 종목 한글 이름. 예: 푸시업"),
            limit: z
              .number()
              .int()
              .min(1)
              .max(8)
              .optional()
              .describe("가져올 영상 수. 생략하면 5."),
          },
          annotations: {
            title: "Find exercise how-to videos",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Searching YouTube for how-to…",
            "openai/toolInvocation/invoked": "How-to videos ready.",
          },
        },
        async ({ exerciseName, limit }) => {
          const result = await searchExerciseHowto(exerciseName, limit ?? 5);
          const lines =
            result.videos.length > 0
              ? result.videos
                  .map((item, index) => `${index + 1}. ${item.title} — ${item.url}`)
                  .join("\n")
              : `검색 결과 HTML을 읽지 못했습니다. 유튜브에서 직접 보세요: ${result.searchUrl}`;
          return {
            content: [
              shown(
                result.videos.length > 0
                  ? `'${result.query}' 유튜브 영상 ${result.videos.length}개를 찾았습니다.`
                  : `'${result.query}' 영상 목록을 바로 못 가져왔습니다. 검색 페이지 링크를 열 수 있습니다.`,
              ),
              modelOnly(
                `유튜브 검색 '${result.query}'. 사용자에게 URL을 그대로 보여 주세요. 지어내지 마세요.\n${lines}`,
              ),
            ],
            structuredContent: {
              exerciseName,
              query: result.query,
              searchUrl: result.searchUrl,
              videos: result.videos,
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-workout-log",
          description:
            "인바디 맞춤 운동 카드에서 사용자가 완료를 누른 뒤 호출한다. 수행한 타이머 모드, 총 시간(초), 라운드/세트, 종목 목록을 저장한다. 종목마다 workout_logs 한 줄을 새로 넣고 기존 기록을 고치지 않는다. log-workout 카드의 저장은 save-workout-logs를 쓴다.",
          inputSchema: {
            date: z.string().describe("YYYY-MM-DD"),
            mode: z.enum(workoutTimerModes).describe("실제로 수행한 타이머 모드"),
            recommendedMode: z
              .enum(workoutTimerModes)
              .describe("카드가 처음 추천한 모드"),
            overridden: z
              .boolean()
              .describe("추천 모드를 설득 후 바꿨으면 true"),
            durationSec: z.number().nonnegative().describe("총 운동 시간(초)"),
            rounds: z
              .number()
              .int()
              .nonnegative()
              .describe("AMRAP 라운드 또는 완료 세트 수"),
            entries: z
              .array(workoutEntrySchema)
              .min(1)
              .describe("수행한 종목"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save timed workout",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the timed workout…",
            "openai/toolInvocation/invoked": "Timed workout saved.",
          },
        },
        async (
          {
            date,
            mode,
            recommendedMode,
            overridden,
            durationSec,
            rounds,
            entries,
            accountKey,
          },
          extra,
        ) => {
          const userId = await accountId(extra, accountKey);
          const user = await getUserProfile(userId);
          const day = date.length > 0 ? date : seoulToday();
          const bodyWeightKg = user?.weightKg ?? 0;
          const durationMin =
            Math.round((Math.max(0, durationSec) / 60) * 10) / 10;
          const items = entries
            .map(normalizeWorkoutEntry)
            .filter((item) => item.exercise.length > 0)
            .map((item, _index, list) => {
              const share =
                item.durationMin > 0
                  ? item.durationMin
                  : Math.round((durationMin / Math.max(1, list.length)) * 10) /
                    10;
              return {
                ...item,
                durationMin: share,
                burnedKcal: estimateBurnedKcal(
                  item.kind,
                  share,
                  item.sets,
                  bodyWeightKg,
                  item.weightKg,
                  item.reps,
                ),
                mode: mode as (typeof workoutModes)[number],
                rounds,
              };
            });
          if (items.length === 0) {
            return {
              content: "종목이 비어 있어 저장하지 않았습니다.",
              structuredContent: {
                saved: false,
                message: "종목이 비어 있어 저장하지 않았습니다.",
                date: day,
                burnedKcal: 0,
                volumeKg: 0,
              },
              isError: true,
            };
          }
          await insertWorkoutLogs(userId, day, items);
          const burnedKcal = items.reduce((sum, item) => sum + item.burnedKcal, 0);
          const volumeKg = Math.round(
            items.reduce(
              (sum, item) =>
                sum + workoutVolume(item.weightKg, item.reps, item.sets),
              0,
            ),
          );
          const overrideNote =
            overridden && mode !== recommendedMode
              ? ` 추천은 ${modeLabel[recommendedMode as WorkoutTimerMode]}였는데 ${modeLabel[mode]}로 바꿨습니다.`
              : "";
          const message = `${day} ${modeLabel[mode]} 운동 저장. ${items.length}종목, ${durationMin}분, 라운드/세트 ${rounds}, 소모 약 ${burnedKcal}kcal.${overrideNote}`;
          return {
            content: message,
            structuredContent: {
              saved: true,
              message,
              date: day,
              mode,
              recommendedMode,
              overridden,
              durationSec,
              rounds,
              count: items.length,
              burnedKcal,
              volumeKg,
            },
          };
        },
      )
      .registerTool(
        {
          name: "scan-food-barcode",
          description:
            "포장 식품의 바코드를 찍는 카드를 연다. 사용자가 바코드·포장지로 기록하겠다고 할 때 호출한다. 카드가 카메라나 바코드 사진으로 숫자를 읽고, lookup-barcode로 제품 영양 성분을 찾아 섭취량을 고친 뒤 저장한다. 바코드 숫자를 사진에서 직접 읽어 넣지 않는다. Claude에서 accountKey를 모르면 open-home을 intent barcode로 호출한다.",
          inputSchema: {
            meal: z
              .enum(mealSlots)
              .optional()
              .describe("breakfast, lunch, dinner, or snack. 생략하면 간식."),
            date: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Scan a food barcode",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening the barcode scanner…",
            "openai/toolInvocation/invoked": "Barcode scanner ready.",
          },
          view: {
            component: "scan-food-barcode",
            description: "Scan a packaged food barcode and log it",
          },
        },
        async ({ meal, date, accountKey }, extra) => ({
          content: [
            modelOnly(
              "바코드 카드를 열었습니다. 사용자가 스캔하고 저장할 때까지 기다리세요. 카메라가 막힌 화면에서는 카드가 바코드 사진이나 숫자 입력을 받습니다.",
            ),
          ],
          structuredContent: {
            meal: meal ?? ("snack" as const),
            date: date && date.length > 0 ? date : seoulToday(),
            accountKey: guestKey(await readyUserId(extra, accountKey)),
          },
        }),
      )
      .registerTool(
        {
          name: "lookup-barcode",
          description:
            "바코드 숫자로 포장 식품의 100g당 칼로리와 탄단지를 찾는다. 바코드 카드가 호출하거나, 사용자가 바코드 숫자를 직접 적었을 때 호출한다. 제품은 Open Food Facts에서 찾고, 거기에 열량이 없으면 제품 이름으로 식품영양성분 데이터베이스를 찾는다. 결과의 source를 사용자에게 함께 밝힌다. 찾지 못하면 수치를 지어내지 않는다.",
          inputSchema: {
            barcode: z.string().describe("바코드 숫자 8~14자리"),
          },
          annotations: {
            title: "Look up a barcode",
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: true,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Looking up the barcode…",
            "openai/toolInvocation/invoked": "Barcode lookup done.",
          },
        },
        async ({ barcode }) => {
          const product = await lookupBarcode(await getDb(), barcode);
          return {
            content: product.found
              ? `${product.productName} 100g당 ${product.kcalPer100}kcal, 탄 ${product.carbPer100}g, 단 ${product.proteinPer100}g, 지 ${product.fatPer100}g. 출처: ${product.source.ko}`
              : product.message,
            structuredContent: product,
          };
        },
      ),
});

mountAuthRoutes(app);

export type AppType = typeof app;
