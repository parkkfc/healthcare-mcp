import "@/index.css";

import { useState } from "react";
import { useUser } from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { SourceFooter } from "./components/source-footer.js";
import { useAccountKey } from "./use-account-key.js";
import { useAssistantContext } from "./use-assistant-context.js";

export default function MealWidget() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"preview-meal-kcal">();
  const { callTool, isPending: isSaving } = useCallTool("save-daily-log");
  const accountKey = useAccountKey();
  const [grams, setGrams] = useState<number | null>(null);
  useAssistantContext(
    toolInfo.isSuccess
      ? JSON.stringify({
          foodName: toolInfo.output.foodName,
          grams: grams ?? toolInfo.output.estimatedGrams,
          accountKey,
        })
      : "",
  );

  if (!toolInfo.isSuccess) return null;

  const meal = toolInfo.output;
  const currentGrams = grams ?? meal.estimatedGrams;
  const currentKcal = Math.round((meal.baseKcal / 100) * currentGrams);

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} p-5 border rounded-xl bg-white dark:bg-zinc-900 shadow-sm`}
    >
      <h3 className="font-bold text-lg">{meal.foodName}</h3>
      <p className="text-zinc-600 dark:text-zinc-400 mt-1">
        현재 조절된 중량: <span className="font-bold">{currentGrams}g</span> (
        {currentKcal} kcal)
      </p>

      <input
        type="range"
        min="50"
        max="500"
        step="10"
        value={currentGrams}
        onChange={(event) => setGrams(Number(event.target.value))}
        className="w-full my-6 accent-blue-500"
      />

      <button
        type="button"
        disabled={isSaving}
        onClick={() =>
          callTool({
            foodName: meal.foodName,
            finalGrams: currentGrams,
            finalKcal: currentKcal,
            accountKey,
          })
        }
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors"
      >
        {isSaving ? "저장 중..." : "이 식단 기록하기"}
      </button>
      <SourceFooter note="칼로리는 호스트가 넘긴 100g당 값을 중량에 맞춰 환산한 값입니다." />
    </div>
  );
}
