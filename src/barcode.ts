import type { getDb } from "./db/client.js";
import { lookupFoods, nutrientSource } from "./db/food-lookup.js";

/**
 * Barcode to nutrients. The local food table has no barcodes, so the product
 * comes from Open Food Facts. When that record has no energy value, the
 * product name is searched in the Korean food composition table instead.
 */

type Database = Awaited<ReturnType<typeof getDb>>;

export const openFoodFactsSource = {
  ko: "Open Food Facts",
  en: "Open Food Facts (ODbL)",
} as const;

export type BarcodeProduct = {
  found: boolean;
  barcode: string;
  productName: string;
  brand: string;
  kcalPer100: number;
  carbPer100: number;
  proteinPer100: number;
  fatPer100: number;
  /** Package or serving weight in g. 0 when unknown. */
  servingG: number;
  source: { ko: string; en: string };
  message: string;
};

export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

function numberAt(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function textAt(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function notFound(barcode: string, message: string): BarcodeProduct {
  return {
    found: false,
    barcode,
    productName: "",
    brand: "",
    kcalPer100: 0,
    carbPer100: 0,
    proteinPer100: 0,
    fatPer100: 0,
    servingG: 0,
    source: openFoodFactsSource,
    message,
  };
}

export async function lookupBarcode(
  db: Database,
  rawBarcode: string,
): Promise<BarcodeProduct> {
  const barcode = normalizeBarcode(rawBarcode);
  if (!barcode) {
    return notFound(
      rawBarcode,
      "바코드는 숫자 8~14자리입니다. 다시 스캔하거나 숫자를 적어 주세요.",
    );
  }

  let body: unknown;
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=code,product_name,product_name_ko,brands,nutriments,serving_quantity,product_quantity`,
      { headers: { "User-Agent": "HandsOnDiet/0.1 (healthcare-mcp)" } },
    );
    if (response.status === 404) {
      return notFound(
        barcode,
        "이 바코드는 등록된 제품 정보가 없습니다. 음식 이름을 적어서 기록해 주세요.",
      );
    }
    if (!response.ok) {
      return notFound(
        barcode,
        `제품 조회가 실패했습니다(HTTP ${response.status}). 잠시 뒤 다시 시도해 주세요.`,
      );
    }
    body = await response.json();
  } catch {
    return notFound(
      barcode,
      "제품 조회 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    );
  }

  const product = isRecord(body) && isRecord(body.product) ? body.product : null;
  if (!product) {
    return notFound(
      barcode,
      "이 바코드는 등록된 제품 정보가 없습니다. 음식 이름을 적어서 기록해 주세요.",
    );
  }

  const productName =
    textAt(product, "product_name_ko") || textAt(product, "product_name");
  const brand = textAt(product, "brands");
  const servingG =
    numberAt(product, "serving_quantity") ??
    numberAt(product, "product_quantity") ??
    0;
  const nutriments = isRecord(product.nutriments) ? product.nutriments : {};
  const kcal = numberAt(nutriments, "energy-kcal_100g");

  if (kcal !== null) {
    return {
      found: true,
      barcode,
      productName: productName || `바코드 ${barcode}`,
      brand,
      kcalPer100: kcal,
      carbPer100: numberAt(nutriments, "carbohydrates_100g") ?? 0,
      proteinPer100: numberAt(nutriments, "proteins_100g") ?? 0,
      fatPer100: numberAt(nutriments, "fat_100g") ?? 0,
      servingG,
      source: openFoodFactsSource,
      message: "",
    };
  }

  if (productName.length > 0) {
    const [match] = await lookupFoods(db, [{ foodName: productName, grams: 100 }]);
    if (match?.matched && !match.basis.toLowerCase().includes("ml")) {
      const basis = Number.parseFloat(match.basis) || 100;
      const per100 = (value: number) => Math.round((value * 1000) / basis) / 10;
      return {
        found: true,
        barcode,
        productName: match.foodName,
        brand,
        kcalPer100: per100(match.kcalPerBasis),
        carbPer100: per100(match.carbPerBasis),
        proteinPer100: per100(match.proteinPerBasis),
        fatPer100: per100(match.fatPerBasis),
        servingG,
        source: nutrientSource,
        message: "",
      };
    }
  }

  return notFound(
    barcode,
    productName.length > 0
      ? `${productName}은(는) 찾았지만 영양 성분이 등록되어 있지 않습니다. 음식 이름을 적어서 기록해 주세요.`
      : "이 바코드는 영양 성분이 등록되어 있지 않습니다. 음식 이름을 적어서 기록해 주세요.",
  );
}
