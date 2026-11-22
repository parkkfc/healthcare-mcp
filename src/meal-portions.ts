import { gramsFromHandfuls } from "./handful.js";
import { bowlContentMl } from "./volume.js";

export type MealPortionRole =
  | "main"
  | "side"
  | "soup"
  | "rice"
  | "meat"
  | "fried"
  | "snack";

export type MealCuisine = "korean" | "western" | "snack" | "text";

export type PortionRequest = {
  slot: number;
  meal: string;
  name: string;
  role: MealPortionRole;
  cuisine?: MealCuisine;
  grams?: number;
  coverage?: number;
  thicknessCm?: number;
  densityGPerMl?: number;
  containerDiameterCm?: number;
  curvature?: number;
  fillRatio?: number;
  /** Full single-bowl volume servings (rice/soup). */
  servings?: number;
  handfuls?: number;
  handfulVolumeMl?: number;
  /** Piece fraction: 1, 0.5, 1/3, etc. */
  pieceCount?: number;
  /** User-written amount, e.g. "1줌", "2장", "3개". */
  amountNote?: string;
  servingGrams?: number;
  servingKcal?: number;
  kcalPer100g?: number;
  /** kcal of one user unit (1줌 or 1장). Not per gram. */
  kcalPerUnit?: number;
  carbPerUnit?: number;
  proteinPerUnit?: number;
  fatPerUnit?: number;
  /** User accepted a web-found food that is not an exact DB name. */
  nameConfirmed?: boolean;
  /** Web-found or host-picked name shown for confirmation. Not used until nameConfirmed. */
  candidateName?: string;
  /** Exact DB food_name the host chose after looking at the photo. */
  matchedFoodName?: string;
  /** Host synonyms for candidate search (계란 → 달걀). */
  alsoSearch?: string[];
  /** Host-ranked DB food_name list for the card (photo-similar first). */
  candidatePicks?: string[];
  /** User tapped “목록에 없음” — skip candidate pick, ask AI for nutrition. */
  noneOfCandidates?: boolean;
  /** Legacy — ignored for Korean sides; kept for old peeks. */
  oneMealGrams?: number;
  oneMealSource?: string;
};

/** Card and host must share this string exactly. */
export function mealPortionKey(
  slots: { slot: number; meal: string; note: string }[],
): string {
  return slots
    .map(
      (item) =>
        `${item.slot}|${item.meal}|${item.note.replace(/\s+/g, " ").trim()}`,
    )
    .join("\n");
}

export function vesselGrams(input: {
  diameterCm: number;
  thicknessCm: number;
  coverage?: number;
  curvature?: number;
  fillRatio?: number;
  densityGPerMl?: number;
  servings?: number;
}): number {
  const diameter = input.diameterCm;
  const thickness = input.thicknessCm;
  const coverage = input.coverage ?? 1;
  if (!(diameter > 0) || !(thickness > 0) || !(coverage > 0)) return 0;
  const fill = input.fillRatio ?? 1;
  // `.cursorrules` 거듭제곱 회전체: 밥·국 기본 ceramic_bowl, 치수는 외경→내경 보정.
  const ml = bowlContentMl({
    diameterCm: diameter,
    heightCm: thickness,
    fillRatio: fill,
    kind: "ceramic_bowl",
    dimensionsAreOuter: true,
    material: "ceramic",
  });
  const grams = ml * (input.densityGPerMl ?? 1) * coverage;
  const servings = Math.max(0.25, input.servings ?? 1);
  return Math.max(1, Math.round(grams * servings));
}

export function pickWesternKcal(input: {
  volumeGrams: number;
  kcalPer100g: number;
  servingKcal?: number;
}): {
  kcal: number;
  grams: number;
  amountSource: string;
  usedServing: boolean;
} {
  const volumeKcal = Math.round(
    (Math.max(0, input.volumeGrams) * Math.max(0, input.kcalPer100g)) / 100,
  );
  const servingKcal = input.servingKcal ?? 0;
  if (servingKcal > 0) {
    const delta = Math.abs(volumeKcal - servingKcal) / servingKcal;
    if (delta < 0.1) {
      const grams =
        input.kcalPer100g > 0
          ? Math.max(1, Math.round((servingKcal * 100) / input.kcalPer100g))
          : input.volumeGrams;
      return {
        kcal: Math.round(servingKcal),
        grams,
        amountSource: "1인분 kcal (부피와 10% 이내)",
        usedServing: true,
      };
    }
  }
  return {
    kcal: volumeKcal,
    grams: Math.max(1, Math.round(input.volumeGrams)),
    amountSource: "손바닥으로 본 그릇 부피",
    usedServing: false,
  };
}

