/**
 * Turns InBody numbers + an optional want-to-be body goal into a workout plan:
 * phase (1–3), timer mode, per-exercise %1RM/reps/weight, method + why copy.
 */

import {
  bodyGoalLabel,
  findBodyGoal,
  type TargetBodyType,
} from "./body-goals.js";
import { cidShape, type BodyShape, type Sex } from "./cid.js";
import { resolveDailyEnergyPlan } from "./goals.js";
import {
  calculateWorkingWeight,
  inferLiftCategory,
  type LiftCategory,
} from "./strength-calculator.js";
import { estimateBurnedKcal } from "./workout.js";
import {
  assignTodaySession,
  fillSessionSlots,
  sessionTrains,
  type MissingSlot,
  type TodaySession,
} from "./workout-schedule.js";

export const workoutTimerModes = [
  "rest_timer",
  "emom",
  "amrap",
  "stopwatch",
] as const;

export type WorkoutTimerMode = (typeof workoutTimerModes)[number];
export type WorkoutPhase = 1 | 2 | 3;

export type MuscleRegion =
  | "upperLeft"
  | "upperRight"
  | "core"
  | "lowerLeft"
  | "lowerRight";

export type ExerciseRow = {
  slug: string;
  nameKo: string;
  kind: "strength" | "cardio";
  laterality: "unilateral" | "bilateral";
  region: "upper" | "core" | "lower" | "full";
  isolation: number;
  cue: string;
};

/** A course item with prescription, form cue, and coach rationale. */
export type PlannedExercise = ExerciseRow & {
  required: boolean;
  /** How to perform the move (from catalog cue + laterality rules). */
  method: string;
  /** Why this move / load / order was chosen for this user. */
  why: string;
  sets: number;
  reps: number;
  targetRir: number;
  pct1RmMin: number;
  pct1RmMax: number;
  restSec: number;
  /** Suggested working weight; 0 when no e1RM yet (use weight finder). */
  workingWeightKg: number;
  estimated1RmKg: number;
  liftCategory: LiftCategory;
  /** Phase 1 asymmetry: start on the weaker limb. */
  startWeakerSide: "left" | "right" | null;
  substitutedFor?: string;
  /** Estimated burn for this item (MET). */
  burnedKcal?: number;
  /** Cardio bout length in minutes when kind is cardio. */
  durationMin?: number;
};

export type SessionPrescription = {
  mode: WorkoutTimerMode;
  sets: number;
  reps: number;
  targetRir: number;
  pct1RmMin: number;
  pct1RmMax: number;
  restSec: number;
  limitSec: number;
  roundSec: number;
  /** Mid-band %1RM / 100 for legacy intensity UI (0.4–1.0). */
  intensityFactor: number;
  bandLabel: string;
};

export const injuredPartIds = [
  "shoulder",
  "wrist",
  "elbow",
  "low_back",
  "knee",
  "ankle",
  "neck",
] as const;

export type InjuredPart = (typeof injuredPartIds)[number];

export const injuredPartLabel: Record<InjuredPart, string> = {
  shoulder: "어깨",
  wrist: "손목",
  elbow: "팔꿈치",
  low_back: "허리",
  knee: "무릎",
  ankle: "발목",
  neck: "목",
};

/** Slug/name patterns that load a joint — excluded when that part is injured. */
const INJURY_EXCLUDE: Record<InjuredPart, RegExp> = {
  knee: /squat|스쿼트|lunge|런지|leg.?extension|익스텐션|step.?up|스텝업|jump|점핑/,
  low_back: /deadlift|데드|squat|스쿼트|bent.?over|바벨.?로우|rdl/,
  shoulder: /overhead|숄더|press|프레스|push.?up|푸시업|lateral.?raise|레터럴/,
  wrist: /push.?up|푸시업|press|프레스/,
  elbow: /press|프레스|extension|익스텐|push.?up|푸시업/,
  ankle: /jump|점핑|step.?up|스텝업|squat|스쿼트/,
  neck: /overhead|숄더|press|프레스/,
};

/** Safer substitutes keyed by injured part (slugs that stay allowed). */
const INJURY_SAFE: Record<InjuredPart, RegExp> = {
  knee: /hip|bridge|브릿지|leg.?curl|레그컬|plank|플랭크/,
  low_back: /row|로우|pulldown|랫|plank|플랭크|bird|dead.?bug|레그컬|cable.?fly|플라이/,
  shoulder: /fly|플라이|row|로우|leg|스쿼트|curl|컬|plank|플랭크/,
  wrist: /fly|플라이|leg|스쿼트|plank|플랭크|row|로우/,
  elbow: /fly|플라이|leg|스쿼트|plank|플랭크|row|로우/,
  ankle: /row|로우|press|프레스|plank|플랭크|fly|플라이|curl|컬/,
  neck: /row|로우|squat|스쿼트|leg|플랭크|fly|플라이/,
};

/**
 * A problem in how the body is built (not how much fat or muscle it has).
 * Its exercises go into the course whatever the phase or body goal.
 */
export type StructuralIssue = {
  id: "upper-asymmetry" | "lower-asymmetry";
  title: string;
  detail: string;
  exercises: string[];
};

export type InbodySnapshot = {
  heightCm: number;
  sex: Sex;
  weightKg: number;
  skeletalMuscleKg: number;
  bodyFatKg: number;
  bodyFatPercent: number;
  muscleUpperLeftKg: number;
  muscleUpperRightKg: number;
  muscleCoreKg: number;
  muscleLowerLeftKg: number;
  muscleLowerRightKg: number;
  /** ECW/TBW ratio when known (InBody). >0.390 → recover-only gate. */
  ecwRatio?: number | null;
  /** Visceral fat level when known. ≥10 with C-shape avoids HIIT day-1. */
  visceralFatLevel?: number | null;
};

