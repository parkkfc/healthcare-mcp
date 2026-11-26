import type { MealPortionRole } from "./meal-portions.js";

/**
 * Fallback bulk density (g/ml) when the host omits densityGPerMl.
 * Prefer host judgment on write-meal-foods items / lookup foods.
 * Water is 1.0; banchan is usually lighter. Scales mass only, not kcal/100g.
 *
 * Rough kitchen bulk densities (packed handful / bowl contents):
 * - leafy namul / salad ~0.45–0.55
 * - seasoned stir / braise ~0.7–0.8
 * - kimchi ~0.9–1.0
 * - cooked rice ~1.05–1.15
 * - soup / stew ~1.0
 * - meat strips ~0.9–1.0
 * - fried / jeon ~0.65–0.75
 */
export function resolveFoodDensityGPerMl(
  name: string,
  role?: MealPortionRole | string | null,
): number {
  const n = name.replace(/\s+/g, "");
  const r = (role ?? "").trim();

  if (/김치|깍두기|석박지|총각김치|열무김치/.test(n)) return 0.95;
  if (/콩나물|숙주나물|숙주/.test(n)) return 0.55;
  if (/시금치|미나리|도라지|고사리|취나물|나물|무침|겉절이|샐러드/.test(n)) {
    return 0.5;
  }
  if (/볶음|조림/.test(n)) return 0.72;
  if (/계란|달걀|말이|스크램블|프라이/.test(n)) return 0.85;
  if (/두부|순두부/.test(n)) return 0.9;
  if (/고기|불고기|제육|삼겹|닭갈비|닭볶음|소고기|돼지고기|갈비|치킨/.test(n)) {
    return 0.95;
  }
  if (/튀김|전|까스|너겟|크로켓/.test(n)) return 0.7;
  if (/젓갈|장아찌|절임/.test(n)) return 0.85;
  if (/밥|공기밥|흰밥|현미|잡곡|덮밥|비빔밥|볶음밥|죽/.test(n) || r === "rice") {
    return 1.1;
  }
  if (
    /국|찌개|탕|전골|육개장|해장국|설렁|곰탕|라면|우동|국수|칼국수/.test(n) ||
    r === "soup"
  ) {
    return 1.0;
  }
  if (r === "meat") return 0.95;
  if (r === "fried") return 0.7;
  if (r === "side") return 0.6;
  if (r === "main") return 0.85;
  // Generic cooked banchan — not water.
  return 0.7;
}