/** Read a free-typed amount. 줌 is side-dish volume. Any other unit stays as a count. */
export function parseAmountNote(raw: string | undefined): {
  handfuls: number;
  count: number;
  unit: string;
  label: string;
} {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { handfuls: 0, count: 0, unit: "", label: "" };
  const numberMatch = text.match(/(\d+(?:\.\d+)?)/);
  const halfHandful = /반\s*줌|줌\s*반/.test(text);
  const number = numberMatch ? Number(numberMatch[1]) : halfHandful ? 0.5 : 0;
  if (/줌/.test(text)) {
    const handfuls = number > 0 ? number : 1;
    return { handfuls, count: 0, unit: "줌", label: text };
  }
  const unit = text.replace(/\d+(?:\.\d+)?/g, "").replace(/\s+/g, "").trim();
  return {
    handfuls: 0,
    count: number > 0 ? number : 1,
    unit: unit || "개",
    label: text,
  };
}

/**
 * Resolve eaten grams from card inputs.
 * Korean: rice/soup = bowl. Other foods use the user's amount text.
 * 줌 uses handful volume. 장·개·봉지 등은 count × DB/host serving grams.
 * Western mains: bowl (caller may then pickServing).
 * Text: servingGrams × pieceCount.
 */
export function resolvePortionGrams(
  food: PortionRequest,
):
  | { ok: true; grams: number; amountSource: string }
  | { ok: false; message: string } {
  const name = food.name.trim() || "음식";
  const cuisine = food.cuisine ?? "korean";
  const role = food.role;
  const density = food.densityGPerMl ?? 1;

  if (
    cuisine === "text" ||
    (role === "snack" &&
      (food.pieceCount ?? 0) > 0 &&
      !(food.handfuls ?? 0))
  ) {
    const noted = parseAmountNote(food.amountNote);
    const serving = food.servingGrams ?? food.grams ?? 0;
    const pieces = food.pieceCount ?? (noted.count > 0 ? noted.count : 1);
    if (!(serving > 0)) {
      return {
        ok: false,
        message: `${name}의 기준 분량(g)이 필요합니다.`,
      };
    }
    return {
      ok: true,
      grams: Math.max(1, Math.round(serving * pieces)),
      amountSource: noted.label || `기준 분량 · ${pieces}배`,
    };
  }

  if (cuisine === "snack" || role === "snack") {
    const noted = parseAmountNote(food.amountNote);
    const handfuls =
      (food.handfuls ?? 0) > 0 ? (food.handfuls ?? 0) : noted.handfuls;
    if (handfuls > 0) {
      const volume = food.handfulVolumeMl ?? 0;
      if (!(volume > 0)) {
        return {
          ok: false,
          message: `${name} 줌 계산에 손 1줌 부피가 필요합니다.`,
        };
      }
      return {
        ok: true,
        grams: gramsFromHandfuls(handfuls, volume, density),
        amountSource: noted.label || `줌 ${handfuls}`,
      };
    }
    const pieces =
      (food.pieceCount ?? 0) > 0 ? (food.pieceCount ?? 0) : noted.count;
    const serving = food.servingGrams ?? food.grams ?? 0;
    if (pieces > 0 && serving > 0) {
      return {
        ok: true,
        grams: Math.max(1, Math.round(serving * pieces)),
        amountSource: noted.label || `${pieces}${noted.unit || "개"}`,
      };
    }
    if (pieces > 0 && (food.kcalPerUnit ?? 0) > 0 && food.nameConfirmed) {
      return {
        ok: true,
        grams: Math.max(1, pieces),
        amountSource: noted.label || `${pieces}${noted.unit || "개"}`,
      };
    }
    return {
      ok: false,
      message: noted.label
        ? `${name} ${noted.label}의 1${noted.unit || "개"} 기준 g가 필요합니다.`
        : `${name}의 양을 단위와 함께 적어 주세요. 예: 1줌, 2장, 3개`,
    };
  }

  const isRiceOrSoup =
    role === "rice" ||
    role === "soup" ||
    (cuisine === "korean" && role === "main" && /밥|국|찌개|탕/.test(name));
  const isHandfulSide =
    role === "side" || role === "meat" || role === "fried";

  if (cuisine === "korean" && isHandfulSide && !isRiceOrSoup) {
    const noted = parseAmountNote(food.amountNote);
    const handfuls =
      (food.handfuls ?? 0) > 0 ? (food.handfuls ?? 0) : noted.handfuls;
    const pieces =
      (food.pieceCount ?? 0) > 0 ? (food.pieceCount ?? 0) : noted.count;
    if (handfuls > 0) {
      const volume = food.handfulVolumeMl ?? 0;
      if (!(volume > 0)) {
        return {
          ok: false,
          message: `${name} 줌 계산에 손 1줌 부피가 필요합니다.`,
        };
      }
      return {
        ok: true,
        grams: gramsFromHandfuls(handfuls, volume, density),
        amountSource: noted.label || `줌 ${handfuls}`,
      };
    }
    const serving = food.servingGrams ?? food.grams ?? 0;
    if (pieces > 0 && serving > 0) {
      return {
        ok: true,
        grams: Math.max(1, Math.round(serving * pieces)),
        amountSource: noted.label || `${pieces}${noted.unit || "개"}`,
      };
    }
    if (pieces > 0 && (food.kcalPerUnit ?? 0) > 0 && food.nameConfirmed) {
      return {
        ok: true,
        grams: Math.max(1, pieces),
        amountSource: noted.label || `${pieces}${noted.unit || "개"}`,
      };
    }
    if (pieces > 0) {
      return {
        ok: false,
        message: `${name} ${noted.label || `${pieces}${noted.unit || "개"}`}의 1${noted.unit || "개"} 기준 g가 필요합니다.`,
      };
    }
    return {
      ok: false,
      message: `${name}의 양을 단위와 함께 적어 주세요. 예: 1줌, 2장, 3개`,
    };
  }

  const diameter = food.containerDiameterCm ?? 0;
  const thickness = food.thicknessCm ?? 0;
  const coverage = food.coverage ?? 1;
  if (diameter > 0 && thickness > 0 && coverage > 0) {
    const grams = vesselGrams({
      diameterCm: diameter,
      thicknessCm: thickness,
      coverage,
      curvature: food.curvature,
      fillRatio: food.fillRatio,
      densityGPerMl: density,
      servings: food.servings,
    });
    if (grams > 0) {
      return {
        ok: true,
        grams,
        amountSource:
          (food.servings ?? 1) > 1
            ? `그릇 부피 · ${food.servings}인분`
            : "손바닥으로 본 그릇 부피",
      };
    }
  }

  const direct = food.grams ?? food.servingGrams ?? 0;
  if (direct > 0) {
    const pieces = food.pieceCount && food.pieceCount > 0 ? food.pieceCount : 1;
    return {
      ok: true,
      grams: Math.max(1, Math.round(direct * pieces)),
      amountSource:
        food.servingGrams && food.servingGrams > 0
          ? `기준 분량 · ${pieces}배`
          : "손바닥과 비교한 사진 속 양",
    };
  }

  return {
    ok: false,
    message: `${name}의 양(그릇·줌·기준 분량)을 넣으세요.`,
  };
}