export const trainingVenues = ["gym", "home"] as const;
export type TrainingVenue = (typeof trainingVenues)[number];

export const sessionFoci = ["full", "upper", "lower"] as const;
export type SessionFocus = (typeof sessionFoci)[number];

/** Gear the user can mark as available at home. bodyweight is always implied. */
export const homeEquipmentIds = [
  "bodyweight",
  "dumbbell",
  "kettlebell",
  "band",
  "pullup_bar",
  "bench",
] as const;
export type HomeEquipment = (typeof homeEquipmentIds)[number];

export const trainingVenueLabel: Record<TrainingVenue, string> = {
  gym: "헬스장",
  home: "홈트레이닝",
};

export const sessionFocusLabel: Record<SessionFocus, string> = {
  full: "전신",
  upper: "상체",
  lower: "하체",
};

export const homeEquipmentLabel: Record<HomeEquipment, string> = {
  bodyweight: "맨몸",
  dumbbell: "덤벨",
  kettlebell: "케틀벨",
  band: "밴드",
  pullup_bar: "철봉",
  bench: "벤치·의자·스텝",
};

export type AnalyzeWorkoutOptions = {
  targetBodyType?: TargetBodyType | null;
  injuredParts?: InjuredPart[];
  /** Map of exercise nameKo or slug → estimated 1RM kg from history. */
  e1RmByExercise?: Record<string, number>;
  /** Gym machines/cables vs home bodyweight·덤벨. Default gym. */
  trainingVenue?: TrainingVenue;
  /** YYYY-MM-DD. The trainer assigns today's part from this date. */
  date?: string;
  /** Exercise names from the previous training day, so the same stimulus is not repeated. */
  recentExerciseNames?: string[];
  /** Home gear the user said they have. Ignored for gym. */
  homeEquipment?: HomeEquipment[];
  /** Deadline days for body-goal calorie targeting. */
  targetDays?: number | null;
};

/** Cable/machine/barbell moves need a gym; bodyweight is home-first; dumpbells both. */
export function venueOf(item: Pick<ExerciseRow, "slug" | "nameKo">): "gym" | "home" | "both" {
  const text = `${item.slug} ${item.nameKo}`;
  if (
    /cable|케이블|leg.?curl|leg.?extension|익스텐|deadlift|데드|machine|랫|pulldown|바벨/.test(
      text,
    )
  ) {
    return "gym";
  }
  if (
    /push.?up|푸시업|plank|플랭크|jump|점핑|mountain|마운틴|inverted|인버티드|bridge|브릿지|bird|dead.?bug|풀업|chin|행잉|밴드|band|goblet|힙.?쓰러스트|bulgarian|불가리안/.test(
      text,
    )
  ) {
    return "home";
  }
  return "both";
}

/** Minimum gear needed for a move when training at home. */
export function homeEquipmentNeeded(
  item: Pick<ExerciseRow, "slug" | "nameKo">,
): HomeEquipment {
  const text = `${item.slug} ${item.nameKo}`;
  if (/cable|케이블|leg.?curl|leg.?extension|익스텐|deadlift|데드|machine|랫|pulldown|바벨/.test(text)) {
    // Gym-only; never selected for home after venue filter.
    return "dumbbell";
  }
  if (/band|밴드/.test(text)) return "band";
  if (/kettle|케틀|swing|스윙/.test(text)) return "kettlebell";
  if (/pull.?up|chin|풀업|chin|행잉|inverted|인버티드/.test(text)) {
    return "pullup_bar";
  }
  if (
    /step.?up|스텝|bulgarian|불가리안|hip.?thrust|힙.?쓰러스트|벤치/.test(text)
  ) {
    return "bench";
  }
  if (/db-|덤벨|dumbbell|goblet|고블릿|lateral.?raise|레터럴/.test(text)) {
    return "dumbbell";
  }
  return "bodyweight";
}

/** Push-ups, planks, bands, pull-ups: no kg — find reps instead of weight. */
export function isBodyweightExercise(
  item: Pick<ExerciseRow, "slug" | "nameKo">,
): boolean {
  const gear = homeEquipmentNeeded(item);
  return (
    gear === "bodyweight" ||
    gear === "pullup_bar" ||
    gear === "band" ||
    gear === "bench"
  );
}

export function normalizeHomeEquipment(
  selected: HomeEquipment[] | undefined,
): HomeEquipment[] {
  const set = new Set<HomeEquipment>(["bodyweight"]);
  for (const item of selected ?? []) {
    if ((homeEquipmentIds as readonly string[]).includes(item)) {
      set.add(item);
    }
  }
  return homeEquipmentIds.filter((id) => set.has(id));
}

export function filterCatalogByVenue(
  catalog: ExerciseRow[],
  venue: TrainingVenue,
  homeEquipment?: HomeEquipment[],
): ExerciseRow[] {
  if (venue === "gym") return catalog;
  const gear = new Set(normalizeHomeEquipment(homeEquipment));
  const home = catalog.filter((item) => {
    const place = venueOf(item);
    if (place === "gym") return false;
    return gear.has(homeEquipmentNeeded(item));
  });
  if (home.length >= 3) return home;
  // Last resort: bodyweight-only pool so the card is never empty.
  return catalog.filter(
    (item) =>
      venueOf(item) !== "gym" && homeEquipmentNeeded(item) === "bodyweight",
  );
}

const REGION_LABEL: Record<MuscleRegion, string> = {
  upperLeft: "상체 좌",
  upperRight: "상체 우",
  core: "코어",
  lowerLeft: "하체 좌",
  lowerRight: "하체 우",
};

