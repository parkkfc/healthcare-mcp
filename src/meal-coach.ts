/**
 * Meal coaching mode from the latest InBody shape and weight vs standard.
 * C / high body-fat → reduce (one-plate). Low weight vs standard → bulk
 * (full-table meal, refill buttons). Otherwise maintain.
 */

import { cidShape, cidStandards, type BodyShape, type Sex } from "./cid.js";

export type MealCoachMode = "reduce" | "bulk" | "maintain";

export function mealCoachMode(input: {
  heightCm: number;
  sex: Sex | "" | null;
  weightKg: number;
  skeletalMuscleKg: number;
  bodyFatKg: number;
}): { mode: MealCoachMode; shape: BodyShape | ""; detail: string } {
  if (
    !(input.heightCm > 0) ||
    !(input.weightKg > 0) ||
    (input.sex !== "male" && input.sex !== "female")
  ) {
    return {
      mode: "maintain",
      shape: "",
      detail: "인바디·키가 있으면 감량/증량 코칭이 붙습니다.",
    };
  }
  const cid = cidShape({
    heightCm: input.heightCm,
    sex: input.sex,
    weightKg: input.weightKg,
    skeletalMuscleKg: input.skeletalMuscleKg,
    bodyFatKg: input.bodyFatKg,
  });
  const standard = cidStandards(input.heightCm, input.sex);
  const under =
    input.weightKg < standard.weightKg * 0.92 ||
    input.weightKg / (input.heightCm / 100) ** 2 < 18.5;

  if (cid.shape === "C" || input.bodyFatKg >= standard.bodyFatKg * 1.2) {
    return {
      mode: "reduce",
      shape: cid.shape,
      detail:
        "과체중·감량 코칭: 한 접시(원플레이트)에 덜어 담고, 구성 양을 줄여 적으세요.",
    };
  }
  if (under || input.weightKg < standard.weightKg) {
    return {
      mode: "bulk",
      shape: cid.shape,
      detail:
        "저체중·증량 코칭: 한상차림 사진 한 장으로 기록하고, 공기밥·메인 리필로 양을 늘니다.",
    };
  }
  return {
    mode: "maintain",
    shape: cid.shape,
    detail: "유지 코칭: 지금 양을 기준으로 맞추면 됩니다.",
  };
}

/** Parse “100g” / “1회 120g” style serving weights from K-FCDB. */
export function parseServingGrams(servingWeight: string | null | undefined) {
  const parsed = Number.parseFloat(servingWeight ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}