/** Photo bowls and 줌 need a saved hand. Text-only and non-줌 units do not. */
export function portionNeedsSavedHand(
  food: Pick<
    PortionRequest,
    "cuisine" | "role" | "handfuls" | "amountNote" | "containerDiameterCm"
  >,
): boolean {
  const cuisine = food.cuisine ?? "korean";
  if (cuisine === "text") return false;
  const noted = parseAmountNote(food.amountNote);
  const usesHandful = (food.handfuls ?? 0) > 0 || noted.handfuls > 0;
  if (cuisine === "snack" || food.role === "snack") return usesHandful;
  if (
    food.role === "rice" ||
    food.role === "soup" ||
    (food.containerDiameterCm ?? 0) > 0
  ) {
    return true;
  }
  return usesHandful;
}

function kcalPer100FromBasis(basis: string, kcalPerBasis: number): number {
  if (!(kcalPerBasis > 0)) return 0;
  const amount = Number.parseFloat(basis);
  const base = Number.isFinite(amount) && amount > 0 ? amount : 100;
  return (kcalPerBasis * 100) / base;
}

function scaleMacro(value: number, ratio: number): number {
  return Math.round(value * ratio * 10) / 10;
}

/**
 * After grams are resolved and the food DB is queried:
 * western (or a main that arrived with servingKcal) uses the 10% serving test.
 * A database miss uses kcalPerUnit (one user unit), not kcal per gram.
 * Macros scale by chosen grams / lookup grams when kcal is overridden.
 */