const IMBALANCE_PCT = 0.05;
const IMBALANCE_KG = 0.25;

export const modeLabel: Record<WorkoutTimerMode, string> = {
  rest_timer: "세트별 휴식",
  emom: "EMOM",
  amrap: "AMRAP",
  stopwatch: "스톱워치",
};

export const phaseLabel: Record<WorkoutPhase, string> = {
  1: "Phase 1 · 비대칭 교정 & 기초",
  2: "Phase 2 · 체성분 베이스캠프",
  3: "Phase 3 · 워너비 체형 디테일",
};

export const modeDefaults: Record<
  WorkoutTimerMode,
  {
    restSec: number;
    roundSec: number;
    limitSec: number;
    sets: number;
    reps: number;
  }
> = {
  rest_timer: { restSec: 75, roundSec: 60, limitSec: 0, sets: 3, reps: 10 },
  emom: { restSec: 0, roundSec: 60, limitSec: 12 * 60, sets: 12, reps: 8 },
  amrap: { restSec: 0, roundSec: 0, limitSec: 12 * 60, sets: 0, reps: 0 },
  stopwatch: { restSec: 0, roundSec: 0, limitSec: 0, sets: 3, reps: 10 },
};

function asymmetry(
  left: number,
  right: number,
): { gapKg: number; gapPct: number; weaker: "left" | "right" | null } {
  const gapKg = Math.abs(left - right);
  const base = Math.max(left, right, 0.01);
  const gapPct = gapKg / base;
  if (gapKg < IMBALANCE_KG && gapPct < IMBALANCE_PCT) {
    return { gapKg: 0, gapPct: 0, weaker: null };
  }
  return {
    gapKg: Math.round(gapKg * 100) / 100,
    gapPct: Math.round(gapPct * 1000) / 10,
    weaker: left <= right ? "left" : "right",
  };
}

export function regionValues(input: InbodySnapshot) {
  return [
    { key: "upperLeft" as const, kg: input.muscleUpperLeftKg },
    { key: "upperRight" as const, kg: input.muscleUpperRightKg },
    { key: "core" as const, kg: input.muscleCoreKg },
    { key: "lowerLeft" as const, kg: input.muscleLowerLeftKg },
    { key: "lowerRight" as const, kg: input.muscleLowerRightKg },
  ];
}

export function weakRegions(input: InbodySnapshot): MuscleRegion[] {
  const values = regionValues(input).filter((item) => item.kg > 0);
  if (values.length === 0) return [];
  const mean = values.reduce((sum, item) => sum + item.kg, 0) / values.length;
  return values
    .filter((item) => item.kg < mean * 0.95)
    .sort((a, b) => a.kg - b.kg)
    .map((item) => item.key);
}

type Asymmetry = ReturnType<typeof asymmetry>;

/** Two one-sided compound moves for the uneven half of the body. */
function correctiveExercises(
  catalog: ExerciseRow[],
  region: "upper" | "lower",
): ExerciseRow[] {
  return catalog
    .filter(
      (item) =>
        item.kind === "strength" &&
        item.laterality === "unilateral" &&
        item.region === region &&
        !item.isolation,
    )
    .sort((a, b) => a.nameKo.localeCompare(b.nameKo))
    .slice(0, 2);
}

function asymmetryIssue(
  region: "upper" | "lower",
  gap: Asymmetry,
  rows: ExerciseRow[],
): StructuralIssue | null {
  if (!gap.weaker) return null;
  const part = region === "upper" ? "상체" : "하체";
  const weak = gap.weaker === "left" ? "왼쪽" : "오른쪽";
  const strong = gap.weaker === "left" ? "오른쪽" : "왼쪽";
  const names = rows.map((item) => item.nameKo);
  const risk =
    region === "upper" ? "어깨·허리 부담이" : "골반·무릎 부담이";
  const plan =
    names.length > 0
      ? `어떤 목표 체형을 골라도 ${names.join(", ")}를 약한 쪽부터 같은 횟수로 합니다.`
      : "어떤 목표 체형을 골라도 한쪽씩 하는 운동을 약한 쪽부터 같은 횟수로 합니다.";
  return {
    id: region === "upper" ? "upper-asymmetry" : "lower-asymmetry",
    title: `${part} 좌우 비대칭`,
    detail: `${part} 근육량이 ${weak}이 ${strong}보다 ${gap.gapKg}kg(${gap.gapPct}%) 적습니다. 체중·체지방(BMI)과 상관없는 구조 문제라서, 그대로 중량을 올리면 강한 쪽이 대신 힘을 써 격차와 ${risk} 커집니다. ${plan}`,
    exercises: names,
  };
}

function regionBucket(region: MuscleRegion): "upper" | "core" | "lower" {
  if (region.startsWith("upper")) return "upper";
  if (region.startsWith("lower")) return "lower";
  return "core";
}

function hitsInjury(item: ExerciseRow, parts: InjuredPart[]): InjuredPart | null {
  const text = `${item.slug} ${item.nameKo}`;
  for (const part of parts) {
    if (INJURY_EXCLUDE[part].test(text) && !INJURY_SAFE[part].test(text)) {
      return part;
    }
  }
  return null;
}

function filterCatalogForInjuries(
  catalog: ExerciseRow[],
  injured: InjuredPart[],
): { safe: ExerciseRow[]; excluded: Array<{ nameKo: string; part: InjuredPart }> } {
  if (injured.length === 0) return { safe: catalog, excluded: [] };
  const excluded: Array<{ nameKo: string; part: InjuredPart }> = [];
  const safe: ExerciseRow[] = [];
  for (const item of catalog) {
    const part = hitsInjury(item, injured);
    if (part) excluded.push({ nameKo: item.nameKo, part });
    else safe.push(item);
  }
  return { safe, excluded };
}

