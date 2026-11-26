import "@/index.css";

import { useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useUser } from "skybridge/web";
import { useToolInfo } from "@/helpers.js";
import { AffiliateCarousel } from "./components/affiliate-carousel.js";
import { ChatNextHint } from "./components/chat-next-hint.js";
import { SourceFooter } from "./components/source-footer.js";
import { useAssistantContext } from "../hooks/use-assistant-context.js";

const visuals = ["bar", "line", "area"] as const;
const visualLabel = { bar: "막대", line: "꺾은선", area: "영역" } as const;
const mealKeys = ["breakfast", "lunch", "dinner", "snack"] as const;
const mealLabel = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
} as const;
const mealColor = {
  breakfast: "#f59e0b",
  lunch: "#2563eb",
  dinner: "#7c3aed",
  snack: "#f97316",
} as const;
const metricColor = {
  kcal: "#2563eb",
  carbG: "#f59e0b",
  proteinG: "#16a34a",
  fatG: "#e11d48",
  burnedKcal: "#ef4444",
  balance: "#64748b",
} as const;
const DEFICIT = "#16a34a";
const SURPLUS = "#dc2626";
const macroColor = { carb: "#f59e0b", protein: "#16a34a", fat: "#2563eb" } as const;
const shortDate = (date: string) => date.slice(5);
type MacroTab = "all" | "carb" | "protein" | "fat";
const macroTabs: { id: MacroTab; label: string }[] = [
  { id: "all", label: "전체 열량" },
  { id: "carb", label: "탄수화물" },
  { id: "protein", label: "단백질" },
  { id: "fat", label: "지방" },
];

type Visual = (typeof visuals)[number];
export type DietChartData = Extract<
  ReturnType<typeof useToolInfo<"show-diet-chart">>,
  { isSuccess: true }
>["output"];
type Series = DietChartData["series"][number];
type Point = DietChartData["points"][number];