export function finalizePortionEnergy(input: {
  cuisine?: MealCuisine;
  role: MealPortionRole;
  volumeGrams: number;
  servingKcal?: number;
  kcalPer100g?: number;
  /** How many user units were eaten (줌 횟수, 장 수). */
  unitCount?: number;
  unitLabel?: string;
  /** kcal of one of those units. */
  kcalPerUnit?: number;
  carbPerUnit?: number;
  proteinPerUnit?: number;
  fatPerUnit?: number;
  lookup: {
    matched: boolean;
    grams: number;
    kcal: number;
    carbG: number;
    proteinG: number;
    fatG: number;
    basis: string;
    kcalPerBasis: number;
    servingWeight: string | null;
  };
}): {
  grams: number;
  kcal: number;
  carbG: number;
  proteinG: number;
  fatG: number;
  amountSource?: string;
} {
  const requestKcalPer100 = input.kcalPer100g ?? 0;
  const dbKcalPer100 = input.lookup.matched
    ? kcalPer100FromBasis(input.lookup.basis, input.lookup.kcalPerBasis)
    : 0;
  const kcalPer100g = dbKcalPer100 > 0 ? dbKcalPer100 : requestKcalPer100;
  const requestServing = input.servingKcal ?? 0;
  const servingG = Number.parseFloat(input.lookup.servingWeight ?? "");
  const dbServingKcal =
    input.lookup.matched &&
    Number.isFinite(servingG) &&
    servingG > 0 &&
    kcalPer100g > 0
      ? Math.round((kcalPer100g * servingG) / 100)
      : 0;
  const servingKcal = requestServing > 0 ? requestServing : dbServingKcal;
  const western =
    input.cuisine === "western" ||
    (input.role === "main" && requestServing > 0);

  let grams = input.lookup.grams > 0 ? input.lookup.grams : input.volumeGrams;
  let kcal = input.lookup.kcal;
  let carbG = input.lookup.carbG;
  let proteinG = input.lookup.proteinG;
  let fatG = input.lookup.fatG;
  let amountSource: string | undefined;

  if (western && input.volumeGrams > 0 && kcalPer100g > 0) {
    const picked = pickWesternKcal({
      volumeGrams: input.volumeGrams,
      kcalPer100g,
      servingKcal: servingKcal > 0 ? servingKcal : undefined,
    });
    const ratio = grams > 0 ? picked.grams / grams : 1;
    grams = picked.grams;
    kcal = picked.kcal;
    carbG = scaleMacro(carbG, ratio);
    proteinG = scaleMacro(proteinG, ratio);
    fatG = scaleMacro(fatG, ratio);
    amountSource = picked.amountSource;
  } else if (western && servingKcal > 0 && !(kcalPer100g > 0)) {
    kcal = Math.round(servingKcal);
    amountSource = "1인분 kcal";
  } else if (!input.lookup.matched && (input.kcalPerUnit ?? 0) > 0 && (input.unitCount ?? 0) > 0) {
    const count = input.unitCount ?? 0;
    grams = Math.max(1, Math.round(input.volumeGrams > 0 ? input.volumeGrams : grams));
    kcal = Math.round(count * (input.kcalPerUnit ?? 0));
    carbG = Math.round(count * (input.carbPerUnit ?? 0) * 10) / 10;
    proteinG = Math.round(count * (input.proteinPerUnit ?? 0) * 10) / 10;
    fatG = Math.round(count * (input.fatPerUnit ?? 0) * 10) / 10;
    amountSource = input.unitLabel || `${count}단위`;
  } else if (!input.lookup.matched && requestKcalPer100 > 0 && input.volumeGrams > 0) {
    grams = Math.max(1, Math.round(input.volumeGrams));
    kcal = Math.round((grams * requestKcalPer100) / 100);
    const ratio =
      input.lookup.grams > 0 ? grams / input.lookup.grams : 1;
    carbG = scaleMacro(carbG, ratio);
    proteinG = scaleMacro(proteinG, ratio);
    fatG = scaleMacro(fatG, ratio);
  }

  return { grams, kcal, carbG, proteinG, fatG, amountSource };
}

