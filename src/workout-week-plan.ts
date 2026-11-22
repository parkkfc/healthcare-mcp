/**
 * Persist Mon–Sun workout schedules (civil week of the client's local date)
 * so recommend-inbody-workout loads the same week instead of rebuilding
 * on every host call.
 */

import {
  analyzeInbodyWorkout,
  type HomeEquipment,
  type InjuredPart,
  type PlannedExercise,
  type SessionPrescription,
  type TrainingVenue,
  type WorkoutTimerMode,
} from "./inbody-analyzer.js";
import type { TargetBodyType } from "./body-goals.js";
import { addDays } from "./db/client.js";
import {
  buildWeekCalendar,
  dateInSameWeek,
  sessionKindLabel,
  type ScheduleBias,
  type SessionKind,
  type WeekDaySlot,
} from "./workout-schedule.js";

export type WeekPlanDay = {
  date: string;
  weekday: number;
  dayLabel: string;
  mark: "O" | "X";
  kind: SessionKind | "rest";
  templateKind: SessionKind;
  sessionLabel: string;
  sessionKind: SessionKind | "rest";
  sessionFocus: "upper" | "lower" | "full";
  recommendedMode: WorkoutTimerMode;
  recommendedIntensity: number;
  prescription: SessionPrescription | null;
  safetyNotes: string[];
  missingSlots: Array<{
    role: string;
    label: string;
    region: string;
    muscles: string;
    hint: string;
  }>;
  exercises: PlannedExercise[];
  energy: {
    targetExerciseKcal: number;
    strengthBurnKcal: number;
    cardioBurnKcal: number;
    cardioMinutes: number;
    goalIntakeKcal: number;
    bmrKcal: number;
  } | null;
};

export type WeekPlanPayload = {
  weekStart: string;
  weekEnd: string;
  venue: TrainingVenue;
  homeEquipment: HomeEquipment[];
  phase: 1 | 2 | 3;
  phaseLabel: string;
  scheduleBias: ScheduleBias;
  scheduleReason: string;
  weekHint: string;
  shape: string;
  isImbalanced: boolean;
  weakLabels: string[];
  targetLabels: string[];
  targetBodyType: string;
  targetBodyLabel: string;
  structuralIssues: Array<{
    id: string;
    title: string;
    detail: string;
    exercises: string[];
  }>;
  fingerprint: string;
  source: "cache" | "fresh";
  days: WeekPlanDay[];
};

/** Monday–Sunday bounds for a civil YYYY-MM-DD (device-local day from the tool). */
export function seoulWeekBounds(date: string): {
  weekStart: string;
  weekEnd: string;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return { weekStart: date, weekEnd: date };
  }
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const utc = Date.UTC(y, m, d);
  const weekday = new Date(utc).getUTCDay(); // 0=Sun … 6=Sat
  const toMonday = weekday === 0 ? -6 : 1 - weekday;
  const weekStart = addDays(date, toMonday);
  const weekEnd = addDays(weekStart, 6);
  return { weekStart, weekEnd };
}

export function homeEquipmentKey(
  venue: TrainingVenue,
  gear: HomeEquipment[],
): string {
  if (venue !== "home") return "";
  return [...gear].sort().join(",");
}

export function weekPlanFingerprint(input: {
  targetBodyType: string | null | undefined;
  targetDays: number | null | undefined;
  injuredParts: string[];
  inbodyMeasuredOn: string | null | undefined;
  weightKg: number;
  skeletalMuscleKg: number;
  bodyFatKg: number;
  muscleUpperLeftKg: number;
  muscleUpperRightKg: number;
  muscleCoreKg: number;
  muscleLowerLeftKg: number;
  muscleLowerRightKg: number;
  catalogSlugs: string[];
}): string {
  const injured = [...input.injuredParts].sort().join(",");
  const catalog = [...input.catalogSlugs].sort().join(",");
  return [
    input.targetBodyType ?? "",
    String(input.targetDays ?? ""),
    injured,
    input.inbodyMeasuredOn ?? "",
    input.weightKg,
    input.skeletalMuscleKg,
    input.bodyFatKg,
    input.muscleUpperLeftKg,
    input.muscleUpperRightKg,
    input.muscleCoreKg,
    input.muscleLowerLeftKg,
    input.muscleLowerRightKg,
    catalog,
  ].join("|");
}

