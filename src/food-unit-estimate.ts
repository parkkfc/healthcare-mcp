/**
 * Workers AI text draft for 1-unit kcal + macros when K-FCDB misses.
 * Vision is never used — host still owns photo reading.
 */

export type UnitNutritionDraft = {
  foodName: string;
  unit: string;
  kcalPerUnit: number;
  carbPerUnit: number;
  proteinPerUnit: number;
  fatPerUnit: number;
  /** Weight of one unit (g). 0 when unknown (줌 uses the saved hand; 100g is already 100). */
  gramsPerUnit: number;
  estimatedBy: "workers-ai";
  source: string;
  draft: true;
};

const UNIT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

function clampKcal(n: number): number {
  return Math.round(Math.min(2000, Math.max(1, n)));
}

function clampMacro(n: number): number {
  return Math.round(Math.min(500, Math.max(0, n)) * 10) / 10;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(body.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function normalizeUnitNutritionDraft(input: {
  foodName: string;
  unit: string;
  kcalPerUnit: number;
  carbPerUnit: number;
  proteinPerUnit: number;
  fatPerUnit: number;
  gramsPerUnit?: number;
  source?: string;
}): UnitNutritionDraft {
  const foodName = input.foodName.trim();
  const unit = input.unit.trim() || "1개";
  if (!foodName) throw new Error("foodName이 비어 있습니다.");
  const kcalPerUnit = clampKcal(Number(input.kcalPerUnit));
  const carbPerUnit = clampMacro(Number(input.carbPerUnit));
  const proteinPerUnit = clampMacro(Number(input.proteinPerUnit));
  const fatPerUnit = clampMacro(Number(input.fatPerUnit));
  if (!(kcalPerUnit > 0)) {
    throw new Error("kcalPerUnit은 0보다 커야 합니다.");
  }
  const rawGrams = Number(input.gramsPerUnit);
  const gramsPerUnit =
    Number.isFinite(rawGrams) && rawGrams > 0
      ? Math.round(Math.min(2000, rawGrams))
      : 0;
  return {
    foodName,
    unit,
    kcalPerUnit,
    carbPerUnit,
    proteinPerUnit,
    fatPerUnit,
    gramsPerUnit,
    estimatedBy: "workers-ai",
    source: (input.source ?? "").trim() || "workers-ai",
    draft: true,
  };
}

type AiBinding = {
  run: (
    model: string,
    inputs: {
      messages: { role: string; content: string }[];
      max_tokens?: number;
    },
  ) => Promise<unknown>;
};

/** Call Workers AI for a 1-unit nutrition JSON draft. */
export async function estimateUnitNutritionWithWorkersAi(
  ai: AiBinding,
  input: { foodName: string; unit: string },
): Promise<UnitNutritionDraft> {
  const foodName = input.foodName.trim();
  const unit = input.unit.trim() || "1개";
  if (!foodName) throw new Error("foodName이 비어 있습니다.");

  const prompt = `한국 일반식 기준으로 "${foodName}"의 "${unit}"당 영양을 추정하라.
반드시 JSON 한 객체만 출력하라. 설명·마크다운 금지.
키: kcalPerUnit(number), carbPerUnit(g), proteinPerUnit(g), fatPerUnit(g), gramsPerUnit(number, 그 1단위의 무게 g), source(string 한 줄).
줌이면 손 1줌(~밥숟가락 부피) 기준이고 gramsPerUnit은 0. 장·개·봉지는 그 1단위이고 gramsPerUnit에 1개 무게(g)를 넣는다.
단위가 "100g"이면 100g당 영양이고 gramsPerUnit은 100이다.`;

  const result = await ai.run(UNIT_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You estimate Korean food nutrition per user unit. Reply with JSON only.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 220,
  });

  const text =
    typeof result === "string"
      ? result
      : result && typeof result === "object" && "response" in result
        ? String((result as { response?: unknown }).response ?? "")
        : JSON.stringify(result);

  const row = extractJsonObject(text);
  if (!row) {
    throw new Error("영양 초안 JSON을 파싱하지 못했습니다.");
  }

  return normalizeUnitNutritionDraft({
    foodName,
    unit,
    kcalPerUnit: Number(row.kcalPerUnit),
    carbPerUnit: Number(row.carbPerUnit),
    proteinPerUnit: Number(row.proteinPerUnit),
    fatPerUnit: Number(row.fatPerUnit),
    gramsPerUnit: Number(row.gramsPerUnit),
    source:
      typeof row.source === "string" ? row.source : "workers-ai draft",
  });
}
