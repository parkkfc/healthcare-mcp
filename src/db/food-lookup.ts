import { sql, type SQL } from "drizzle-orm";
import type { getDb } from "./client.js";

export const nutrientSource = {
  ko: "식품영양성분 데이터베이스",
  en: "Korean Food Composition Database system(K-FCDB)",
} as const;

type Database = Awaited<ReturnType<typeof getDb>>;

type FoodRow = {
  foodCode: string;
  foodName: string;
  category: string;
  basis: string;
  kcal: number | null;
  carbG: number | null;
  proteinG: number | null;
  fatG: number | null;
  servingRef: string | null;
  servingWeight: string | null;
};

const foodColumns = sql`
  f.food_code AS foodCode,
  f.food_name AS foodName,
  f.category AS category,
  f.basis AS basis,
  f.kcal AS kcal,
  f.carb_g AS carbG,
  f.protein_g AS proteinG,
  f.fat_g AS fatG,
  f.serving_ref AS servingRef,
  f.serving_weight AS servingWeight
`;

function isFoodRow(value: unknown): value is FoodRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.foodCode === "string" &&
    typeof row.foodName === "string" &&
    typeof row.category === "string" &&
    typeof row.basis === "string"
  );
}

function basisAmount(basis: string): number {
  const amount = Number.parseFloat(basis);
  return Number.isFinite(amount) && amount > 0 ? amount : 100;
}

function scale(amountPerBasis: number | null, grams: number, basis: string): number {
  if (amountPerBasis === null) return 0;
  return (amountPerBasis * grams) / basisAmount(basis);
}