export function parseWeekPlanPayload(raw: string): WeekPlanPayload | null {
  try {
    const parsed = JSON.parse(raw) as WeekPlanPayload;
    if (!parsed?.weekStart || !Array.isArray(parsed.days)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function weekPlanHasGaps(plan: WeekPlanPayload): boolean {
  return plan.days.some((day) => (day.missingSlots?.length ?? 0) > 0);
}

type Snapshot = Parameters<typeof analyzeInbodyWorkout>[0];
type Catalog = Parameters<typeof analyzeInbodyWorkout>[1];

function restDayFromSlot(
  date: string,
  slot: WeekDaySlot,
): WeekPlanDay {
  return {
    date,
    weekday: slot.weekday,
    dayLabel: slot.dayLabel,
    mark: "X",
    kind: "rest",
    templateKind: slot.templateKind,
    sessionLabel: "휴식",
    sessionKind: "rest",
    sessionFocus: "full",
    recommendedMode: "rest_timer",
    recommendedIntensity: 1,
    prescription: null,
    safetyNotes: [],
    missingSlots: [],
    exercises: [],
    energy: null,
  };
}

/** Build Mon–Sun days once (server). Rest days skip exercise fill. */
export function buildWeekPlanPayload(input: {
  weekStart: string;
  weekEnd: string;
  snapshot: Snapshot;
  catalog: Catalog;
  targetBodyType: TargetBodyType | null;
  injuredParts: InjuredPart[];
  e1RmByExercise: Record<string, number>;
  trainingVenue: TrainingVenue;
  homeEquipment: HomeEquipment[];
  recentExerciseNames: string[];
  targetDays: number | null;
  fingerprint: string;
}): WeekPlanPayload {
  const probe = analyzeInbodyWorkout(input.snapshot, input.catalog, {
    targetBodyType: input.targetBodyType,
    injuredParts: input.injuredParts,
    e1RmByExercise: input.e1RmByExercise,
    trainingVenue: input.trainingVenue,
    date: input.weekStart,
    recentExerciseNames: input.recentExerciseNames,
    homeEquipment: input.homeEquipment,
    targetDays: input.targetDays,
  });

  const calendar = buildWeekCalendar({
    phase: probe.phase,
    bias: probe.scheduleBias,
  });

  const days: WeekPlanDay[] = calendar.map((slot) => {
    const date = dateInSameWeek(input.weekStart, slot.weekday);
    if (slot.mark === "X") {
      return restDayFromSlot(date, slot);
    }
    const dayPlan = analyzeInbodyWorkout(input.snapshot, input.catalog, {
      targetBodyType: input.targetBodyType,
      injuredParts: input.injuredParts,
      e1RmByExercise: input.e1RmByExercise,
      trainingVenue: input.trainingVenue,
      date,
      recentExerciseNames: input.recentExerciseNames,
      homeEquipment: input.homeEquipment,
      targetDays: input.targetDays,
    });
    return {
      date,
      weekday: slot.weekday,
      dayLabel: slot.dayLabel,
      mark: "O" as const,
      kind: slot.kind,
      templateKind: slot.templateKind,
      sessionLabel: dayPlan.sessionLabel || sessionKindLabel[slot.templateKind],
      sessionKind: dayPlan.sessionKind,
      sessionFocus: dayPlan.sessionFocus,
      recommendedMode: dayPlan.recommendedMode,
      recommendedIntensity: dayPlan.recommendedIntensity,
      prescription: dayPlan.prescription,
      safetyNotes: dayPlan.safetyNotes,
      missingSlots: dayPlan.missingSlots,
      exercises: dayPlan.exercises,
      energy: dayPlan.energy,
    };
  });

  return {
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    venue: input.trainingVenue,
    homeEquipment: input.homeEquipment,
    phase: probe.phase,
    phaseLabel: probe.phaseLabel,
    scheduleBias: probe.scheduleBias,
    scheduleReason: probe.scheduleReason,
    weekHint: probe.weekHint,
    shape: probe.shape,
    isImbalanced: probe.isImbalanced,
    weakLabels: probe.weakLabels,
    targetLabels: probe.targetLabels,
    targetBodyType: probe.targetBodyType ?? "",
    targetBodyLabel: probe.targetBodyLabel,
    structuralIssues: probe.structuralIssues,
    fingerprint: input.fingerprint,
    source: "fresh",
    days,
  };
}

export function pickWeekPlanDay(
  plan: WeekPlanPayload,
  date: string,
): WeekPlanDay | null {
  return plan.days.find((day) => day.date === date) ?? null;
}
