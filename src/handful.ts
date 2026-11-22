import { vesselVolumeMl } from "./volume.js";

/** Bulk density of uncooked white rice (g/ml). */
export const RAW_RICE_DENSITY_G_PER_ML = 0.85;

export function volumeMlFromRiceGrams(grams: number): number {
  if (!(grams > 0)) return 0;
  return Math.round((grams / RAW_RICE_DENSITY_G_PER_ML) * 10) / 10;
}

export function volumeMlFromCup(
  diameterCm: number,
  heightCm: number,
): number {
  if (!(diameterCm > 0) || !(heightCm > 0)) return 0;
  // Measuring cup: treat as cylinder (k = 1), inner dimensions.
  return Math.max(
    0,
    vesselVolumeMl({
      diameterCm,
      heightCm,
      fillRatio: 1,
      shapeK: 1,
      dimensionsAreOuter: false,
    }),
  );
}

/**
 * Prefer geometry when both are present; still return the grams-derived
 * volume for display comparison.
 */
export function resolveHandfulVolumeMl(input: {
  riceGrams?: number;
  cupDiameterCm?: number;
  riceHeightCm?: number;
}): { volumeMl: number; fromGramsMl: number; fromCupMl: number } {
  const fromGramsMl = volumeMlFromRiceGrams(input.riceGrams ?? 0);
  const fromCupMl = volumeMlFromCup(
    input.cupDiameterCm ?? 0,
    input.riceHeightCm ?? 0,
  );
  const volumeMl =
    fromCupMl > 0 ? fromCupMl : fromGramsMl > 0 ? fromGramsMl : 0;
  return { volumeMl, fromGramsMl, fromCupMl };
}

export function gramsFromHandfuls(
  handfuls: number,
  handfulVolumeMl: number,
  densityGPerMl = 1,
): number {
  if (!(handfuls > 0) || !(handfulVolumeMl > 0)) return 0;
  const density = densityGPerMl > 0 ? densityGPerMl : 1;
  return Math.max(1, Math.round(handfuls * handfulVolumeMl * density));
}
