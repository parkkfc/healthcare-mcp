import "@/index.css";

import { useState } from "react";
import { useUser } from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { HostFileImage } from "./components/host-file-image.js";
import { SourceFooter } from "./components/source-footer.js";
import { useAccountKey } from "./use-account-key.js";
import { useAssistantContext } from "./use-assistant-context.js";

const mealLabel = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
} as const;

export default function MealPhoto() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"preview-meal-photo">();
  const { callTool, isPending: isSaving } = useCallTool("save-meal-foods");
  const accountKey = useAccountKey();
  const [gramsByIndex, setGramsByIndex] = useState<Record<number, number>>({});
  useAssistantContext(
    toolInfo.isSuccess
      ? JSON.stringify({
          foods: toolInfo.output.foods.map((food, index) => ({
            foodName: food.foodName,
            grams: gramsByIndex[index] ?? food.grams,
          })),
          accountKey,
        })
      : "",
  );

  if (!toolInfo.isSuccess) return null;

  const meal = toolInfo.output;
  const rows = meal.foods.map((food, index) => {
    const grams = gramsByIndex[index] ?? food.grams;
    const ratio = food.grams > 0 ? grams / food.grams : 1;
    return {
      foodName: food.foodName,
      grams,
      kcal: Math.round(food.kcal * ratio),
      carbG: Math.round(food.carbG * ratio),
      proteinG: Math.round(food.proteinG * ratio),
      fatG: Math.round(food.fatG * ratio),
    };
  });

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} p-4 bg-background text-foreground rounded-xl border border-border`}
    >
      <h2 className="text-lg font-bold mb-3">
        {meal.date} {mealLabel[meal.meal]}
      </h2>
      <HostFileImage
        fileId={meal.photo?.file_id}
        downloadUrl={meal.photoUrl || meal.photo?.download_url}
        alt={mealLabel[meal.meal]}
        className="mb-3 max-h-48 w-full rounded-lg object-cover"
      />
      <div className="space-y-3">
        {rows.map((row, index) => (
          <label key={`${row.foodName}-${index}`} className="block">
            <span className="font-medium">{row.foodName}</span>
            <span className="block text-sm mt-1">
              {row.grams}g · {row.kcal}kcal · 탄 {row.carbG}g · 단{" "}
              {row.proteinG}g · 지 {row.fatG}g
            </span>
            <input
              type="number"
              min={1}
              value={row.grams}
              onChange={(event) =>
                setGramsByIndex((current) => ({
                  ...current,
                  [index]: Number(event.target.value),
                }))
              }
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={isSaving}
        onClick={() =>
          callTool({
            date: meal.date,
            meal: meal.meal,
            foods: rows,
            accountKey,
            ...(meal.photo.file_id
              ? {
                  photo: {
                    file_id: meal.photo.file_id,
                    download_url: meal.photo.download_url,
                    mime_type: meal.photo.mime_type,
                    file_name: meal.photo.file_name,
                  },
                }
              : {}),
          })
        }
        className="mt-4 w-full rounded-lg bg-blue-600 py-3 font-bold text-white"
      >
        {isSaving ? "저장 중..." : "이 구성으로 저장"}
      </button>
      <SourceFooter
        data={{
          ko: "식품영양성분 데이터베이스",
          en: "Korean Food Composition Database system(K-FCDB)",
        }}
      />
    </div>
  );
}