function buildPrescription(input: {
  phase: WorkoutPhase;
  shape: BodyShape;
  isImbalanced: boolean;
  goalId: TargetBodyType | null | undefined;
  recoverOnly: boolean;
  avoidHiit: boolean;
}): SessionPrescription {
  if (input.recoverOnly) {
    return {
      mode: "stopwatch",
      sets: 2,
      reps: 12,
      targetRir: 4,
      pct1RmMin: 30,
      pct1RmMax: 40,
      restSec: 90,
      limitSec: 0,
      roundSec: 0,
      intensityFactor: 0.35,
      bandLabel: "회복·저강도 (ECW 위험)",
    };
  }
  if (input.isImbalanced || input.phase === 1) {
    return {
      mode: "rest_timer",
      sets: 3,
      reps: 14,
      targetRir: 2,
      pct1RmMin: 40,
      pct1RmMax: 60,
      restSec: 90,
      limitSec: 0,
      roundSec: 60,
      intensityFactor: 0.5,
      bandLabel: "비대칭 교정 40~60%1RM · 12~15회",
    };
  }
  if (input.avoidHiit || (input.shape === "C" && input.phase <= 2)) {
    if (input.avoidHiit) {
      return {
        mode: "rest_timer",
        sets: 3,
        reps: 14,
        targetRir: 3,
        pct1RmMin: 40,
        pct1RmMax: 55,
        restSec: 90,
        limitSec: 0,
        roundSec: 60,
        intensityFactor: 0.45,
        bandLabel: "내장지방 보호 · LISS+기초 저항 (HIIT 유예)",
      };
    }
    return {
      mode: "amrap",
      sets: 0,
      reps: 14,
      targetRir: 2,
      pct1RmMin: 40,
      pct1RmMax: 60,
      restSec: 0,
      limitSec: 12 * 60,
      roundSec: 0,
      intensityFactor: 0.5,
      bandLabel: "커팅 40~60%1RM · 12~15회 · AMRAP 12분 순환",
    };
  }
  if (input.goalId === "power" && input.phase === 3) {
    return {
      mode: "rest_timer",
      sets: 4,
      reps: 3,
      targetRir: 2,
      pct1RmMin: 80,
      pct1RmMax: 95,
      restSec: 240,
      limitSec: 0,
      roundSec: 60,
      intensityFactor: 0.88,
      bandLabel: "스트렝스 80~100%1RM · 1~5회",
    };
  }
  if (input.shape === "D" || input.phase === 3) {
    const isolationRest = input.goalId === "upper" || input.goalId === "lower";
    return {
      mode:
        input.shape === "I" && input.phase === 2
          ? "emom"
          : input.goalId === "slim"
            ? "emom"
            : "rest_timer",
      sets: 4,
      reps: 10,
      targetRir: 2,
      pct1RmMin: 60,
      pct1RmMax: 80,
      restSec: isolationRest ? 90 : 150,
      limitSec: input.goalId === "slim" || input.shape === "I" ? 12 * 60 : 0,
      roundSec: 60,
      intensityFactor: 0.7,
      bandLabel: "근비대 60~80%1RM · 8~12회 @ RIR 1~2",
    };
  }
  return {
    mode: "emom",
    sets: 12,
    reps: 10,
    targetRir: 2,
    pct1RmMin: 60,
    pct1RmMax: 75,
    restSec: 0,
    limitSec: 12 * 60,
    roundSec: 60,
    intensityFactor: 0.68,
    bandLabel: "베이스 60~75%1RM · EMOM",
  };
}

