/**
 * Five “want-to-be” body types. The picker shows one photo per type and sex
 * (src/widgets). The chosen id is stored on users.target_body_type and steers
 * the workout course and persuasion lines. Body-fat percents are the look's
 * target (male / female). Kilograms use that sex's standard weight at the
 * user's height, so the caption stays in kg.
 */

import { cidStandards, type Sex } from "./cid.js";

export const targetBodyTypes = [
  "slim",
  "hypertrophy",
  "power",
  "upper",
  "lower",
] as const;

export type TargetBodyType = (typeof targetBodyTypes)[number];

export type BodyGoalPreset = {
  id: TargetBodyType;
  title: string;
  detail: string;
  preferRegions: Array<"upper" | "core" | "lower" | "full">;
  preferIsolation: boolean;
  /** Timer mode used once Phase 3 is unlocked. */
  phase3Mode: "rest_timer" | "emom";
};

export const bodyGoalPresets: BodyGoalPreset[] = [
  {
    id: "slim",
    title: "슬림탄탄형",
    detail: "체지방을 낮추고 코어와 전신을 가볍고 탄탄하게 만듭니다.",
    preferRegions: ["core", "full"],
    preferIsolation: false,
    phase3Mode: "emom",
  },
  {
    id: "hypertrophy",
    title: "균형근비대형",
    detail: "상체·하체·코어를 고르게 키우는 다관절 복합 운동 중심입니다.",
    preferRegions: ["full", "upper", "lower", "core"],
    preferIsolation: false,
    phase3Mode: "rest_timer",
  },
  {
    id: "power",
    title: "고밀도파워형",
    detail: "데드리프트·스쿼트 같은 전신·하체 고중량 복합 운동 중심입니다.",
    preferRegions: ["full", "lower"],
    preferIsolation: false,
    phase3Mode: "rest_timer",
  },
  {
    id: "upper",
    title: "상체집중형",
    detail: "가슴·어깨·등을 고립 운동으로 집중해서 키웁니다.",
    preferRegions: ["upper"],
    preferIsolation: true,
    phase3Mode: "rest_timer",
  },
  {
    id: "lower",
    title: "하체집중형",
    detail: "허벅지·엉덩이를 고립 운동으로 집중해서 키웁니다.",
    preferRegions: ["lower"],
    preferIsolation: true,
    phase3Mode: "rest_timer",
  },
];

/** Returns null for ids from the old four-preset picker, so users re-pick. */
export function findBodyGoal(id: string | null | undefined) {
  return bodyGoalPresets.find((item) => item.id === id) ?? null;
}

/** Target body-fat percent for the photo, by the photo's sex. */
export const targetBodyFatPercent: Record<
  TargetBodyType,
  Record<Sex, number>
> = {
  slim: { male: 11, female: 19 },
  hypertrophy: { male: 13, female: 21 },
  power: { male: 15, female: 22 },
  upper: { male: 13, female: 20 },
  lower: { male: 13, female: 21 },
};

/** About-kg of body fat for this look at the user's height. Null without a usable height. */
export function targetBodyFatKg(
  type: TargetBodyType,
  sex: Sex,
  heightCm: number | null | undefined,
) {
  const height = heightCm ?? 0;
  if (height < 120 || height > 230) return null;
  const percent = targetBodyFatPercent[type][sex];
  const kg = (cidStandards(height, sex).weightKg * percent) / 100;
  return Math.round(kg * 10) / 10;
}

export const bodyGoalLabel: Record<TargetBodyType, string> = {
  slim: "슬림탄탄형",
  hypertrophy: "균형근비대형",
  power: "고밀도파워형",
  upper: "상체집중형",
  lower: "하체집중형",
};