export function DietChartPanel({
  chart,
  theme,
  syncContext = false,
}: {
  chart: DietChartData;
  theme: string;
  syncContext?: boolean;
}) {
  const [visualByIndex, setVisualByIndex] = useState<Record<number, Visual>>(
    {},
  );
  const [macroTab, setMacroTab] = useState<MacroTab>("all");
  const [span, setSpan] = useState<7 | 14 | 30>(14);
  const chartState = JSON.stringify(
    chart.series.map((item, index) => ({
      metric: item.metric,
      label: item.label,
      visualType: visualByIndex[index] ?? item.visualType,
      yAxisId: item.yAxisId,
    })),
  );
  useAssistantContext(syncContext ? chartState : "");

  const axis = theme === "dark" ? "#e4e4e7" : "#3f3f46";
  const all = chart.series.map((item, index) => ({
    ...item,
    index,
    visualType: visualByIndex[index] ?? item.visualType,
  }));
  // A balance bar gets its own chart with 0 (the goal) in the middle.
  const isDiverging = (item: (typeof all)[number]) =>
    item.metric === "balance" && item.visualType === "bar";
  const diverging = all.find(isDiverging);
  const drawn = all.filter((item) => !isDiverging(item));
  const hasRight = drawn.some((item) => item.yAxisId === "right");
  const logged = chart.points.filter((point) => point.kcal > 0);
  // Same distance above and below 0, on round numbers.
  const balanceLimit =
    Math.ceil(
      Math.max(100, ...logged.map((point) => Math.abs(point.balance))) / 500,
    ) * 500;
  const balanceTicks = [-1, -0.5, 0, 0.5, 1].map(
    (step) => step * balanceLimit,
  );
  // The kcal goal line only makes sense on an axis that carries kcal.
  const goalOnLeft =
    chart.hasGoal &&
    drawn.some(
      (item) =>
        item.yAxisId === "left" &&
        (item.metric === "kcal" || item.metric === "burnedKcal"),
    );
  const balancePoints = chart.points.map((point) => ({
    date: point.date,
    balance: point.kcal > 0 ? point.balance : null,
  }));
  const deficitDays = logged.filter((point) => point.balance <= 0).length;

  return (
    <div className="p-4 bg-background text-foreground rounded-xl border border-border">
      <h2 className="text-lg font-bold">
        {chart.startDate} ~ {chart.endDate}
      </h2>
      <p className="text-xs text-muted-foreground">
        하루 권장 {chart.goalKcal}kcal · 탄 {chart.goalCarbKcal}kcal · 단{" "}
        {chart.goalProteinKcal}kcal · 지 {chart.goalFatKcal}kcal ·{" "}
        {chart.goalSourceLabel}
      </p>
      {chart.ffmKg > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          제지방 {chart.ffmKg}kg · BMR {chart.bmrKcal}kcal · 유지{" "}
          {chart.tdeeKcal}kcal (Katch-McArdle × 1.375)
        </p>
      ) : null}
      <MacroKcalChart
        chart={chart}
        tab={macroTab}
        span={span}
        axis={axis}
        onTab={setMacroTab}
        onSpan={setSpan}
      />
      <div className="hidden" data-llm={chartState} />
      <div className="my-3 space-y-2">
        {all.map(({ index, ...item }) => (
          <div key={`${item.metric}-${index}`} className="flex flex-wrap gap-1">
            <span className="mr-1 self-center text-xs">{item.label}</span>
            {visuals.map((visual) => (
              <button
                key={visual}
                type="button"
                onClick={() =>
                  setVisualByIndex((current) => ({
                    ...current,
                    [index]: visual,
                  }))
                }
                className={`rounded-full border px-2 py-1 text-xs ${
                  item.visualType === visual
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-border"
                }`}
              >
                {visualLabel[visual]}
              </button>
            ))}
          </div>
        ))}
      </div>
      {logged.length === 0 ? (
        <p className="text-sm">이 기간에 저장된 음식이 없습니다.</p>
      ) : null}
      {logged.length > 0 && diverging ? (
        <div className="mb-3">
          <h3 className="text-sm font-bold">목표 대비 과잉·적자</h3>
          <p className="text-xs text-muted-foreground">
            가운데 0이 목표 {chart.goalKcal}kcal입니다(단위 kcal). 기록한{" "}
            {logged.length}일 중 {deficitDays}일이 목표 안입니다.
          </p>
          <div className="mt-1 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={balancePoints}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={axis}
                  opacity={0.25}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fill: axis, fontSize: 11 }}
                />
                <YAxis
                  domain={[-balanceLimit, balanceLimit]}
                  ticks={balanceTicks}
                  tick={{ fill: axis, fontSize: 11 }}
                  width={48}
                />
                <Tooltip />
                <ReferenceLine y={0} stroke={axis} strokeWidth={2} />
                <Bar dataKey="balance" name={diverging.label}>
                  {balancePoints.map((point) => (
                    <Cell
                      key={point.date}
                      fill={(point.balance ?? 0) > 0 ? SURPLUS : DEFICIT}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: DEFICIT }}
              />
              적자
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: SURPLUS }}
              />
              초과
            </span>
          </div>
        </div>
      ) : null}
      {logged.length > 0 && drawn.length > 0 ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart.points}>
              <CartesianGrid strokeDasharray="3 3" stroke={axis} opacity={0.25} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fill: axis, fontSize: 11 }}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: axis, fontSize: 11 }}
                width={48}
                domain={
                  goalOnLeft
                    ? [
                        0,
                        (dataMax: number) =>
                          Math.ceil(
                            Math.max(dataMax, chart.goalKcal * 1.1) / 500,
                          ) * 500,
                      ]
                    : undefined
                }
                tickCount={6}
              />
              {hasRight ? (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: axis, fontSize: 11 }}
                  width={40}
                />
              ) : null}
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {goalOnLeft ? (
                <ReferenceLine
                  yAxisId="left"
                  y={chart.goalKcal}
                  stroke={axis}
                  strokeDasharray="4 4"
                  label="목표"
                />
              ) : null}
              {drawn.flatMap((item) => marks(item, chart.points, item.index))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <p className="mt-3 text-sm">{chart.feedback}</p>
      <AffiliateCarousel block={chart.affiliate} />
      <SourceFooter
        data={
          chart.points.some(
            (point) =>
              (point.breakfast ?? 0) +
                (point.lunch ?? 0) +
                (point.dinner ?? 0) +
                (point.snack ?? 0) +
                (point.kcal ?? 0) >
              0,
          )
            ? chart.source
            : null
        }
        libs={["recharts"]}
      />
      <ChatNextHint example="성실도 달력 보여줘" />
    </div>
  );
}

export default function DietChart() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"show-diet-chart">();
  if (!toolInfo.isSuccess) {
    return (
      <div className="flex min-h-48 items-center bg-background p-4 text-sm text-foreground">
        식단 차트를 불러오는 중…
      </div>
    );
  }
  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <DietChartPanel chart={toolInfo.output} theme={theme} syncContext />
    </div>
  );
}