function ftsMatch(name: string): string | null {
  const cleaned = name.replace(/["*()^:]/g, " ").replace(/\s+/g, " ").trim();
  if ([...cleaned].length < 3) return null;
  return `"${cleaned}"`;
}

function likePattern(name: string): string {
  return `%${name.replace(/[%_]/g, "").trim()}%`;
}

async function firstFood(db: Database, query: SQL): Promise<FoodRow | null> {
  const row: unknown = await db.get(query);
  return isFoodRow(row) ? row : null;
}

async function findFoodByExactName(
  db: Database,
  name: string,
): Promise<FoodRow | null> {
  return firstFood(
    db,
    sql`
      SELECT ${foodColumns}
      FROM foods f
      WHERE f.food_name = ${name}
      LIMIT 1
    `,
  );
}

async function findFood(db: Database, name: string): Promise<FoodRow | null> {
  const match = ftsMatch(name);
  if (match) {
    try {
      const found = await firstFood(
        db,
        sql`
          SELECT ${foodColumns}
          FROM foods_fts
          JOIN foods f ON f.id = foods_fts.rowid
          WHERE foods_fts MATCH ${match}
          ORDER BY
            CASE
              WHEN f.food_name = ${name} THEN 0
              WHEN f.food_name LIKE ${`${name}%`} THEN 1
              WHEN f.category = '음식' THEN 2
              ELSE 3
            END,
            bm25(foods_fts)
          LIMIT 1
        `,
      );
      if (found) return found;
    } catch {
      // A short or unusual name can make the trigram query invalid.
    }
  }

  return firstFood(
    db,
    sql`
      SELECT ${foodColumns}
      FROM foods f
      WHERE f.food_name LIKE ${likePattern(name)}
      ORDER BY
        CASE
          WHEN f.food_name = ${name} THEN 0
          WHEN f.food_name LIKE ${`${name}%`} THEN 1
          WHEN f.category = '음식' THEN 2
          ELSE 3
        END,
        length(f.food_name)
      LIMIT 1
    `,
  );
}

export type ConfirmableFood = {
  foodName: string;
  basis: string;
  kcal: number | null;
  carbG: number | null;
  proteinG: number | null;
  fatG: number | null;
  servingWeight: string | null;
};

export async function findExactFood(
  db: Database,
  name: string,
): Promise<ConfirmableFood | null> {
  const row = await findFoodByExactName(db, name.trim());
  if (!row) return null;
  return {
    foodName: row.foodName,
    basis: row.basis,
    kcal: row.kcal,
    carbG: row.carbG,
    proteinG: row.proteinG,
    fatG: row.fatG,
    servingWeight: row.servingWeight,
  };
}

function toConfirmable(row: FoodRow): ConfirmableFood {
  return {
    foodName: row.foodName,
    basis: row.basis,
    kcal: row.kcal,
    carbG: row.carbG,
    proteinG: row.proteinG,
    fatG: row.fatG,
    servingWeight: row.servingWeight,
  };
}

/** Rank: exact → variant prefix (김,) → starts with → contains. Prefer shorter names. */
function candidateRank(query: string, foodName: string): number {
  if (foodName === query) return 0;
  if (
    foodName.startsWith(`${query},`) ||
    foodName.startsWith(`${query} (`) ||
    foodName.startsWith(`${query}(`) ||
    foodName.startsWith(`${query}·`)
  ) {
    return 1;
  }
  if (foodName.startsWith(query)) return 2;
  if (foodName.includes(query)) return 3;
  return 4;
}

async function searchFoodCandidatesOne(
  db: Database,
  name: string,
  limit: number,
): Promise<ConfirmableFood[]> {
  const trimmed = name.replace(/[%_]/g, "").trim();
  if (!trimmed) return [];
  const cap = Math.min(Math.max(limit, 1), 12);
  const contains = likePattern(trimmed);
  const rows: unknown = await db.all(sql`
    SELECT ${foodColumns}
    FROM foods f
    WHERE f.food_name = ${trimmed}
       OR f.food_name LIKE ${`${trimmed}%`}
       OR f.food_name LIKE ${contains}
    ORDER BY
      CASE
        WHEN f.food_name = ${trimmed} THEN 0
        WHEN f.food_name LIKE ${`${trimmed},%`}
          OR f.food_name LIKE ${`${trimmed} (%`}
          OR f.food_name LIKE ${`${trimmed}(%`}
          OR f.food_name LIKE ${`${trimmed}·%`}
          THEN 1
        WHEN f.food_name LIKE ${`${trimmed}%`} THEN 2
        ELSE 3
      END,
      length(f.food_name)
    LIMIT ${cap}
  `);
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => (isFoodRow(row) ? [toConfirmable(row)] : []));
}

/**
 * DB hits for photo/host compare and card pick lists.
 * Exact → prefix → contains; merge multiple queries (typed + synonyms).
 */
export async function searchFoodCandidates(
  db: Database,
  name: string,
  limit = 8,
): Promise<ConfirmableFood[]> {
  return searchFoodCandidatesMany(db, [name], limit);
}

/** Merge candidate searches for the typed name plus host synonyms (계란 + 달걀). */
export async function searchFoodCandidatesMany(
  db: Database,
  names: string[],
  limit = 8,
): Promise<ConfirmableFood[]> {
  const cap = Math.min(Math.max(limit, 1), 12);
  const queries = [
    ...new Set(
      names
        .map((name) => name.replace(/[%_]/g, "").trim())
        .filter(Boolean),
    ),
  ];
  if (queries.length === 0) return [];
  const primary = queries[0] ?? "";
  const batches = await Promise.all(
    queries.map((query) => searchFoodCandidatesOne(db, query, cap)),
  );
  const byName = new Map<string, ConfirmableFood>();
  for (const batch of batches) {
    for (const food of batch) {
      if (!byName.has(food.foodName)) byName.set(food.foodName, food);
    }
  }
  return [...byName.values()]
    .sort((a, b) => {
      const rankA = Math.min(
        ...queries.map((query) => candidateRank(query, a.foodName)),
      );
      const rankB = Math.min(
        ...queries.map((query) => candidateRank(query, b.foodName)),
      );
      if (rankA !== rankB) return rankA - rankB;
      const primaryA = candidateRank(primary, a.foodName);
      const primaryB = candidateRank(primary, b.foodName);
      if (primaryA !== primaryB) return primaryA - primaryB;
      return a.foodName.length - b.foodName.length;
    })
    .slice(0, cap);
}
export async function findConfirmableFood(
  db: Database,
  name: string,
): Promise<ConfirmableFood | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const row = await firstFood(
    db,
    sql`
      SELECT ${foodColumns}
      FROM foods f
      WHERE f.food_name = ${trimmed}
         OR f.food_name LIKE ${`${trimmed},%`}
         OR f.food_name LIKE ${`${trimmed} (%`}
         OR f.food_name LIKE ${`${trimmed}(%`}
         OR f.food_name LIKE ${`${trimmed}·%`}
      ORDER BY
        CASE WHEN f.food_name = ${trimmed} THEN 0 ELSE 1 END,
        length(f.food_name)
      LIMIT 1
    `,
  );
  if (!row) return null;
  return {
    foodName: row.foodName,
    basis: row.basis,
    kcal: row.kcal,
    carbG: row.carbG,
    proteinG: row.proteinG,
    fatG: row.fatG,
    servingWeight: row.servingWeight,
  };
}

export async function lookupFoods(
  db: Database,
  foods: {
    foodName: string;
    grams: number;
    exact?: boolean;
    /** exact: 음식 이름이 같을 때만. 반찬을 더 긴 다른 음식으로 바꾸지 않는다. */
    nameMatch?: "exact" | "fuzzy";
  }[],
) {
  return Promise.all(
    foods.map(async (food) => {
      const name = food.foodName.trim();
      const row =
        name.length === 0
          ? null
          : food.nameMatch === "exact"
            ? await findFoodByExactName(db, name)
            : await findFood(db, name);
      const servingWeight = row?.servingWeight ?? "";
      const parsedServing = Number.parseFloat(servingWeight);
      // exact: 호출자가 정한 그램만 쓴다. 0이면 1회 섭취참고량으로 채우지 않는다.
      const grams =
        food.grams > 0
          ? food.grams
          : food.exact
            ? 0
            : Number.isFinite(parsedServing) && parsedServing > 0
              ? parsedServing
              : 100;
      const basis = row?.basis ?? "100g";
      const kcalPerBasis = row?.kcal ?? 0;
      const carbPerBasis = row?.carbG ?? 0;
      const proteinPerBasis = row?.proteinG ?? 0;
      const fatPerBasis = row?.fatG ?? 0;
      return {
        query: name,
        matched: row !== null,
        foodCode: row?.foodCode ?? "",
        foodName: row?.foodName ?? name,
        category: row?.category ?? "",
        basis,
        grams,
        kcalPerBasis,
        carbPerBasis,
        proteinPerBasis,
        fatPerBasis,
        kcal: Math.round(scale(kcalPerBasis, grams, basis)),
        carbG: Math.round(scale(carbPerBasis, grams, basis) * 10) / 10,
        proteinG: Math.round(scale(proteinPerBasis, grams, basis) * 10) / 10,
        fatG: Math.round(scale(fatPerBasis, grams, basis) * 10) / 10,
        servingRef: row?.servingRef ?? "",
        servingWeight,
      };
    }),
  );
}
