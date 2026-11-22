/**
 * Daily targets for the rings, the calendar and the balance chart.
 *
 * Saved goals win. Without them the kcal target is a maintenance estimate from
 * the latest InBody: Katch-McArdle BMR (370 + 21.6 × lean mass kg) × 1.375 for
 * light activity. With neither, 2000 kcal. Macros split the kcal target:
 * protein 1.6 g per kg of body weight (or 20% of kcal), fat 25% of kcal, carbs
 * the rest.
 *
 * When a want-to-be body and deadline exist, intake and exercise burn follow the
 * FFM / safety-clamp pipeline (EA, Alpert, weekly rate) instead of a flat TDEE.
 */

import {
  bodyGoalLabel,
  findBodyGoal,
  targetBodyFatKg,
  type TargetBodyType,
} from "./body-goals.js";
import type { Sex } from "./cid.js";

export type GoalSource = "saved" | "inbody" | "default" | "body_goal";

export type Goals = {
  kcal: number;
  carbG: number;
  proteinG: number;
  fatG: number;
  /** 4-4-9: carbG×4, proteinG×4, fatG×9. Chart reference lines use these. */
  carbKcal: number;
  proteinKcal: number;
  fatKcal: number;
  ffmKg: number;
  bmrKcal: number;
  tdeeKcal: number;
  burnKcal: number;
  source: GoalSource;
};

/** Home / workout snapshot: targets from InBody + body goal + today's actuals. */
export type DailyEnergyPlan = {
  ready: boolean;
  bmrKcal: number;
  tdeeKcal: number;
  goalIntakeKcal: number;
  targetExerciseKcal: number;
  targetExpenditureKcal: number;
  carbKcal: number;
  proteinKcal: number;
  fatKcal: number;
  carbG: number;
  proteinG: number;
  fatG: number;
  fatToLoseKg: number;
  isDeadlineClamped: boolean;
  minSafeDays: number;
  targetDays: number;
  bodyGoalTitle: string;
  source: GoalSource;
  /** Today's logged meal kcal (탄단지 합). */
  intakeKcal: number;
  /** Today's logged macro kcal (4-4-9) and grams. */
  intakeCarbKcal: number;
  intakeProteinKcal: number;
  intakeFatKcal: number;
  intakeCarbG: number;
  intakeProteinG: number;
  intakeFatG: number;
  /** Today's logged workout burn. */
  exerciseKcal: number;
  /** BMR + today's exercise. */
  expenditureKcal: number;
};

type GoalUser = {
  weightKg: number | null;
  bodyFatKg: number | null;
  heightCm?: number | null;
  sex?: string | null;
  targetBodyType?: string | null;
  targetDays?: number | null;
  goalKcal: number | null;
  goalCarbG: number | null;
  goalProteinG: number | null;
  goalFatG: number | null;
  goalBurnKcal: number | null;
} | null;

const DEFAULT_KCAL = 2000;
const DEFAULT_BURN_KCAL = 300;
const MIN_EXERCISE_KCAL = 200;
const MAX_EXERCISE_KCAL = 700;

export const goalSourceLabel: Record<GoalSource, string> = {
  saved: "저장한 목표",
  inbody: "인바디 제지방량으로 추정한 유지 칼로리",
  body_goal: "워너비 체형·기한으로 산출한 1일 목표",
  default: "기본값 2000kcal (인바디를 저장하면 추정치로 바뀝니다)",
};

function round10(value: number) {
  return Math.round(value / 10) * 10;
}