function enrichExercise(input: {
  item: ExerciseRow;
  required: boolean;
  prescription: SessionPrescription;
  phase: WorkoutPhase;
  isImbalanced: boolean;
  weakerSide: "left" | "right" | null;
  weakLabels: string[];
  targetBodyLabel: string;
  shape: BodyShape;
  e1RmByExercise: Record<string, number>;
  substitutedFor?: string;
  sets?: number;
}): PlannedExercise {
  const { item, prescription: rx } = input;
  const category = inferLiftCategory(item.slug, item.nameKo);
  const e1Rm =
    input.e1RmByExercise[item.slug] ??
    input.e1RmByExercise[item.nameKo] ??
    0;
  const isolation = Boolean(item.isolation);
  const restSec =
    rx.mode === "rest_timer"
      ? isolation
        ? Math.min(rx.restSec, 120)
        : Math.max(rx.restSec, 120)
      : rx.restSec;
  const workingWeightKg =
    e1Rm > 0
      ? calculateWorkingWeight({
          e1RmKg: e1Rm,
          targetReps: Math.max(1, rx.reps),
          targetRir: rx.targetRir,
          category,
          isolation,
        })
      : 0;

  const startWeakerSide =
    input.isImbalanced && item.laterality === "unilateral"
      ? input.weakerSide
      : null;

  const methodParts = [
    item.cue || "바른 자세로 통제된 속도로 수행하세요.",
    startWeakerSide
      ? `약한 ${startWeakerSide === "left" ? "왼쪽" : "오른쪽"}부터 시작하고, 강한 쪽은 같은 횟수만 하세요.`
      : item.laterality === "unilateral"
        ? "한쪽씩 같은 횟수로 맞추세요."
        : "",
    workingWeightKg > 0
      ? `목표 ${workingWeightKg}kg × ${rx.reps}회 (추정 1RM ${e1Rm}kg의 약 ${Math.round(((rx.pct1RmMin + rx.pct1RmMax) / 2) * 10) / 10}% 대역, 종료 시 RIR ${rx.targetRir}).`
      : `첫 세트는 편하게 ${rx.reps}회 들 수 있는 무게(또는 맨몸)로 시작하고, 끝난 뒤 여유 반복(RIR)을 골라 다음 세트 무게를 맞추세요.`,
  ].filter(Boolean);

  const whyParts: string[] = [];
  if (input.required) {
    whyParts.push(
      "좌우 근육량 차이가 구조 문제라서, 목표 체형과 상관없이 약한 쪽 교정 운동을 코스 맨 앞에 넣었습니다.",
    );
  } else if (input.weakLabels.length > 0 && item.region !== "full") {
    whyParts.push(
      `인바디상 상대적으로 약한 부위(${input.weakLabels.join(", ")})를 우선 배치하는 Priority Principle을 따릅니다.`,
    );
  }
  if (input.targetBodyLabel) {
    whyParts.push(
      `'${input.targetBodyLabel}' 목표에 맞춰 ${isolation ? "고립" : "다관절 복합"} 위주로 골랐습니다.`,
    );
  }
  whyParts.push(
    `${input.shape}자형 · Phase ${input.phase} 처방: ${rx.bandLabel}.`,
  );
  if (input.substitutedFor) {
    whyParts.push(input.substitutedFor);
  }

  return {
    ...item,
    required: input.required,
    method: methodParts.join(" "),
    why: whyParts.join(" "),
    sets: rx.mode === "amrap" ? 0 : (input.sets ?? rx.sets),
    reps: rx.reps,
    targetRir: rx.targetRir,
    pct1RmMin: rx.pct1RmMin,
    pct1RmMax: rx.pct1RmMax,
    restSec,
    workingWeightKg,
    estimated1RmKg: e1Rm,
    liftCategory: category,
    startWeakerSide,
    substitutedFor: input.substitutedFor,
  };
}

/** Build timer payload from a session prescription (preferred) or legacy intensity. */
export function scaleTimer(
  mode: WorkoutTimerMode,
  intensityOrRx: number | SessionPrescription,
): (typeof modeDefaults)[WorkoutTimerMode] {
  if (typeof intensityOrRx === "object") {
    const rx = intensityOrRx;
    return {
      restSec: rx.restSec,
      roundSec: rx.roundSec || modeDefaults[mode].roundSec,
      limitSec: rx.limitSec,
      sets: rx.sets,
      reps: rx.reps,
    };
  }
  const base = modeDefaults[mode];
  const factor = Math.min(1.3, Math.max(0.7, intensityOrRx));
  return {
    restSec: Math.round(base.restSec / factor),
    roundSec: base.roundSec,
    limitSec: Math.round(
      base.limitSec * (mode === "amrap" ? factor : 1),
    ),
    sets: Math.max(mode === "amrap" ? 0 : 1, Math.round(base.sets * factor)),
    reps: Math.max(1, Math.round(base.reps * factor)),
  };
}