function MacroKcalChart({
  chart,
  tab,
  span,
  axis,
  onTab,
  onSpan,
}: {
  chart: DietChartData;
  tab: MacroTab;
  span: 7 | 14 | 30;
  axis: string;
  onTab: (tab: MacroTab) => void;
  onSpan: (span: 7 | 14 | 30) => void;
}) {
  const rows = chart.points.slice(-span).map((point) => ({
    ...point,
    carbKcal: point.carbKcal ?? Math.round(point.carbG * 4),
    proteinKcal: point.proteinKcal ?? Math.round(point.proteinG * 4),
    fatKcal: point.fatKcal ?? Math.round(point.fatG * 9),
  }));
  const goal =
    tab === "carb"
      ? chart.goalCarbKcal
      : tab === "protein"
        ? chart.goalProteinKcal
        : tab === "fat"
          ? chart.goalFatKcal
          : chart.goalKcal;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1">
        {macroTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
            className={`rounded-full border px-2 py-1 text-xs ${
              tab === item.id
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-border"
            }`}
          >
            {item.label}
          </button>
        ))}
        {([7, 14, 30] as const).map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => onSpan(days)}
            className={`rounded-full border px-2 py-1 text-xs ${
              span === days ? "border-zinc-800 bg-zinc-800 text-white" : "border-border"
            }`}
          >
            {days}일
          </button>
        ))}
      </div>
      <div className="mt-2 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={axis} opacity={0.25} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fill: axis, fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: axis, fontSize: 11 }}
              width={48}
              unit="kcal"
            />
            <Tooltip
              content={({ active, label, payload }) => (
                <MacroTip
                  active={active}
                  label={label}
                  row={payload?.[0]?.payload as DietChartData["points"][number] | undefined}
                  tab={tab}
                  chart={chart}
                />
              )}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine
              y={goal}
              stroke={axis}
              strokeDasharray="4 4"
              label={{ value: `권장 ${goal}`, fill: axis, fontSize: 10 }}
            />
            {tab === "all" ? (
              <>
                <Bar dataKey="carbKcal" name="탄수화물" stackId="macro" fill={macroColor.carb} />
                <Bar dataKey="proteinKcal" name="단백질" stackId="macro" fill={macroColor.protein} />
                <Bar dataKey="fatKcal" name="지방" stackId="macro" fill={macroColor.fat} />
                <Line
                  type="monotone"
                  dataKey="burnedKcal"
                  name="운동 소모"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                />
              </>
            ) : (
              <Bar
                dataKey={tab === "carb" ? "carbKcal" : tab === "protein" ? "proteinKcal" : "fatKcal"}
                name={tab === "carb" ? "탄수화물" : tab === "protein" ? "단백질" : "지방"}
                fill={tab === "carb" ? macroColor.carb : tab === "protein" ? macroColor.protein : macroColor.fat}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MacroTip({
  active,
  label,
  row,
  tab,
  chart,
}: {
  active?: boolean;
  label?: string | number;
  row?: DietChartData["points"][number];
  tab: MacroTab;
  chart: DietChartData;
}) {
  if (!active || !row) return null;
  const lines =
    tab === "all"
      ? [
          lineOf("탄수화물", row.carbKcal ?? row.carbG * 4, row.carbG, chart.goalCarbG, chart.goalCarbKcal),
          lineOf("단백질", row.proteinKcal ?? row.proteinG * 4, row.proteinG, chart.goalProteinG, chart.goalProteinKcal),
          lineOf("지방", row.fatKcal ?? row.fatG * 9, row.fatG, chart.goalFatG, chart.goalFatKcal),
        ]
      : [
          tab === "carb"
            ? lineOf("탄수화물", row.carbKcal ?? row.carbG * 4, row.carbG, chart.goalCarbG, chart.goalCarbKcal)
            : tab === "protein"
              ? lineOf("단백질", row.proteinKcal ?? row.proteinG * 4, row.proteinG, chart.goalProteinG, chart.goalProteinKcal)
              : lineOf("지방", row.fatKcal ?? row.fatG * 9, row.fatG, chart.goalFatG, chart.goalFatKcal),
        ];
  return (
    <div className="rounded-md border border-border bg-background p-2 text-xs text-foreground">
      <p className="font-medium">{label}</p>
      {lines.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </div>
  );
}

function lineOf(
  name: string,
  kcal: number,
  grams: number,
  goalG: number,
  goalKcal: number,
) {
  const pct = goalKcal > 0 ? Math.round((kcal / goalKcal) * 100) : 0;
  return `${name} ${Math.round(kcal)} kcal (${Math.round(grams)}g / 목표 ${goalG}g, ${pct}%)`;
}

function marks(series: Series, points: Point[], index: number) {
  const color = metricColor[series.metric];
  if (series.metric === "kcal" && series.isStacked && series.visualType === "bar") {
    return mealKeys.map((meal) => (
      <Bar
        key={`${index}-${meal}`}
        dataKey={meal}
        name={mealLabel[meal]}
        yAxisId={series.yAxisId}
        stackId="intake"
        fill={mealColor[meal]}
      />
    ));
  }
  if (series.visualType === "line") {
    return [
      <Line
        key={index}
        type="monotone"
        dataKey={series.metric}
        name={series.label}
        yAxisId={series.yAxisId}
        stroke={color}
        strokeWidth={2}
        dot={false}
      />,
    ];
  }
  if (series.visualType === "area") {
    return [
      <Area
        key={index}
        type="monotone"
        dataKey={series.metric}
        name={series.label}
        yAxisId={series.yAxisId}
        stroke={color}
        fill={color}
        fillOpacity={0.25}
      />,
    ];
  }
  return [
    <Bar
      key={index}
      dataKey={series.metric}
      name={series.label}
      yAxisId={series.yAxisId}
      fill={color}
    >
      {series.metric === "balance"
        ? points.map((point) => (
            <Cell
              key={point.date}
              fill={point.balance > 0 ? "#dc2626" : "#16a34a"}
            />
          ))
        : null}
    </Bar>,
  ];
}
