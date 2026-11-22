import "@/index.css";

import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from "recharts";
import { useUser } from "skybridge/web";
import { useToolInfo } from "@/helpers.js";
import { AffiliateCarousel } from "./components/affiliate-carousel.js";
import { SourceFooter } from "./components/source-footer.js";

export type DailySummaryData = Extract<
  ReturnType<typeof useToolInfo<"get-daily-summary-chart">>,
  { isSuccess: true }
>["output"];

const ringColor = {
  activity: "#ef4444",
  carb: "#f59e0b",
  protein: "#16a34a",
  fat: "#2563eb",
} as const;

const meals = [
  { key: "breakfast", label: "아침" },
  { key: "lunch", label: "점심" },
  { key: "dinner", label: "저녁" },
  { key: "snack", label: "간식" },
] as const;

export function DailySummaryPanel({
  data,
  theme,
}: {
  data: DailySummaryData;
  theme: string;
}) {
  const track = theme === "dark" ? "#3f3f46" : "#e4e4e7";
  // A ring stops at 100% and the number beside it shows the real value.
  const rings = data.rings.map((ring) => ({
    ...ring,
    drawn: Math.min(100, Math.max(0, ring.percent)),
    fill: ringColor[ring.key],
  }));
  // The chart draws its first row innermost; activity belongs on the outside.
  const outerFirst = [...rings].reverse();
  const remaining = data.goalKcal - data.kcal;

  return (
    <>
      <h2 className="text-lg font-bold">{data.date} 목표 달성</h2>
      <p className="text-xs text-muted-foreground">
        목표 {data.goalKcal}kcal · {data.goalSourceLabel}
      </p>

      <div className="mt-2 grid items-center gap-3 sm:grid-cols-2">
        <div className="relative h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              data={outerFirst}
              innerRadius="34%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              barSize={12}
            >
              <PolarAngleAxis
                type="number"
                domain={[0, 100]}
                tick={false}
                axisLine={false}
              />
              <RadialBar
                dataKey="drawn"
                cornerRadius={6}
                background={{ fill: track }}
              />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold">{data.kcal}</span>
            <span className="text-[10px] text-muted-foreground">kcal 섭취</span>
          </div>
        </div>

        <ul className="space-y-2 text-sm">
          {rings.map((ring) => (
            <li key={ring.key} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: ring.fill }}
              />
              <span className="flex-1">{ring.label}</span>
              <span className="text-xs text-muted-foreground">
                {ring.value}/{ring.goal}
                {ring.unit}
              </span>
              <span className="w-12 text-right font-bold">{ring.percent}%</span>
            </li>
          ))}
          <li className="border-t border-border pt-2 text-xs text-muted-foreground">
            {remaining >= 0
              ? `목표까지 ${remaining}kcal 남음`
              : `목표보다 ${-remaining}kcal 많음`}
            {" · "}운동 소모 {data.burned}kcal
          </li>
        </ul>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
        {meals.map((meal) => (
          <div key={meal.key} className="rounded-lg border border-border py-2">
            <div className="text-muted-foreground">{meal.label}</div>
            <div className="font-bold">{data[meal.key]}</div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm">{data.feedback}</p>
      <AffiliateCarousel block={data.affiliate} />
      <SourceFooter
        data={
          data.kcal > 0 || data.carbG > 0 || data.proteinG > 0 || data.fatG > 0
            ? data.source
            : null
        }
        libs={["recharts"]}
      />
      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "daily-goal-rings",
          date: data.date,
          kcal: data.kcal,
          goalKcal: data.goalKcal,
          burnedKcal: data.burned,
          rings: data.rings.map((ring) => ({
            label: ring.label,
            percent: ring.percent,
          })),
        })}
      />
    </>
  );
}

export default function DailySummary() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"get-daily-summary-chart">();

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} p-4 bg-background text-foreground rounded-xl border border-border`}
    >
      {toolInfo.isSuccess ? (
        <DailySummaryPanel data={toolInfo.output} theme={theme} />
      ) : (
        <p>불러오는 중…</p>
      )}
    </div>
  );
}