export function analyzeInbodyWorkout(
  input: InbodySnapshot,
  catalog: ExerciseRow[],
  targetBodyTypeOrOpts?: TargetBodyType | null | AnalyzeWorkoutOptions,
) {
  const opts: AnalyzeWorkoutOptions =
    targetBodyTypeOrOpts &&
    typeof targetBodyTypeOrOpts === "object" &&
    !Array.isArray(targetBodyTypeOrOpts) &&
    ("injuredParts" in targetBodyTypeOrOpts ||
      "e1RmByExercise" in targetBodyTypeOrOpts ||
      "targetBodyType" in targetBodyTypeOrOpts ||
      "trainingVenue" in targetBodyTypeOrOpts ||
      "date" in targetBodyTypeOrOpts ||
      "recentExerciseNames" in targetBodyTypeOrOpts ||
      "targetDays" in targetBodyTypeOrOpts ||
      "homeEquipment" in targetBodyTypeOrOpts)
      ? targetBodyTypeOrOpts
      : { targetBodyType: targetBodyTypeOrOpts as TargetBodyType | null };

  const trainingVenue: TrainingVenue =
    opts.trainingVenue === "home" ? "home" : "gym";
  const homeEquipment =
    trainingVenue === "home"
      ? normalizeHomeEquipment(opts.homeEquipment)
      : ([] as HomeEquipment[]);

  const injured = (opts.injuredParts ?? []).filter((p): p is InjuredPart =>
    (injuredPartIds as readonly string[]).includes(p),
  );
  const e1RmByExercise = opts.e1RmByExercise ?? {};
  const venueCatalog = filterCatalogByVenue(
    catalog,
    trainingVenue,
    homeEquipment,
  );
  const { safe: filteredCatalog, excluded } = filterCatalogForInjuries(
    venueCatalog,
    injured,
  );

  const upper = asymmetry(input.muscleUpperLeftKg, input.muscleUpperRightKg);
  const lower = asymmetry(input.muscleLowerLeftKg, input.muscleLowerRightKg);
  const isImbalanced = upper.weaker !== null || lower.weaker !== null;

  const hasCid =
    input.heightCm > 0 &&
    (input.sex === "male" || input.sex === "female") &&
    input.weightKg > 0;
  const cid = hasCid
    ? cidShape({
        heightCm: input.heightCm,
        sex: input.sex,
        weightKg: input.weightKg,
        skeletalMuscleKg: input.skeletalMuscleKg,
        bodyFatKg: input.bodyFatKg,
      })
    : null;
  const shape: BodyShape = cid?.shape ?? "I";
  const weak = weakRegions(input);
  const goal = findBodyGoal(opts.targetBodyType);
  const compositionGap =
    cid !== null &&
    (Math.abs((cid.rows[1]?.percent ?? 100) - 100) > 12 ||
      Math.abs((cid.rows[2]?.percent ?? 100) - 100) > 12);

  const ecw = input.ecwRatio ?? null;
  const vfl = input.visceralFatLevel ?? null;
  const recoverOnly = ecw != null && ecw > 0.39;
  const ecwCaution = ecw != null && ecw > 0.38 && ecw <= 0.39;
  const avoidHiit = shape === "C" && vfl != null && vfl >= 10;

  let phase: WorkoutPhase;
  if (isImbalanced || (cid?.rows[1]?.percent ?? 100) < 85) {
    phase = 1;
  } else if (compositionGap || !goal) {
    phase = 2;
  } else {
    phase = 3;
  }

  const schedule: TodaySession = assignTodaySession({
    date: opts.date ?? "",
    phase,
    upperLeftKg: input.muscleUpperLeftKg,
    upperRightKg: input.muscleUpperRightKg,
    lowerLeftKg: input.muscleLowerLeftKg,
    lowerRightKg: input.muscleLowerRightKg,
    targetBodyType: goal?.id ?? null,
    recentExerciseNames: opts.recentExerciseNames,
  });
  const trained = sessionTrains(schedule.kind);
  const sessionFocus: SessionFocus = trained.upper && trained.lower
    ? "full"
    : trained.lower
      ? "lower"
      : "upper";

  const pool =
    filteredCatalog.length > 0
      ? filteredCatalog
      : venueCatalog.length > 0
        ? venueCatalog
        : catalog;
  const upperFix =
    upper.weaker && trained.upper
      ? correctiveExercises(pool, "upper")
      : [];
  const lowerFix =
    lower.weaker && trained.lower
      ? correctiveExercises(pool, "lower")
      : [];
  const structuralIssues = [
    trained.upper ? asymmetryIssue("upper", upper, upperFix) : null,
    trained.lower ? asymmetryIssue("lower", lower, lowerFix) : null,
  ].filter((item): item is StructuralIssue => item !== null);
  const required = [...upperFix, ...lowerFix];
  const deferredAsymmetry: string[] = [];
  if (!trained.lower && lower.weaker) {
    deferredAsymmetry.push(
      `하체 좌우 비대칭(${lower.gapKg}kg)은 하체 날에 넣습니다. 오늘은 ${schedule.label}입니다.`,
    );
  }
  if (!trained.upper && upper.weaker) {
    deferredAsymmetry.push(
      `상체 좌우 비대칭(${upper.gapKg}kg)은 상체 날에 넣습니다. 오늘은 ${schedule.label}입니다.`,
    );
  }

  const prescription = buildPrescription({
    phase,
    shape,
    isImbalanced,
    goalId: goal?.id,
    recoverOnly,
    avoidHiit,
  });

  const lead =
    weak.length > 0 ? regionBucket(weak[0]!) : null;
  const amrapCircuit = prescription.mode === "amrap";
  // Doc: VFL≥10 + C → LISS + basic multi-joint only (not a 5~7 isolation day).
  const baseMjCircuit = avoidHiit && !amrapCircuit;
  const compoundCircuit = amrapCircuit || baseMjCircuit;
  const { filled, missing } = fillSessionSlots({
    kind: schedule.kind,
    catalog: pool,
    preferUnilateral: phase === 1 || isImbalanced,
    leadRegion: lead,
    // Tight 3-move MJ circuit — don't pre-consume slots with asymmetry fixes.
    usedSlugs: compoundCircuit ? [] : required.map((item) => item.slug),
    compoundCircuit,
    amrapCircuit,
  });
  const missingSlots: MissingSlot[] = missing.map((slot) =>
    injured.length === 0
      ? slot
      : {
          ...slot,
          hint: `${slot.hint} 불편 부위(${injured.map((part) => injuredPartLabel[part]).join(", ")})는 피하세요.`,
        },
  );

  const weakLabels = weak.map((key) => REGION_LABEL[key]);
  const weakerSide = upper.weaker ?? lower.weaker;
  const injuryNote =
    injured.length > 0
      ? `불편 부위(${injured.map((p) => injuredPartLabel[p]).join(", ")})를 자극하는 종목은 빼고, 같은 목표 근육을 안전한 궤적으로 대체했습니다.`
      : undefined;

  const exercises: PlannedExercise[] = [
    ...(compoundCircuit
      ? []
      : required.map((item) =>
          enrichExercise({
            item,
            required: true,
            prescription,
            phase,
            isImbalanced,
            weakerSide,
            weakLabels,
            targetBodyLabel: goal ? bodyGoalLabel[goal.id] : "",
            shape,
            e1RmByExercise,
          }),
        )),
    ...filled.map((slot) =>
      enrichExercise({
        item: slot.item,
        required: false,
        prescription,
        phase,
        isImbalanced,
        weakerSide,
        weakLabels,
        targetBodyLabel: goal ? bodyGoalLabel[goal.id] : "",
        shape,
        e1RmByExercise,
        substitutedFor: injuryNote,
        sets: slot.sets,
      }),
    ),
  ];
  if (amrapCircuit) {
    for (const item of exercises) {
      item.why = `${item.why} AMRAP 전신 순환 코스(다관절 3개·맨몸/가벼운 무게·중고반복·12분)로 묶었습니다.`;
    }
  } else if (baseMjCircuit) {
    for (const item of exercises) {
      item.why = `${item.why} 내장지방 보호일: 기초 다관절 3종만 두고 고립·HIIT는 빼 두었습니다.`;
    }
  }

  const energy = resolveDailyEnergyPlan({
    weightKg: input.weightKg,
    bodyFatKg: input.bodyFatKg,
    heightCm: input.heightCm,
    sex: input.sex,
    targetBodyType: goal?.id ?? null,
    targetDays: opts.targetDays ?? null,
    goalKcal: null,
    goalCarbG: null,
    goalProteinG: null,
    goalFatG: null,
    goalBurnKcal: null,
  });
  const weightForBurn = input.weightKg > 0 ? input.weightKg : 70;
  let strengthBurn = 0;
  for (const item of exercises) {
    const sets = item.sets > 0 ? item.sets : 3;
    const burned = estimateBurnedKcal("strength", 0, sets, weightForBurn);
    item.burnedKcal = burned;
    strengthBurn += burned;
  }
  const targetBurn = energy.targetExerciseKcal;
  let cardioBurn = 0;
  let cardioMinutes = 0;
  // AMRAP circuit is the calorie bout. VFL-protect days always get LISS walking.
  // Other days append cardio only to close the burn gap.
  const needLiss = !recoverOnly && baseMjCircuit;
  const needGapCardio =
    !recoverOnly && !amrapCircuit && !baseMjCircuit && targetBurn > strengthBurn;
  if (needLiss || needGapCardio) {
    const gap = Math.max(0, targetBurn - strengthBurn);
    cardioMinutes = needLiss
      ? Math.max(15, Math.min(30, gap > 0 ? Math.ceil((gap * 60) / (7 * weightForBurn)) : 20))
      : Math.max(
          8,
          Math.min(45, Math.ceil((gap * 60) / (7 * weightForBurn))),
        );
    cardioBurn = estimateBurnedKcal("cardio", cardioMinutes, 0, weightForBurn);
    const cardioPick =
      pool.find(
        (item) =>
          item.kind === "cardio" &&
          !exercises.some((row) => row.slug === item.slug),
      ) ??
      ({
        slug: "brisk-cardio",
        nameKo: needLiss ? "빠른 걷기(LISS)" : "점핑잭·마운틴 클라이머",
        kind: "cardio" as const,
        laterality: "bilateral" as const,
        region: "full" as const,
        isolation: 0,
        cue: needLiss
          ? "숨이 살짝 찰 정도로 빠르게 걷습니다. HIIT는 오늘 넣지 않습니다."
          : "바른 자세로 리듬을 유지하세요.",
      } satisfies ExerciseRow);
    exercises.push({
      ...cardioPick,
      required: false,
      method: `${cardioPick.cue} 약 ${cardioMinutes}분 · 목표 소모 약 ${cardioBurn}kcal.`,
      why: needLiss
        ? `내장지방 보호(VFL≥10): 기초 다관절 뒤에 저강도 지속(LISS) ${cardioMinutes}분을 붙입니다.`
        : `오늘 목표 운동 소모 ${targetBurn}kcal 중 근력으로 약 ${strengthBurn}kcal입니다. 남은 ${gap}kcal는 유산소로 채웁니다.`,
      sets: 0,
      reps: cardioMinutes,
      targetRir: 2,
      pct1RmMin: 0,
      pct1RmMax: 0,
      restSec: 0,
      workingWeightKg: 0,
      estimated1RmKg: 0,
      liftCategory: "lower_compound",
      startWeakerSide: null,
      burnedKcal: cardioBurn,
      durationMin: cardioMinutes,
    });
  }

  const targetLabels =
    phase === 3 && goal
      ? goal.preferRegions
          .filter((r) => r !== "full")
          .map((r) =>
            r === "upper" ? "상체" : r === "lower" ? "하체" : "코어",
          )
      : weakLabels.length > 0
        ? [weakLabels[0]!]
        : [];

  const safetyNotes: string[] = [...deferredAsymmetry];
  if (trainingVenue === "home") {
    const gearText = homeEquipment
      .map((id) => homeEquipmentLabel[id])
      .join("·");
    safetyNotes.push(
      `홈트레이닝 코스입니다. 집에 있다고 고른 기구(${gearText})로만 짰습니다.`,
    );
  }
  if (recoverOnly) {
    safetyNotes.push(
      `세포외수분비(ECW/TBW) ${ecw}가 0.390을 넘어 고강도·고중량을 유예하고 회복·스트레칭을 우선합니다. 전문의 상담을 권합니다.`,
    );
  } else if (ecwCaution) {
    safetyNotes.push(
      `ECW/TBW ${ecw}는 경계 구간(0.380~0.390)이라 볼륨을 보수적으로 잡았습니다. 공복 2~4시간·직전 고강도 운동이 있으면 체수분 왜곡일 수 있습니다.`,
    );
  }
  if (avoidHiit) {
    safetyNotes.push(
      `내장지방레벨(VFL) ${vfl}≥10이라 첫날 HIIT/AMRAP 극단 인터벌을 피하고 기초 저항+저강도 지속을 우선합니다.`,
    );
  }
  if (excluded.length > 0) {
    safetyNotes.push(
      `부상 필터로 제외: ${excluded
        .slice(0, 6)
        .map((e) => `${e.nameKo}(${injuredPartLabel[e.part]})`)
        .join(", ")}.`,
    );
  }
  if (cardioMinutes > 0) {
    safetyNotes.push(
      `목표 운동 소모 ${targetBurn}kcal · 근력 약 ${strengthBurn}kcal · 유산소 ${cardioMinutes}분(약 ${cardioBurn}kcal).`,
    );
  } else if (targetBurn > 0) {
    safetyNotes.push(
      `목표 운동 소모 ${targetBurn}kcal · 근력 코스만으로 약 ${strengthBurn}kcal입니다.`,
    );
  }

  const reasonBits = [
    `${phaseLabel[phase]}. ${prescription.bandLabel}.`,
    isImbalanced
      ? `좌우 비대칭이라 편측+${modeLabel[prescription.mode]}, 약한 쪽부터 같은 횟수.`
      : `${shape}자형 기준 ${modeLabel[prescription.mode]}.`,
    weakLabels[0]
      ? `최우선 취약 부위 ${weakLabels[0]}을(를) 코스 앞에 둡니다.`
      : "",
    goal ? `워너비 '${bodyGoalLabel[goal.id]}'에 맞춰 종목을 골랐습니다.` : "",
    `${trainingVenueLabel[trainingVenue]} · ${schedule.weekdayLabel}요일 ${schedule.label} (${schedule.splitLabel}).`,
    schedule.weekHint,
    ...safetyNotes,
  ].filter(Boolean);

  const inbodyReasoning = [
    `Phase ${phase} / ${shape}자형 / ${prescription.bandLabel}`,
    `세트 ${prescription.sets || "AMRAP"} × ${prescription.reps}회 @ ${prescription.pct1RmMin}~${prescription.pct1RmMax}%1RM, RIR ${prescription.targetRir}, 휴식 ${prescription.restSec}초`,
    isImbalanced
      ? `비대칭: 상체 ${upper.gapKg}kg(${upper.gapPct}%), 하체 ${lower.gapKg}kg(${lower.gapPct}%)`
      : "좌우 균형 양호",
    weakLabels.length ? `취약: ${weakLabels.join(", ")}` : "",
    ...safetyNotes,
  ]
    .filter(Boolean)
    .join(" · ");

  const splitRecommended = false;
  const splitHint = schedule.weekHint;

  return {
    shape,
    phase,
    phaseLabel: phaseLabel[phase],
    isImbalanced,
    upper,
    lower,
    weakParts: weak,
    weakLabels,
    targetLabels,
    targetBodyType: (goal?.id ?? null) as TargetBodyType | null,
    targetBodyLabel: goal ? bodyGoalLabel[goal.id] : "",
    trainingVenue,
    sessionFocus,
    sessionKind: schedule.kind,
    sessionLabel: schedule.label,
    scheduleBias: schedule.bias,
    scheduleReason: schedule.reason,
    weekHint: schedule.weekHint,
    splitLabel: schedule.splitLabel,
    missingSlots,
    homeEquipment,
    splitRecommended,
    splitHint,
    recommendedMode: prescription.mode,
    recommendedIntensity: prescription.intensityFactor,
    prescription,
    reason: reasonBits.join(" "),
    inbodyReasoning,
    safetyNotes,
    injuredParts: injured,
    structuralIssues,
    exercises,
    timer: scaleTimer(prescription.mode, prescription),
    cidRows: cid?.rows ?? [],
    energy: {
      targetExerciseKcal: targetBurn,
      strengthBurnKcal: strengthBurn,
      cardioBurnKcal: cardioBurn,
      cardioMinutes,
      goalIntakeKcal: energy.goalIntakeKcal,
      bmrKcal: energy.bmrKcal,
    },
  };
}

