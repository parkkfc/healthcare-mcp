/**
 * C-I-D body shape from weight, skeletal muscle and body fat.
 *
 * Each value is shown as a percent of a standard for the person's height and
 * sex. The standards are approximations, not the InBody device's own tables:
 * standard weight is height² × BMI 22 (male) or 21.5 (female), standard body
 * fat is 15% (male) or 23% (female) of that weight, and standard skeletal
 * muscle is 47% (male) or 42% (female) of that weight.
 *
 * Joining the three bar ends gives the letter: muscle shorter than both
 * weight and fat is C, muscle longer than both is D, otherwise I.
 */

export type Sex = "male" | "female";
export type BodyShape = "C" | "I" | "D";

const STANDARD = {
  male: { bmi: 22, fatRatio: 0.15, muscleRatio: 0.47 },
  female: { bmi: 21.5, fatRatio: 0.23, muscleRatio: 0.42 },
} as const;

/** Percent points the muscle bar must differ by before the line counts as bent. */
const BEND_TOLERANCE = 5;

export function cidStandards(heightCm: number, sex: Sex) {
  const rule = STANDARD[sex];
  const weightKg = (heightCm / 100) ** 2 * rule.bmi;
  return {
    weightKg,
    skeletalMuscleKg: weightKg * rule.muscleRatio,
    bodyFatKg: weightKg * rule.fatRatio,
  };
}

export function cidShape(input: {
  heightCm: number;
  sex: Sex;
  weightKg: number;
  skeletalMuscleKg: number;
  bodyFatKg: number;
}) {
  const standard = cidStandards(input.heightCm, input.sex);
  const percent = (value: number, base: number) =>
    base > 0 ? Math.round((value / base) * 100) : 0;
  const weight = percent(input.weightKg, standard.weightKg);
  const muscle = percent(input.skeletalMuscleKg, standard.skeletalMuscleKg);
  const fat = percent(input.bodyFatKg, standard.bodyFatKg);
  const bend = muscle - (weight + fat) / 2;
  const shape: BodyShape =
    bend > BEND_TOLERANCE && muscle > weight && muscle > fat
      ? "D"
      : bend < -BEND_TOLERANCE && muscle < weight && muscle < fat
        ? "C"
        : "I";
  const round1 = (value: number) => Math.round(value * 10) / 10;
  return {
    shape,
    rows: [
      {
        name: "체중",
        kg: input.weightKg,
        standardKg: round1(standard.weightKg),
        percent: weight,
      },
      {
        name: "골격근량",
        kg: input.skeletalMuscleKg,
        standardKg: round1(standard.skeletalMuscleKg),
        percent: muscle,
      },
      {
        name: "체지방량",
        kg: input.bodyFatKg,
        standardKg: round1(standard.bodyFatKg),
        percent: fat,
      },
    ],
  };
}

export const shapeNote: Record<BodyShape, string> = {
  C: "C자형: 골격근이 체중·체지방에 비해 적습니다. 근육을 먼저 채울 차례입니다.",
  I: "I자형: 체중·골격근·체지방이 비슷한 비율입니다. 근육을 조금 더 올리면 D로 갑니다.",
  D: "D자형: 골격근이 체중·체지방보다 앞섭니다. 지금 균형을 지키면 됩니다.",
};
