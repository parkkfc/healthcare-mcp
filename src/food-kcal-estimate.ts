/**
 * Host-estimated kcal/100g for foods not yet looked up in K-FCDB.
 * Replaces Workers AI text generation — the host multimodal LLM fills the number.
 */

export type HostFoodKcalEstimate = {
  foodName: string;
  /** Rounded kcal per 100g from the host. */
  kcalPer100g: number;
  /** Alias kept for older clients that read aiEstimatedKcal. */
  aiEstimatedKcal: number;
  /** Who estimated: always host after Workers AI removal. */
  estimatedBy: "host";
  /** Optional one-line source (web / knowledge / label). */
  source: string;
};

/** Clamp and normalize a host-provided kcal/100g estimate. */
export function normalizeHostFoodKcal(input: {
  foodName: string;
  kcalPer100g: number;
  source?: string;
}): HostFoodKcalEstimate {
  const foodName = input.foodName.trim();
  if (!foodName) {
    throw new Error("foodName이 비어 있습니다.");
  }
  const raw = Number(input.kcalPer100g);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error("kcalPer100g는 0보다 큰 숫자여야 합니다.");
  }
  // Extreme outliers are almost always OCR/unit mistakes.
  const kcalPer100g = Math.round(Math.min(900, Math.max(1, raw)));
  const source = (input.source ?? "").trim() || "host";
  return {
    foodName,
    kcalPer100g,
    aiEstimatedKcal: kcalPer100g,
    estimatedBy: "host",
    source,
  };
}
