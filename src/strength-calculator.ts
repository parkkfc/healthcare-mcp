/**
 * Hybrid strength math from .cursorrules §7.4–7.5:
 * category 1RM equations + %1RM working weight + RIR set-to-set ±4% loads.
 */

export const liftCategories = [
  "upper_press",
  "lower_compound",
  "deadlift",
] as const;

export type LiftCategory = (typeof liftCategories)[number];

/** Infer lift category from slug / Korean name for formula branching. */
export function inferLiftCategory(slug: string, nameKo: string): LiftCategory {
  const text = `${slug} ${nameKo}`.toLowerCase();
  if (
    /dead|데드|rdl|루마니안|hinge|hip.?thrust|힙.?쓰러|풀스루|pull.?through/.test(
      text,
    )
  ) {
    return "deadlift";
  }
  if (
    /press|프레스|bench|벤치|push.?up|푸시업|overhead|숄더|shoulder/.test(text)
  ) {
    return "upper_press";
  }
  return "lower_compound";
}

/**
 * Effective reps for 1RM math. Caps past ~12–15 where equations blow up.
 * Only use sets with performedReps ≤ 10 when updating stored e1RM.
 */
export function effectiveReps(performedReps: number, reportedRir = 0): number {
  return Math.min(15, Math.max(1, performedReps + Math.max(0, reportedRir)));
}

export function percentOf1Rm(category: LiftCategory, reps: number): number {
  const r = Math.min(15, Math.max(1, reps));
  if (category === "upper_press") {
    // Mayhew et al. (1992)
    return 52.2 + 41.9 * Math.exp(-0.055 * r);
  }
  if (category === "deadlift") {
    // Brzycki (1993) inverted to %1RM: w/1RM = (37-r)/36
    return ((37 - r) / 36) * 100;
  }
  // Wathen (1994) — lower compound / default
  return 48.8 + 53.8 * Math.exp(-0.075 * r);
}

/** Estimate 1RM from a submaximal set. Returns 0 when reps are too high. */
export function estimate1RM(input: {
  weightKg: number;
  performedReps: number;
  reportedRir?: number;
  category: LiftCategory;
}): number {
  const { weightKg, performedReps, category } = input;
  if (weightKg <= 0 || performedReps < 1) return 0;
  if (performedReps > 10) return 0;
  const r = effectiveReps(performedReps, input.reportedRir ?? 0);
  if (r > 15) return 0;
  if (performedReps === 1 && (input.reportedRir ?? 0) === 0) {
    return Math.round(weightKg * 10) / 10;
  }
  if (category === "deadlift") {
    // Brzycki: 1RM = (w * 36) / (37 - r)
    if (r >= 37) return 0;
    return Math.round(((weightKg * 36) / (37 - r)) * 10) / 10;
  }
  const pct = percentOf1Rm(category, r);
  if (pct <= 0) return 0;
  return Math.round(((100 * weightKg) / pct) * 10) / 10;
}

function roundLoad(kg: number, isolation: boolean): number {
  if (kg <= 0) return 0;
  const step = isolation ? 1 : 2.5;
  return Math.max(step, Math.round(kg / step) * step);
}

/** Working weight from stored e1RM × target reps + target RIR. */
export function calculateWorkingWeight(input: {
  e1RmKg: number;
  targetReps: number;
  targetRir?: number;
  category: LiftCategory;
  isolation: boolean;
}): number {
  const { e1RmKg, targetReps, category, isolation } = input;
  if (e1RmKg <= 0 || targetReps < 1) return 0;
  const r = effectiveReps(targetReps, input.targetRir ?? 2);
  const pct = percentOf1Rm(category, r) / 100;
  return roundLoad(e1RmKg * pct, isolation);
}

/**
 * Bodyweight counterpart to 1RM → working weight.
 * One-set max reps × mid %1RM band, capped so target RIR remains in the tank.
 */
