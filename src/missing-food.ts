import type { getDb } from "./db/client.js";
import { findExactFood } from "./db/food-lookup.js";

type Database = Awaited<ReturnType<typeof getDb>>;

export type MissingFoodProposal = {
  candidateName: string;
  kcalPerUnit: number;
  gramsPerUnit: number;
  carbPerUnit: number;
  proteinPerUnit: number;
  fatPerUnit: number;
  /** True when this request has no 1-unit kcal yet. The host fills it. */
  webMiss: boolean;
};

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

/** The label is the typed name, or that name plus a separator. Not 김밥 for 김. */
export function sameFoodLabel(query: string, label: string): boolean {
  const q = query.trim().toLowerCase();
  const n = label.trim().toLowerCase();
  if (!q || !n) return false;
  if (n === q) return true;
  if (!n.startsWith(q)) return false;
  const next = n.charAt(q.length);
  return /[\s,.(/·]/.test(next);
}

/** Only search string allowed if the host looks on the web. */
export function foodEnergySearchQuery(name: string, unit: string) {
  return `${name.trim()} ${unit.trim()} 열량`;
}

function basisAmount(basis: string): number {
  const amount = Number.parseFloat(basis);
  return Number.isFinite(amount) && amount > 0 ? amount : 100;
}

/** kcal of one user unit. 줌 uses the saved handful. Other units use one serving. */
export function nutritionForOneUnit(input: {
  basis: string;
  kcal: number;
  carbG: number;
  proteinG: number;
  fatG: number;
  servingGrams?: number;
  unit: string;
  handfulVolumeMl?: number;
  density?: number;
}): Omit<MissingFoodProposal, "candidateName" | "webMiss"> | null {
  if (!(input.kcal > 0)) return null;
  const basis = basisAmount(input.basis);
  const perMl = /ml/i.test(input.basis);
  let amount = 0;
  if (input.unit === "100g") {
    // Rice/soup bowl: the card asks for kcal per 100 g, then volume × density → g.
    amount = 100;
  } else if (input.unit === "줌") {
    const ml = input.handfulVolumeMl ?? 0;
    if (!(ml > 0)) return null;
    amount = perMl ? ml : ml * (input.density ?? 1);
  } else {
    const serving = input.servingGrams ?? 0;
    // No packaging weight: treat one user unit as one DB basis (usually 100g).
    amount = serving > 0 ? serving : basis;
  }
  if (!(amount > 0)) return null;
  const ratio = amount / basis;
  const kcalPerUnit = Math.round(input.kcal * ratio);
  if (!(kcalPerUnit > 0)) return null;
  return {
    kcalPerUnit,
    gramsPerUnit: Math.max(1, Math.round(amount)),
    carbPerUnit: round1(input.carbG * ratio),
    proteinPerUnit: round1(input.proteinG * ratio),
    fatPerUnit: round1(input.fatG * ratio),
  };
}

/** Host kcal, or a DB row the host picked after seeing the photo. No web fetch. */
export async function proposeMissingFood(
  db: Database,
  input: {
    name: string;
    unit: string;
    handfulVolumeMl?: number;
    density?: number;
    kcalPerUnit?: number;
    candidateName?: string;
    matchedFoodName?: string;
    servingGrams?: number;
    carbPerUnit?: number;
    proteinPerUnit?: number;
    fatPerUnit?: number;
  },
): Promise<MissingFoodProposal> {
  const name = input.name.trim();
  if ((input.kcalPerUnit ?? 0) > 0) {
    return {
      candidateName: input.candidateName?.trim() || name,
      kcalPerUnit: input.kcalPerUnit ?? 0,
      gramsPerUnit: input.servingGrams ?? 0,
      carbPerUnit: input.carbPerUnit ?? 0,
      proteinPerUnit: input.proteinPerUnit ?? 0,
      fatPerUnit: input.fatPerUnit ?? 0,
      webMiss: false,
    };
  }
  const pickedName = input.matchedFoodName?.trim() ?? "";
  if (pickedName) {
    const row = await findExactFood(db, pickedName);
    if (row && (row.kcal ?? 0) > 0) {
      const serving = Number.parseFloat(row.servingWeight ?? "");
      const picked = nutritionForOneUnit({
        basis: row.basis,
        kcal: row.kcal ?? 0,
        carbG: row.carbG ?? 0,
        proteinG: row.proteinG ?? 0,
        fatG: row.fatG ?? 0,
        servingGrams: Number.isFinite(serving) ? serving : 0,
        unit: input.unit,
        handfulVolumeMl: input.handfulVolumeMl,
        density: input.density,
      });
      if (picked) {
        return { candidateName: row.foodName, webMiss: false, ...picked };
      }
    }
  }
  return {
    candidateName: name,
    kcalPerUnit: 0,
    gramsPerUnit: 0,
    carbPerUnit: 0,
    proteinPerUnit: 0,
    fatPerUnit: 0,
    webMiss: true,
  };
}
