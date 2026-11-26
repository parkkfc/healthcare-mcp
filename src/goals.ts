/**
 * Daily targets for the rings, the calendar and the balance chart.
 *
 * Science constants (Katch-McArdle coeffs, Alpert, EA 30, 7700×1.12, PAL 1.375)
 * stay fixed. Body-dependent targets (intake, exercise burn, macros) scale from
 * InBody FFM/weight/fat and the want-to-be deadline pipeline in
 * content/training-docs/1일 권장 칼로리 과학적 근거.md (topic=daily_kcal).
 *
 * Fallback 2000 kcal / ~300 burn only when there is no InBody to scale from.
 */

import {
  bodyGoalLabel,
  findBodyGoal,
  targetBodyFatKg,
  type TargetBodyType,
} from "./body-goals.js";
import type { Sex } from "./cid.js";

export type GoalSource = "saved" | "inbody" | "default" | "body_goal";

/** Macro track from InBody + goal gap (daily-kcal doc §5). */
export type MacroTrack = "cutting" | "recomp" | "maintenance" | "bulking";

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

/** Only when FFM is unknown — not used once InBody exists. */
const FALLBACK_KCAL = 2000;
const FALLBACK_BURN_KCAL = 300;

/** Universal science constants (not body-size “defaults”). */
const PAL = 1.375;
const FAT_KCAL_PER_KG = 7700;
const METABOLIC_ADAPT_FACTOR = 1.12;
const ALPERT_KCAL_PER_KG_FAT = 69.3;
const EA_KCAL_PER_KG_FFM = 30;
const MAX_DEFICIT_FRAC_TDEE = 0.22;
const MAX_WEEKLY_LOSS_FRAC_BW = 0.01;
/** Deficit split: food vs exercise (implementation policy; results still scale). */
const DEFICIT_FROM_FOOD = 0.55;
const DEFICIT_FROM_EXERCISE = 0.45;

export const goalSourceLabel: Record<GoalSource, string> = {
  saved: "저장한 목표",
  inbody: "인바디 제지방량으로 추정한 유지 칼로리",
  body_goal: "워너비 체형·기한으로 산출한 1일 목표",
  default: "기본값 2000kcal (인바디를 저장하면 추정치로 바뀝니다)",
};

function round10(value: number) {
  return Math.round(value / 10) * 10;
}

function ffmKgOf(weight: number, fatKg: number) {
  return weight > 0 && fatKg >= 0 && weight > fatKg
    ? Math.round((weight - fatKg) * 10) / 10
    : 0;
}

function bmrOf(ffm: number) {
  return ffm > 0 ? Math.round(370 + 21.6 * ffm) : 0;
}

/**
 * Typical training-day EEE when InBody exists: ~10–12% of TDEE (and ≥ ~3.5 kcal/kg).
 * Falls back only with no TDEE.
 */
export function defaultExerciseBurnKcal(tdee: number, weightKg: number) {
  if (tdee > 0) {
    const byTdee = tdee * 0.12;
    const byWeight = weightKg > 0 ? weightKg * 3.5 : 0;
    return round10(Math.max(byTdee, byWeight));
  }
  return FALLBACK_BURN_KCAL;
}

/** Clamp EEE relative to this person's TDEE, not a global 200–700 band. */
export function clampExerciseBurnKcal(burn: number, tdee: number) {
  if (!(tdee > 0)) {
    return Math.max(150, Math.min(700, Math.round(burn)));
  }
  const min = round10(Math.max(tdee * 0.08, 150));
  const max = round10(Math.min(tdee * 0.25, Math.max(min, tdee - bmrFloorFromTdee(tdee))));
  return Math.max(min, Math.min(max, round10(burn)));
}

function bmrFloorFromTdee(tdee: number) {
  // TDEE ≈ BMR × 1.375 → BMR ≈ TDEE / 1.375
  return Math.round(tdee / PAL);
}

function isBulkGoal(goalId: string | undefined) {
  return (
    goalId === "hypertrophy" ||
    goalId === "power" ||
    goalId === "upper" ||
    goalId === "lower"
  );
}