export function calculateWorkingRepsFromMax(input: {
  maxReps: number;
  targetRir?: number;
  pct1RmMin?: number;
  pct1RmMax?: number;
}): number {
  const maxReps = Math.max(0, Math.floor(input.maxReps));
  if (maxReps < 1) return 0;
  const rir = Math.max(0, input.targetRir ?? 2);
  const minPct = input.pct1RmMin ?? 0;
  const maxPct = input.pct1RmMax ?? 0;
  const midFrac =
    maxPct > 0 ? (Math.max(0, minPct) + maxPct) / 200 : null;
  let working =
    midFrac != null && midFrac > 0
      ? Math.round(maxReps * midFrac)
      : maxReps - rir;
  if (maxReps > rir) {
    working = Math.min(working, maxReps - rir);
  }
  return Math.max(1, Math.min(maxReps, working));
}

/**
 * Set-to-set ±4% load tweak from reported RIR vs target band (default 2–4).
 */
export function recommendNextSetLoad(input: {
  currentWeightKg: number;
  performedReps: number;
  reportedRir: number;
  targetRepsMin: number;
  targetRirMin?: number;
  targetRirMax?: number;
  isolation: boolean;
}): number {
  const {
    currentWeightKg,
    performedReps,
    reportedRir,
    targetRepsMin,
    isolation,
  } = input;
  const targetRirMin = input.targetRirMin ?? 2;
  const targetRirMax = input.targetRirMax ?? 4;
  if (currentWeightKg <= 0) return 0;

  let deltaPct = 0;
  if (performedReps < targetRepsMin && reportedRir === 0) {
    deltaPct = -4 * targetRirMin - 4 * (targetRepsMin - performedReps);
  } else if (reportedRir < targetRirMin) {
    deltaPct = -4 * (targetRirMin - reportedRir);
  } else if (reportedRir > targetRirMax) {
    deltaPct = Math.min(8, 4 * (reportedRir - targetRirMax));
  }
  const next = currentWeightKg * (1 + deltaPct / 100);
  return roundLoad(next, isolation);
}

/**
 * Bodyweight / band first-set RIR → next-set target reps.
 * Capacity ≈ performed + RIR; leave targetRir in reserve.
 */
export function suggestRepsFromRirProbe(input: {
  performedReps: number;
  reportedRir: number;
  targetRir?: number;
}): { nextReps: number; capacity: number } {
  const targetRir = input.targetRir ?? 2;
  const performed = Math.max(1, Math.round(input.performedReps));
  const rir = Math.max(0, Math.round(input.reportedRir));
  const capacity = performed + rir;
  const nextReps = Math.max(3, Math.min(50, Math.round(capacity - targetRir)));
  return { nextReps, capacity };
}

/** First-set RIR → suggested load for set 2 (beginner weight finder). */
export function suggestLoadFromRirProbe(input: {
  weightKg: number;
  performedReps: number;
  reportedRir: number;
  category: LiftCategory;
  isolation: boolean;
  targetReps: number;
  targetRir?: number;
}): { e1RmKg: number; nextWeightKg: number; relativeIntensityPct: number } {
  const e1RmKg = estimate1RM({
    weightKg: input.weightKg,
    performedReps: input.performedReps,
    reportedRir: input.reportedRir,
    category: input.category,
  });
  const nextWeightKg =
    e1RmKg > 0
      ? calculateWorkingWeight({
          e1RmKg,
          targetReps: input.targetReps,
          targetRir: input.targetRir ?? 2,
          category: input.category,
          isolation: input.isolation,
        })
      : recommendNextSetLoad({
          currentWeightKg: input.weightKg,
          performedReps: input.performedReps,
          reportedRir: input.reportedRir,
          targetRepsMin: input.targetReps,
          isolation: input.isolation,
        });
  const relativeIntensityPct =
    e1RmKg > 0 && input.weightKg > 0
      ? Math.round((input.weightKg / e1RmKg) * 1000) / 10
      : 0;
  return { e1RmKg, nextWeightKg, relativeIntensityPct };
}
