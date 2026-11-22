/** Bowl & plate volume per `.cursorrules` (power-of-revolution model). */

export type VesselMaterial =
  | "ceramic"
  | "stainless"
  | "ttukbaegi"
  | "plate";

export type VesselKind =
  | "stainless_rice"
  | "ceramic_bowl"
  | "ttukbaegi"
  | "noodle_bowl"
  | "deep_plate";

export interface VolumeIngredient {
  /** 접시 윗면 면적 중 이 재료가 덮은 비율 (0~1) */
  coverage: number;
  /** 납작한 접시(곡률 0)에 펼쳤을 때의 평균 두께(cm) */
  thicknessCm: number;
  /** 밀도(g/ml). 모르면 1 */
  density: number;
}

export interface VolumeInput {
  /** 그릇 윗면 지름(cm) */
  diameterCm: number;
  /**
   * 0은 납작한 접시, 1은 윗면 지름을 기준으로 한 반구.
   * 그 사이는 같은 구면 조각의 깊이로 잇는다.
   */
  curvature: number;
  /** 그릇 깊이 중 음식이 찬 비율 (0~1+; 1 초과는 고봉) */
  fillRatio: number;
  ingredients: VolumeIngredient[];
}

export interface VolumeResult {
  ml: number;
  grams: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampMin(value: number, min = 0.5): number {
  return Math.max(min, value);
}

/** Shape factor k by vessel kind (inner dimensions). */
export const VESSEL_SHAPE_K: Record<VesselKind, number> = {
  stainless_rice: 0.82,
  ceramic_bowl: 0.7,
  ttukbaegi: 0.78,
  noodle_bowl: 0.63,
  deep_plate: 0.65,
};

/** Outer → inner wall/foot correction (cm). */
export function toInnerDimensions(
  outerD: number,
  outerH: number,
  material: VesselMaterial = "ceramic",
): { diameterCm: number; heightCm: number } {
  const wall =
    material === "stainless"
      ? { d: 0.2, h: 0.3 }
      : material === "ttukbaegi"
        ? { d: 1.4, h: 1.5 }
        : material === "plate"
          ? { d: 0.6, h: 0.6 }
          : { d: 0.8, h: 1.2 };
  return {
    diameterCm: clampMin(outerD - wall.d),
    heightCm: clampMin(outerH - wall.h),
  };
}

/** k from curvature exponent n: k = n / (n + 2), clamped to [0.33, 1]. */
export function shapeKFromExponent(n: number): number {
  if (!(n > 0)) return VESSEL_SHAPE_K.ceramic_bowl;
  return clamp(n / (n + 2), 0.33, 1);
}

/** Spherical-cap (구관) volume above the rim, cm³ = mL. */
export function sphericalCapTopMl(diameterCm: number, hTop: number): number {
  const R = Math.max(diameterCm, 0) / 2;
  const h = Math.max(hTop, 0);
  if (R === 0 || h === 0) return 0;
  return (Math.PI * h * (3 * R * R + h * h)) / 6;
}

/**
 * Full / filled bowl volume (mL).
 * vFull = k · π · (D/2)² · H
 * fill ≤ 1 → V = vFull · fill^(1/k)
 * fill > 1 → V = vFull + spherical cap
 * flat plate H ≤ 0.5 → cap only
 */
export function vesselVolumeMl(input: {
  diameterCm: number;
  heightCm: number;
  fillRatio?: number;
  /** Defaults to ceramic_bowl (0.70). */
  kind?: VesselKind;
  /** Or set k directly (0.33~1). */
  shapeK?: number;
  /** When true, apply material wall correction first. */
  dimensionsAreOuter?: boolean;
  material?: VesselMaterial;
}): number {
  const kind = input.kind ?? "ceramic_bowl";
  const k = clamp(
    input.shapeK ?? VESSEL_SHAPE_K[kind],
    0.33,
    1,
  );
  let D = Math.max(input.diameterCm, 0);
  let H = Math.max(input.heightCm, 0);
  if (input.dimensionsAreOuter) {
    const inner = toInnerDimensions(
      D,
      H,
      input.material ??
        (kind === "stainless_rice"
          ? "stainless"
          : kind === "ttukbaegi"
            ? "ttukbaegi"
            : kind === "deep_plate"
              ? "plate"
              : "ceramic"),
    );
    D = inner.diameterCm;
    H = inner.heightCm;
  }
  const fill = Math.max(input.fillRatio ?? 1, 0);
  if (D === 0 || fill === 0) return 0;

  // Flat plate: food pile only.
  if (H <= 0.5) {
    const hTop = H > 0 ? H * Math.max(fill, 1) : 0;
    return Math.round(sphericalCapTopMl(D, hTop));
  }

  const vFull = k * Math.PI * Math.pow(D / 2, 2) * H;
  if (fill <= 1) {
    return Math.round(vFull * Math.pow(fill, 1 / k));
  }
  const hTop = (fill - 1) * H;
  return Math.round(vFull + sphericalCapTopMl(D, hTop));
}

/**
 * Meal-card bowl: palm/photo diameter·height as outer ceramic bowl.
 * Prefer this over frustum / cylinder shortcuts.
 */
export function bowlContentMl(input: {
  diameterCm: number;
  heightCm: number;
  fillRatio: number;
  kind?: VesselKind;
  dimensionsAreOuter?: boolean;
  material?: VesselMaterial;
}): number {
  return vesselVolumeMl({
    diameterCm: input.diameterCm,
    heightCm: input.heightCm,
    fillRatio: input.fillRatio,
    kind: input.kind ?? "ceramic_bowl",
    dimensionsAreOuter: input.dimensionsAreOuter ?? true,
    material: input.material ?? "ceramic",
  });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 곡률 1이면 깊이가 반지름과 같은 반구다. 윗면 지름 대비 비율은 곡률의 절반이다. */
export function vesselDepthCm(diameterCm: number, curvature: number): number {
  return (Math.max(diameterCm, 0) * clamp01(curvature)) / 2;
}

/**
 * Multi-ingredient split for legacy photo lookup.
 * Total bowl volume uses the power-of-revolution model; coverage splits ml.
 */
export function estimateVolumes(input: VolumeInput): VolumeResult[] {
  const diameter = Math.max(input.diameterCm, 0);
  const curvature = clamp01(input.curvature);
  const fill = Math.max(input.fillRatio, 0);
  const maxThickness = input.ingredients.reduce(
    (max, item) => Math.max(max, Math.max(item.thicknessCm, 0)),
    0,
  );
  // Map curvature → shape k: flat plate ~0.65, deep bowl ~0.70, near-hemisphere ~0.50.
  const shapeK =
    curvature <= 0.05
      ? VESSEL_SHAPE_K.deep_plate
      : curvature >= 0.95
        ? 0.5
        : VESSEL_SHAPE_K.ceramic_bowl;
  const heightCm =
    curvature > 0.05
      ? Math.max(vesselDepthCm(diameter, curvature), maxThickness)
      : Math.max(maxThickness, 0.5);
  const totalMl = vesselVolumeMl({
    diameterCm: diameter,
    heightCm,
    fillRatio: fill,
    shapeK,
    dimensionsAreOuter: false,
  });
  const coverageSum = input.ingredients.reduce(
    (sum, item) => sum + Math.max(item.coverage, 0),
    0,
  );

  return input.ingredients.map((item) => {
    const coverage = Math.max(item.coverage, 0);
    const ml =
      coverageSum > 0
        ? Math.round((totalMl * coverage) / coverageSum)
        : 0;
    return { ml, grams: Math.round(ml * item.density) };
  });
}