export function resolveMacroTrack(input: {
  source: GoalSource;
  fatToLoseKg: number;
  goalId?: string;
}): MacroTrack {
  if (input.source === "body_goal") {
    if (input.fatToLoseKg >= 0.3) return "cutting";
    if (isBulkGoal(input.goalId)) return "bulking";
    return "recomp";
  }
  if (input.source === "inbody" || input.source === "saved") {
    if (isBulkGoal(input.goalId) && input.fatToLoseKg < 0.3) return "bulking";
    return "maintenance";
  }
  return "maintenance";
}

/**
 * Protein/fat from g/kg (InBody), carbs = remainder.
 * Cutting: ~2.4 g/kg FFM; recomp ~2.2 g/kg FFM; bulk ~1.8 g/kg BW; maintain ~1.6 g/kg BW.
 * Fat: ~0.9 g/kg BW (min 15% kcal / 0.5 g/kg).
 */
function macrosFor(
  kcal: number,
  weight: number,
  ffm: number,
  track: MacroTrack,
  user: GoalUser,
) {
  if (
    user?.goalProteinG != null ||
    user?.goalFatG != null ||
    user?.goalCarbG != null
  ) {
    const proteinG =
      user.goalProteinG ??
      Math.round(weight > 0 ? weight * 1.6 : (kcal * 0.2) / 4);
    const fatG =
      user.goalFatG ??
      Math.round(weight > 0 ? weight * 0.9 : (kcal * 0.25) / 9);
    const carbG =
      user.goalCarbG ??
      Math.max(100, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
    return {
      carbG: Math.round(carbG),
      proteinG: Math.round(proteinG),
      fatG: Math.round(fatG),
    };
  }

  let proteinG: number;
  if (ffm > 0 && (track === "cutting" || track === "recomp")) {
    proteinG = Math.round(ffm * (track === "cutting" ? 2.4 : 2.2));
  } else if (weight > 0) {
    proteinG = Math.round(
      weight * (track === "bulking" ? 1.8 : 1.6),
    );
  } else {
    proteinG = Math.round((kcal * 0.2) / 4);
  }

  const fatFromKg =
    weight > 0 ? Math.round(weight * 0.9) : Math.round((kcal * 0.25) / 9);
  const fatFloorKg = weight > 0 ? Math.round(weight * 0.5) : 0;
  const fatFloorKcal = Math.round((kcal * 0.15) / 9);
  const fatG = Math.max(fatFromKg, fatFloorKg, fatFloorKcal);

  const carbG = Math.max(
    100,
    Math.round((kcal - proteinG * 4 - fatG * 9) / 4),
  );
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
  const ffm = ffmKgOf(weight, fatKg);
  const bmr = bmrOf(ffm);
  const tdee = bmr > 0 ? round10(bmr * PAL) : 0;
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

  const scaledBurn = defaultExerciseBurnKcal(tdee, weight);

  let goalIntake = FALLBACK_KCAL;
  let burn = FALLBACK_BURN_KCAL;
  let source: GoalSource = "default";
  let fatToLoseKg = 0;
  let isDeadlineClamped = false;
  let minSafeDays = days || 84;

  if (user?.goalKcal != null && user.goalKcal > 0) {
    goalIntake = Math.round(user.goalKcal);
    burn = Math.round(
      user.goalBurnKcal != null && user.goalBurnKcal > 0
        ? user.goalBurnKcal
        : scaledBurn,
    );
    if (tdee > 0) burn = clampExerciseBurnKcal(burn, tdee);
    source = "saved";
  } else if (goal && days > 0 && bmr > 0 && fatKg > 0) {
    const targetFat =
      targetBodyFatKg(goal.id as TargetBodyType, sex, height) ??
      Math.round(((weight * (goal.id === "slim" ? 0.12 : 0.15)) / 10) * 10);
    fatToLoseKg = Math.max(0, Math.round((fatKg - targetFat) * 10) / 10);
    const totalDeficitNeeded =
      fatToLoseKg * FAT_KCAL_PER_KG * METABOLIC_ADAPT_FACTOR;
    const maxByAlpert = Math.round(ALPERT_KCAL_PER_KG_FAT * fatKg);
    const maxByWeek = Math.round(
      Math.min(
        tdee * MAX_DEFICIT_FRAC_TDEE,
        weight * MAX_WEEKLY_LOSS_FRAC_BW * (FAT_KCAL_PER_KG / 7),
      ),
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

    const fromFood = Math.round(dailyDeficit * DEFICIT_FROM_FOOD);
    const fromExercise = Math.round(dailyDeficit * DEFICIT_FROM_EXERCISE);
    burn = clampExerciseBurnKcal(
      fromExercise > 0 ? fromExercise : scaledBurn,
      tdee,
    );
    // EA: EI ≥ max(BMR, 30×FFM + EEE)
    const minSafeIntake = Math.max(
      bmr,
      Math.round(EA_KCAL_PER_KG_FFM * ffm + burn),
    );
    goalIntake = Math.max(minSafeIntake, round10(tdee - fromFood));

    if (fatToLoseKg < 0.3) {
      goalIntake = round10(tdee);
      burn = clampExerciseBurnKcal(scaledBurn, tdee);
    }
    source = "body_goal";
  } else if (bmr > 0) {
    goalIntake = tdee;
    burn = clampExerciseBurnKcal(scaledBurn, tdee);
    source = "inbody";
  }

  // Re-apply EA floor once burn is final (saved / body_goal / inbody).
  if (ffm > 0 && bmr > 0) {
    const eaFloor = Math.max(bmr, Math.round(EA_KCAL_PER_KG_FFM * ffm + burn));
    if (goalIntake < eaFloor) goalIntake = eaFloor;
  }

  const track = resolveMacroTrack({
    source,
    fatToLoseKg,
    goalId: goal?.id,
  });
  const macros = macrosFor(
    goalIntake,
    weight,
    ffm,
    track,
    user,
  );
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

/** Recompute intake/burn/macros from current InBody (+ body goal), ignoring saved goals. */
export function goalFieldsFromInbody(user: GoalUser): {
  goalKcal: number;
  goalCarbG: number;
  goalProteinG: number;
  goalFatG: number;
  goalBurnKcal: number;
  source: GoalSource;
} | null {
  if (!user) return null;
  const plan = resolveDailyEnergyPlan({
    ...user,
    goalKcal: null,
    goalCarbG: null,
    goalProteinG: null,
    goalFatG: null,
    goalBurnKcal: null,
  });
  if (!plan.ready || plan.goalIntakeKcal <= 0) return null;
  return {
    goalKcal: plan.goalIntakeKcal,
    goalCarbG: plan.carbG,
    goalProteinG: plan.proteinG,
    goalFatG: plan.fatG,
    goalBurnKcal: plan.targetExerciseKcal,
    source: plan.source,
  };
}

export function resolveGoals(user: GoalUser, kcalOverride?: number): Goals {
  if (kcalOverride !== undefined && kcalOverride > 0) {
    const weight = user?.weightKg ?? 0;
    const fat = user?.bodyFatKg ?? 0;
    const ffm = ffmKgOf(weight, fat);
    const bmr = bmrOf(ffm);
    const tdee = bmr > 0 ? round10(bmr * PAL) : 0;
    const goal = findBodyGoal(user?.targetBodyType);
    const targetFat =
      goal && weight > 0 && fat > 0
        ? targetBodyFatKg(
            goal.id as TargetBodyType,
            user?.sex === "female" ? "female" : "male",
            user?.heightCm ?? 0,
          )
        : null;
    const fatToLoseKg =
      targetFat != null
        ? Math.max(0, Math.round((fat - targetFat) * 10) / 10)
        : 0;
    const track = resolveMacroTrack({
      source: "saved",
      fatToLoseKg,
      goalId: goal?.id,
    });
    const macros = macrosFor(kcalOverride, weight, ffm, track, user);
    const burn =
      user?.goalBurnKcal != null && user.goalBurnKcal > 0
        ? Math.round(user.goalBurnKcal)
        : defaultExerciseBurnKcal(tdee, weight);
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
      tdeeKcal: tdee,
      burnKcal: tdee > 0 ? clampExerciseBurnKcal(burn, tdee) : burn,
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
    ffmKg: ffmKgOf(user?.weightKg ?? 0, user?.bodyFatKg ?? 0),
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