function macrosFor(kcal: number, weight: number | null, user: GoalUser) {
  const proteinG =
    user?.goalProteinG ??
    Math.round(weight != null ? weight * 1.6 : (kcal * 0.2) / 4);
  const fatG = user?.goalFatG ?? Math.round((kcal * 0.25) / 9);
  const carbG =
    user?.goalCarbG ??
    Math.max(100, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  return {
    carbG: Math.round(carbG),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
  };
}

/**
 * InBody + want-to-be + deadline → intake, exercise burn, BMR/TDEE.
 * Safety clamps keep crash diets off the card.
 */
export function resolveDailyEnergyPlan(
  user: GoalUser,
  actual?: {
    intakeKcal?: number;
    intakeCarbKcal?: number;
    intakeProteinKcal?: number;
    intakeFatKcal?: number;
    intakeCarbG?: number;
    intakeProteinG?: number;
    intakeFatG?: number;
    exerciseKcal?: number;
  },
): DailyEnergyPlan {
  const weight = user?.weightKg ?? 0;
  const fatKg = user?.bodyFatKg ?? 0;
  const ffm =
    weight > 0 && fatKg >= 0 && weight > fatKg
      ? Math.round((weight - fatKg) * 10) / 10
      : 0;
  const bmr = ffm > 0 ? Math.round(370 + 21.6 * ffm) : 0;
  const tdee = bmr > 0 ? round10(bmr * 1.375) : 0;
  const goal = findBodyGoal(user?.targetBodyType);
  const days = Math.max(14, Math.min(365, user?.targetDays ?? 0));
  const sex: Sex =
    user?.sex === "female" || user?.sex === "male" ? user.sex : "male";
  const height = user?.heightCm ?? 0;
  const intakeCarbGActual = Math.max(0, Math.round(actual?.intakeCarbG ?? 0));
  const intakeProteinGActual = Math.max(
    0,
    Math.round(actual?.intakeProteinG ?? 0),
  );
  const intakeFatGActual = Math.max(0, Math.round(actual?.intakeFatG ?? 0));
  const intakeCarbActual = Math.max(
    0,
    Math.round(actual?.intakeCarbKcal ?? intakeCarbGActual * 4),
  );
  const intakeProteinActual = Math.max(
    0,
    Math.round(actual?.intakeProteinKcal ?? intakeProteinGActual * 4),
  );
  const intakeFatActual = Math.max(
    0,
    Math.round(actual?.intakeFatKcal ?? intakeFatGActual * 9),
  );
  const intakeActual = Math.max(
    0,
    Math.round(
      actual?.intakeKcal ??
        intakeCarbActual + intakeProteinActual + intakeFatActual,
    ),
  );
  const exerciseActual = Math.max(0, Math.round(actual?.exerciseKcal ?? 0));

  let goalIntake = DEFAULT_KCAL;
  let burn = DEFAULT_BURN_KCAL;
  let source: GoalSource = "default";
  let fatToLoseKg = 0;
  let isDeadlineClamped = false;
  let minSafeDays = days || 84;

  if (user?.goalKcal != null && user.goalKcal > 0) {
    goalIntake = Math.round(user.goalKcal);
    burn = Math.round(user.goalBurnKcal ?? DEFAULT_BURN_KCAL);
    source = "saved";
  } else if (goal && days > 0 && bmr > 0 && fatKg > 0) {
    const targetFat =
      targetBodyFatKg(goal.id as TargetBodyType, sex, height) ??
      Math.round(((weight * (goal.id === "slim" ? 0.12 : 0.15)) / 10) * 10);
    fatToLoseKg = Math.max(0, Math.round((fatKg - targetFat) * 10) / 10);
    const totalDeficitNeeded = fatToLoseKg * 7700 * 1.12;
    const maxByAlpert = Math.round(69.3 * fatKg);
    const maxByWeek = Math.round(
      Math.min(tdee * 0.22, weight * 0.01 * (7700 / 7)),
    );
    const maxSafeDailyDeficit = Math.max(
      150,
      Math.min(maxByAlpert, maxByWeek, tdee - bmr),
    );
    minSafeDays =
      totalDeficitNeeded > 0
        ? Math.max(days, Math.ceil(totalDeficitNeeded / maxSafeDailyDeficit))
        : days;
    const rawDaily =
      totalDeficitNeeded > 0 ? totalDeficitNeeded / days : 0;
    const dailyDeficit = Math.min(rawDaily, maxSafeDailyDeficit);
    isDeadlineClamped = rawDaily > maxSafeDailyDeficit + 1;
    const minSafeIntake = Math.max(bmr, Math.round(30 * ffm));
    // Split the deficit: ~55% from food, ~45% from exercise burn.
    const fromFood = Math.round(dailyDeficit * 0.55);
    const fromExercise = Math.round(dailyDeficit * 0.45);
    goalIntake = Math.max(minSafeIntake, round10(tdee - fromFood));
    burn = Math.max(
      MIN_EXERCISE_KCAL,
      Math.min(MAX_EXERCISE_KCAL, fromExercise || DEFAULT_BURN_KCAL),
    );
    if (fatToLoseKg < 0.3) {
      // Recomp / already lean: keep near TDEE, still train.
      goalIntake = round10(tdee);
      burn = Math.max(MIN_EXERCISE_KCAL, Math.min(400, Math.round(tdee * 0.12)));
    }
    source = "body_goal";
  } else if (bmr > 0) {
    goalIntake = tdee;
    burn = DEFAULT_BURN_KCAL;
    source = "inbody";
  }

  const macros = macrosFor(goalIntake, weight > 0 ? weight : null, user);
  const targetExpenditure = bmr + burn;
  return {
    ready: bmr > 0,
    bmrKcal: bmr,
    tdeeKcal: tdee,
    goalIntakeKcal: goalIntake,
    targetExerciseKcal: burn,
    targetExpenditureKcal: targetExpenditure,
    carbKcal: macros.carbG * 4,
    proteinKcal: macros.proteinG * 4,
    fatKcal: macros.fatG * 9,
    carbG: macros.carbG,
    proteinG: macros.proteinG,
    fatG: macros.fatG,
    fatToLoseKg,
    isDeadlineClamped,
    minSafeDays,
    targetDays: days || 0,
    bodyGoalTitle: goal ? bodyGoalLabel[goal.id] : "",
    source,
    intakeKcal: intakeActual,
    intakeCarbKcal: intakeCarbActual,
    intakeProteinKcal: intakeProteinActual,
    intakeFatKcal: intakeFatActual,
    intakeCarbG: intakeCarbGActual,
    intakeProteinG: intakeProteinGActual,
    intakeFatG: intakeFatGActual,
    exerciseKcal: exerciseActual,
    expenditureKcal: bmr + exerciseActual,
  };
}

export function resolveGoals(user: GoalUser, kcalOverride?: number): Goals {
  if (kcalOverride !== undefined && kcalOverride > 0) {
    const weight = user?.weightKg ?? null;
    const fat = user?.bodyFatKg ?? null;
    const ffm =
      weight != null && fat != null && weight > fat
        ? Math.round((weight - fat) * 10) / 10
        : 0;
    const bmr = ffm > 0 ? Math.round(370 + 21.6 * ffm) : 0;
    const macros = macrosFor(kcalOverride, weight, user);
    return {
      kcal: Math.round(kcalOverride),
      carbG: macros.carbG,
      proteinG: macros.proteinG,
      fatG: macros.fatG,
      carbKcal: macros.carbG * 4,
      proteinKcal: macros.proteinG * 4,
      fatKcal: macros.fatG * 9,
      ffmKg: ffm,
      bmrKcal: bmr,
      tdeeKcal: bmr > 0 ? round10(bmr * 1.375) : 0,
      burnKcal: Math.round(user?.goalBurnKcal ?? DEFAULT_BURN_KCAL),
      source: "saved",
    };
  }
  const plan = resolveDailyEnergyPlan(user);
  return {
    kcal: plan.goalIntakeKcal,
    carbG: plan.carbG,
    proteinG: plan.proteinG,
    fatG: plan.fatG,
    carbKcal: plan.carbKcal,
    proteinKcal: plan.proteinKcal,
    fatKcal: plan.fatKcal,
    ffmKg:
      user?.weightKg != null &&
      user.bodyFatKg != null &&
      user.weightKg > user.bodyFatKg
        ? Math.round((user.weightKg - user.bodyFatKg) * 10) / 10
        : 0,
    bmrKcal: plan.bmrKcal,
    tdeeKcal: plan.tdeeKcal,
    burnKcal: plan.targetExerciseKcal,
    source: plan.source,
  };
}

export type DayStatus = "met" | "over" | "far-over";

/** Within goal is met, up to 15% above is over, beyond that far-over. */
export function dayStatus(kcal: number, goalKcal: number): DayStatus {
  if (kcal <= goalKcal) return "met";
  if (kcal <= goalKcal * 1.15) return "over";
  return "far-over";
}
