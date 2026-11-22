import { describe, expect, it } from "vitest";
import { normalizeHostFoodKcal } from "../src/food-kcal-estimate.js";

describe("normalizeHostFoodKcal (host replaces Workers AI)", () => {
  it("accepts a normal host estimate", () => {
    const result = normalizeHostFoodKcal({
      foodName: "흰쌀밥",
      kcalPer100g: 148.4,
      source: "일반 영양 지식",
    });
    expect(result.foodName).toBe("흰쌀밥");
    expect(result.kcalPer100g).toBe(148);
    expect(result.aiEstimatedKcal).toBe(148);
    expect(result.estimatedBy).toBe("host");
    expect(result.source).toBe("일반 영양 지식");
  });

  it("clamps extreme values", () => {
    expect(
      normalizeHostFoodKcal({ foodName: "오일", kcalPer100g: 9999 })
        .kcalPer100g,
    ).toBe(900);
    expect(
      normalizeHostFoodKcal({ foodName: "물", kcalPer100g: 0.4 }).kcalPer100g,
    ).toBe(1);
  });

  it("rejects empty name and non-positive kcal", () => {
    expect(() =>
      normalizeHostFoodKcal({ foodName: "  ", kcalPer100g: 100 }),
    ).toThrow(/foodName/);
    expect(() =>
      normalizeHostFoodKcal({ foodName: "김", kcalPer100g: 0 }),
    ).toThrow(/kcalPer100g/);
  });
});