export type StoredPortion = {
  slot: number;
  meal: string;
  query: string;
  foodName: string;
  role: MealPortionRole;
  grams: number;
  kcal: number;
  carbG: number;
  proteinG: number;
  fatG: number;
  basis: string;
  kcalPerBasis: number;
  matched: boolean;
  amountSource: string;
  needsConfirm?: boolean;
  /** Exact miss with DB candidates — card shows a pick list. */
  needsCandidatePick?: boolean;
  candidates?: {
    foodName: string;
    kcal: number;
    servingWeight: string;
  }[];
  /** Host photo judgment: personal bowl diameter or shared pot → 줌. */
  needsVesselHint?: boolean;
  sharedPot?: boolean;
  photoDiameterCm?: number;
  thicknessCm?: number;
  /** Photo has no palm — card must ask for a retake. */
  handMissing?: boolean;
  needsHandRetry?: boolean;
  handInPhoto?: boolean;
  kcalPer100g?: number;
  kcalPerUnit?: number;
  carbPerUnit?: number;
  proteinPerUnit?: number;
  fatPerUnit?: number;
  unit?: string;
  webMiss?: boolean;
  servingGrams?: number;
};

const ROLES: MealPortionRole[] = [
  "main",
  "side",
  "soup",
  "rice",
  "meat",
  "fried",
  "snack",
];

export function parseStoredPortions(raw: string): StoredPortion[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const role = row.role;
      if (typeof role !== "string" || !ROLES.includes(role as MealPortionRole)) {
        return [];
      }
      const needsConfirm = row.needsConfirm === true;
      const needsVesselHint = row.needsVesselHint === true;
      const handMissing = row.handMissing === true;
      const needsHandRetry = row.needsHandRetry === true;
      const grams = Number(row.grams);
      if (
        needsConfirm || needsVesselHint || handMissing || needsHandRetry
          ? !(grams >= 0)
          : !(grams > 0)
      ) {
        return [];
      }
      const meal = typeof row.meal === "string" ? row.meal : "lunch";
      return [
        {
          slot: Number(row.slot) || 1,
          meal,
          query: typeof row.query === "string" ? row.query : "",
          foodName: typeof row.foodName === "string" ? row.foodName : "",
          role: role as MealPortionRole,
          grams: Math.round(grams),
          kcal: Math.round(Number(row.kcal) || 0),
          carbG: Math.round((Number(row.carbG) || 0) * 10) / 10,
          proteinG: Math.round((Number(row.proteinG) || 0) * 10) / 10,
          fatG: Math.round((Number(row.fatG) || 0) * 10) / 10,
          basis: typeof row.basis === "string" ? row.basis : "100g",
          kcalPerBasis: Number(row.kcalPerBasis) || 0,
          matched: row.matched === true,
          amountSource:
            typeof row.amountSource === "string" ? row.amountSource : "",
          needsConfirm,
          needsVesselHint,
          sharedPot: row.sharedPot === true,
          photoDiameterCm: Number(row.photoDiameterCm) || 0,
          thicknessCm: Number(row.thicknessCm) || 0,
          handMissing,
          needsHandRetry,
          handInPhoto:
            row.handInPhoto === true
              ? true
              : row.handInPhoto === false
                ? false
                : undefined,
          needsCandidatePick: row.needsCandidatePick === true,
          candidates: Array.isArray(row.candidates)
            ? row.candidates.flatMap((entry) => {
                if (!entry || typeof entry !== "object") return [];
                const cand = entry as Record<string, unknown>;
                const foodName =
                  typeof cand.foodName === "string" ? cand.foodName.trim() : "";
                if (!foodName) return [];
                return [
                  {
                    foodName,
                    kcal: Number(cand.kcal) || 0,
                    servingWeight:
                      typeof cand.servingWeight === "string"
                        ? cand.servingWeight
                        : "",
                  },
                ];
              })
            : [],
          kcalPer100g: Number(row.kcalPer100g) || 0,
          kcalPerUnit: Number(row.kcalPerUnit) || 0,
          carbPerUnit: Number(row.carbPerUnit) || 0,
          proteinPerUnit: Number(row.proteinPerUnit) || 0,
          fatPerUnit: Number(row.fatPerUnit) || 0,
          unit: typeof row.unit === "string" ? row.unit : "",
          webMiss: row.webMiss === true,
          servingGrams: Number(row.servingGrams) || 0,
        },
      ];
    });
  } catch {
    return [];
  }
}
