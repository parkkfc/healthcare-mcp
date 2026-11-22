import "@/index.css";

import { ResponsiveSankey } from "@nivo/sankey";
import { useState } from "react";
import { useUser } from "skybridge/web";
import { useToolInfo } from "@/helpers.js";
import { SourceFooter } from "./components/source-footer.js";

export type NutrientFlowData = Extract<
  ReturnType<typeof useToolInfo<"show-nutrient-flow">>,
  { isSuccess: true }
>["output"];

const macroColor: Record<string, string> = {
  "macro:carb": "#f59e0b",
  "macro:protein": "#16a34a",
  "macro:fat": "#e11d48",
};
const sourceColors = [
  "#2563eb",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
  "#c026d3",
  "#64748b",
];
const modes = [
  { id: "byMeal", label: "끼니별" },
  { id: "byFood", label: "음식별" },
] as const;
type Mode = (typeof modes)[number]["id"];

export function NutrientFlowPanel({
  data,
  theme,
}: {
  data: NutrientFlowData;
  theme: string;
}) {
  const [mode, setMode] = useState<Mode>("byFood");
  const text = theme === "dark" ? "#e4e4e7" : "#3f3f46";
  const flow = data[mode];
  const labelOf = new Map(flow.nodes.map((node) => [node.id, node.label]));
  const sourceIds = flow.nodes
    .filter((node) => node.side === "source")
    .map((node) => node.id);
  const colorOf = (id: string) =>
    macroColor[id] ??
    sourceColors[sourceIds.indexOf(id) % sourceColors.length] ??
    "#64748b";
  const total =
    data.totals.carbKcal + data.totals.proteinKcal + data.totals.fatKcal;
  const share = (kcal: number) =>
    total > 0 ? Math.round((kcal / total) * 100) : 0;
  const macros = [
    { label: "탄수화물", kcal: data.totals.carbKcal, color: "#f59e0b" },
    { label: "단백질", kcal: data.totals.proteinKcal, color: "#16a34a" },
    { label: "지방", kcal: data.totals.fatKcal, color: "#e11d48" },
  ];

  return (
    <div className="p-4 bg-background text-foreground rounded-xl border border-border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">영양소가 온 곳</h2>
          <p className="text-xs text-muted-foreground">
            {data.startDate} ~ {data.endDate} · 선 굵기는 kcal
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {modes.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                mode === item.id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-border"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {flow.links.length === 0 ? (
        <p className="mt-3 text-sm">
          이 기간에 탄단지가 기록된 음식이 없습니다.
        </p>
      ) : (
        <div className="mt-2 h-80 w-full">
          <ResponsiveSankey
            data={{
              nodes: flow.nodes.map((node) => ({ id: node.id })),
              links: flow.links,
            }}
            margin={{ top: 8, right: 64, bottom: 8, left: 96 }}
            align="justify"
            sort="input"
            colors={(node) => colorOf(String(node.id))}
            label={(node) => labelOf.get(String(node.id)) ?? String(node.id)}
            labelPosition="outside"
            labelPadding={6}
            labelTextColor={text}
            nodeThickness={12}
            nodeSpacing={10}
            nodeBorderWidth={0}
            nodeBorderRadius={2}
            linkOpacity={0.35}
            linkHoverOpacity={0.7}
            enableLinkGradient
            valueFormat={(value) => `${Math.round(value)}kcal`}
            theme={{
              text: { fill: text, fontSize: 11 },
              labels: { text: { fill: text, fontSize: 11 } },
              tooltip: {
                container: {
                  background: theme === "dark" ? "#18181b" : "#ffffff",
                  color: text,
                  fontSize: 12,
                },
              },
            }}
          />
        </div>
      )}

      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        {macros.map((macro) => (
          <div key={macro.label} className="rounded-lg border border-border py-2">
            <div className="inline-flex items-center gap-1 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: macro.color }}
              />
              {macro.label}
            </div>
            <div className="text-base font-bold">{share(macro.kcal)}%</div>
            <div className="text-muted-foreground">{macro.kcal}kcal</div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm">{data.feedback}</p>
      {flow.links.length > 0 ? (
        <SourceFooter
          data={data.source}
          libs={["nivo-sankey"]}
          note="탄수화물·단백질은 g당 4kcal, 지방은 9kcal로 환산했습니다."
        />
      ) : null}
      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "nutrient-flow",
          showing: mode,
          startDate: data.startDate,
          endDate: data.endDate,
          totals: data.totals,
          topSources: data.topSources,
        })}
      />
    </div>
  );
}

export default function NutrientFlow() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"show-nutrient-flow">();
  if (!toolInfo.isSuccess) return null;
  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <NutrientFlowPanel data={toolInfo.output} theme={theme} />
    </div>
  );
}