export function persuasionCopy(input: {
  recommendedMode: WorkoutTimerMode;
  requestedMode: WorkoutTimerMode;
  isImbalanced: boolean;
  shape: BodyShape;
  bodyFatKg: number;
  upperGapKg: number;
  upperGapPct: number;
  lowerGapKg: number;
  lowerGapPct: number;
  weakLabels: string[];
  targetBodyLabel: string;
  toneLevel: number;
  kind: "mode" | "intensity";
  recommendedIntensity?: number;
  requestedIntensity?: number;
}): string {
  const goalBit = input.targetBodyLabel
    ? `'${input.targetBodyLabel}'`
    : "목표 체형";
  if (input.kind === "intensity") {
    const down =
      (input.requestedIntensity ?? 1) < (input.recommendedIntensity ?? 1);
    if (down) {
      return `${goalBit}까지 가려면 지금 추천 강도(${input.recommendedIntensity})가 맞아요. 한 단계만 버텨 봐요.`;
    }
    return `강도를 올리려는 거군요. ${goalBit}엔 좋지만, 폼이 무너지면 내일로 미루는 게 안전해요.`;
  }
  if (input.isImbalanced) {
    const gaps = [
      input.upperGapKg > 0
        ? `상체 ${input.upperGapKg}kg(${input.upperGapPct}%)`
        : "",
      input.lowerGapKg > 0
        ? `하체 ${input.lowerGapKg}kg(${input.lowerGapPct}%)`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    return `좌우 차이가 ${gaps}입니다. ${modeLabel[input.requestedMode]}처럼 시간에 쫓기면 강한 쪽만 씁니다. ${modeLabel[input.recommendedMode]}를 유지해요.`;
  }
  if (input.shape === "C") {
    return `체지방 ${input.bodyFatKg}kg인 C자형이라 ${modeLabel[input.recommendedMode]}가 맞아요.`;
  }
  if (input.shape === "D") {
    const weak =
      input.weakLabels.length > 0 ? input.weakLabels.join(", ") : "취약 부위";
    return `${goalBit} 디테일은 ${weak} 고립과 세트 휴식이 필요합니다.`;
  }
  return `${goalBit}으로 가려면 ${modeLabel[input.recommendedMode]}로 페이스를 지키는 편이 나아요.`;
}

export function overrideCopy(requestedMode: WorkoutTimerMode): string {
  return `알겠어요. 오늘은 ${modeLabel[requestedMode]}로 가고, 다음엔 추천 모드로 돌아와요.`;
}
