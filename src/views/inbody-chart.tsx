import "@/index.css";

import { useState, type ReactElement } from "react";
import MuscleBody, {
  type BodyProps,
  type ExtendedBodyPart,
} from "react-muscle-highlighter";

const Body =
  typeof MuscleBody === "function"
    ? (MuscleBody as (props: BodyProps) => ReactElement)
    : (
        MuscleBody as unknown as {
          default: (props: BodyProps) => ReactElement;
        }
      ).default;
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useUser } from "skybridge/web";
import { cidShape, type Sex, shapeNote } from "@/cid.js";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { AffiliateCarousel } from "./components/affiliate-carousel.js";
import { SourceFooter } from "./components/source-footer.js";
import { bumpProfile } from "../hooks/profile-sync.js";
import { useAccountKey } from "./use-account-key.js";
import { useAssistantContext } from "../hooks/use-assistant-context.js";

const visuals = ["bar", "line", "area"] as const;
const visualLabel = { bar: "막대", line: "꺾은선", area: "영역" } as const;
const metricColor = {
  weightKg: "#2563eb",
  skeletalMuscleKg: "#16a34a",
  bodyFatKg: "#e11d48",
  bodyFatPercent: "#f59e0b",
  muscleUpperLeftKg: "#0891b2",
  muscleUpperRightKg: "#0e7490",
  muscleCoreKg: "#7c3aed",
  muscleLowerLeftKg: "#ea580c",
  muscleLowerRightKg: "#c2410c",
} as const;

const WEAK = "#eab308";
const TARGET = "#ef4444";

type Visual = (typeof visuals)[number];
export type InbodyChartData = Extract<
  ReturnType<typeof useToolInfo<"show-inbody-chart">>,
  { isSuccess: true }
>["output"];
type Series = InbodyChartData["series"][number];
type Point = InbodyChartData["points"][number];

type RegionKey =
  | "upperLeft"
  | "upperRight"
  | "core"
  | "lowerLeft"
  | "lowerRight";

const regions: {
  key: RegionKey;
  label: string;
  valueOf: (point: Point) => number;
  parts: Array<{ slug: ExtendedBodyPart["slug"]; side?: "left" | "right" }>;
}[] = [
  {
    key: "upperLeft",
    label: "상체 좌",
    valueOf: (point) => point.muscleUpperLeftKg,
    parts: [
      { slug: "deltoids", side: "left" },
      { slug: "biceps", side: "left" },
      { slug: "chest", side: "left" },
      { slug: "forearm", side: "left" },
    ],
  },
  {
    key: "upperRight",
    label: "상체 우",
    valueOf: (point) => point.muscleUpperRightKg,
    parts: [
      { slug: "deltoids", side: "right" },
      { slug: "biceps", side: "right" },
      { slug: "chest", side: "right" },
      { slug: "forearm", side: "right" },
    ],
  },
  {
    key: "core",
    label: "코어",
    valueOf: (point) => point.muscleCoreKg,
    parts: [{ slug: "abs" }, { slug: "obliques" }],
  },
  {
    key: "lowerLeft",
    label: "하체 좌",
    valueOf: (point) => point.muscleLowerLeftKg,
    parts: [
      { slug: "quadriceps", side: "left" },
      { slug: "adductors", side: "left" },
      { slug: "calves", side: "left" },
    ],
  },
  {
    key: "lowerRight",
    label: "하체 우",
    valueOf: (point) => point.muscleLowerRightKg,
    parts: [
      { slug: "quadriceps", side: "right" },
      { slug: "adductors", side: "right" },
      { slug: "calves", side: "right" },
    ],
  },
];

function balanceFrom(point: Point | undefined) {
  if (!point) {
    return {
      radar: [] as Array<{ region: string; actual: number; standard: number }>,
      bodyData: [] as ExtendedBodyPart[],
      bodyOverlay: [] as ExtendedBodyPart[],
      weakLabels: [] as string[],
      targetLabels: [] as string[],
    };
  }

  const values = regions.map((region) => ({
    ...region,
    value: region.valueOf(point),
  }));
  const positive = values.filter((item) => item.value > 0);
  const standard =
    positive.length > 0
      ? positive.reduce((sum, item) => sum + item.value, 0) / positive.length
      : 0;
  const weak = positive.filter((item) => item.value < standard * 0.95);
  const weakest =
    weak.length > 0
      ? [...weak].sort((a, b) => a.value - b.value)[0]
      : undefined;
  const targetKeys = new Set(weakest ? [weakest.key] : []);
  const weakKeys = new Set(weak.map((item) => item.key));

  // The body component keeps one entry per muscle, so a muscle whose left and
  // right sides are both marked would lose one side. Right-side marks go to a
  // second, transparent body drawn on top.
  const bodyData: ExtendedBodyPart[] = [];
  const bodyOverlay: ExtendedBodyPart[] = [];
  for (const region of values) {
    if (!weakKeys.has(region.key) && !targetKeys.has(region.key)) continue;
    const color = targetKeys.has(region.key) ? TARGET : WEAK;
    for (const part of region.parts) {
      (part.side === "right" ? bodyOverlay : bodyData).push({
        slug: part.slug,
        color,
        ...(part.side ? { side: part.side } : {}),
      });
    }
  }

  return {
    radar: values.map((item) => ({
      region: item.label,
      actual: Math.round(item.value * 10) / 10,
      standard: Math.round(standard * 10) / 10,
    })),
    bodyData,
    bodyOverlay,
    weakLabels: weak.map((item) => item.label),
    targetLabels: weakest ? [weakest.label] : [],
  };
}

const CID_COLOR = ["#2563eb", "#16a34a", "#e11d48"] as const;

function CidCard({
  point,
  heightCm,
  sex,
  axis,
  accountKey,
  onSaved,
}: {
  point: Point;
  heightCm: number;
  sex: Sex | null;
  axis: string;
  accountKey: string;
  onSaved: (profile: { heightCm: number; sex: Sex }) => void;
}) {
  const { callToolAsync, isPending } = useCallTool("save-body-profile");
  const [heightDraft, setHeightDraft] = useState("");
  const [sexDraft, setSexDraft] = useState<Sex>("male");
  const [failed, setFailed] = useState("");

  if (heightCm <= 0 || sex === null) {
    const height = Number(heightDraft);
    const valid = height >= 100 && height <= 230;
    return (
      <form
        className="mt-3 rounded-lg border border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || isPending) return;
          setFailed("");
          void callToolAsync({ heightCm: height, sex: sexDraft, accountKey })
            .then((result) => {
              if (result.structuredContent?.saved) {
                onSaved({ heightCm: height, sex: sexDraft });
                bumpProfile();
              } else {
                setFailed("저장하지 못했습니다. 한 번 더 눌러 주세요.");
              }
            })
            .catch(() =>
              setFailed("저장하지 못했습니다. 한 번 더 눌러 주세요."),
            );
        }}
      >
        <h3 className="text-sm font-bold">C-I-D 체형</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          체중 {point.weightKg}kg · 골격근량 {point.skeletalMuscleKg}kg ·
          체지방량 {point.bodyFatKg}kg. 표준치와 비교하려면 키와 성별이
          필요합니다.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={100}
            max={230}
            placeholder="키(cm)"
            value={heightDraft}
            onChange={(event) => setHeightDraft(event.target.value)}
            className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
          {(["male", "female"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSexDraft(value)}
              className={`rounded-full border px-3 py-1 text-xs ${
                sexDraft === value
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-border"
              }`}
            >
              {value === "male" ? "남성" : "여성"}
            </button>
          ))}
          <button
            type="submit"
            disabled={!valid || isPending}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
          >
            {isPending ? "저장 중…" : "저장하고 체형 보기"}
          </button>
        </div>
        {failed ? <p className="mt-2 text-xs text-red-600">{failed}</p> : null}
      </form>
    );
  }

  const cid = cidShape({
    heightCm,
    sex,
    weightKg: point.weightKg,
    skeletalMuscleKg: point.skeletalMuscleKg,
    bodyFatKg: point.bodyFatKg,
  });
  const limit =
    Math.ceil(Math.max(150, ...cid.rows.map((row) => row.percent + 10)) / 50) *
    50;
  const ticks = Array.from({ length: limit / 50 + 1 }, (_, index) => index * 50);

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">C-I-D 체형</h3>
        <span className="text-2xl font-black">{cid.shape}</span>
      </div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            layout="vertical"
            data={cid.rows}
            margin={{ top: 18, right: 24, bottom: 0, left: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={axis}
              opacity={0.25}
              horizontal={false}
            />
            <XAxis
              type="number"
              domain={[0, limit]}
              ticks={ticks}
              unit="%"
              tick={{ fill: axis, fontSize: 11 }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={64}
              tick={{ fill: axis, fontSize: 11 }}
            />
            <Tooltip />
            <ReferenceLine
              x={100}
              stroke={axis}
              strokeDasharray="4 4"
              label={{ value: "표준", fill: axis, fontSize: 10, position: "top" }}
            />
            <Bar dataKey="percent" name="표준 대비" barSize={16}>
              {cid.rows.map((row, index) => (
                <Cell key={row.name} fill={CID_COLOR[index] ?? "#64748b"} />
              ))}
            </Bar>
            <Line
              dataKey="percent"
              name="체형 선"
              stroke={axis}
              strokeWidth={4}
              dot={{ r: 4, fill: axis }}
              legendType="none"
              tooltipType="none"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs">{shapeNote[cid.shape]}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {cid.rows
          .map((row) => `${row.name} ${row.kg}kg (표준 ${row.standardKg}kg)`)
          .join(" · ")}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        표준치는 키 {heightCm}cm·{sex === "male" ? "남성" : "여성"} 기준
        근사값입니다(BMI {sex === "male" ? "22" : "21.5"}, 체지방{" "}
        {sex === "male" ? "15" : "23"}%). 인바디 기기의 표준 범위와 조금 다를 수
        있습니다.
      </p>
      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "cid-body-shape",
          shape: cid.shape,
          percentOfStandard: cid.rows.map((row) => ({
            name: row.name,
            percent: row.percent,
          })),
        })}
      />
    </div>
  );
}

export function InbodyChartPanel({
  chart,
  theme,
  accountKey,
  syncContext = false,
}: {
  chart: InbodyChartData;
  theme: string;
  accountKey: string;
  syncContext?: boolean;
}) {
  const [visualByIndex, setVisualByIndex] = useState<Record<number, Visual>>(
    {},
  );
  const [bodySide, setBodySide] = useState<"front" | "back">("front");
  const [savedProfile, setSavedProfile] = useState<{
    heightCm: number;
    sex: Sex;
  } | null>(null);
  const heightCm = savedProfile?.heightCm ?? chart.heightCm;
  const sex: Sex | null =
    savedProfile?.sex ??
    (chart.sex === "male" || chart.sex === "female" ? chart.sex : null);
  useAssistantContext(
    syncContext
      ? JSON.stringify(
          chart.series.map((item, index) => ({
            metric: item.metric,
            label: item.label,
            visualType: visualByIndex[index] ?? item.visualType,
            yAxisId: item.yAxisId,
          })),
        )
      : "",
  );

  const axis = theme === "dark" ? "#e4e4e7" : "#3f3f46";
  const hasRight = chart.series.some((item) => item.yAxisId === "right");
  const drawn = chart.series.map((item, index) => ({
    ...item,
    visualType: visualByIndex[index] ?? item.visualType,
  }));
  const last = chart.points.at(-1);
  const balance = balanceFrom(last);
  const defaultFill = theme === "dark" ? "#52525b" : "#d4d4d8";
  const border = theme === "dark" ? "#a1a1aa" : "#71717a";

  return (
    <div className="p-4 bg-background text-foreground rounded-xl border border-border">
      <h2 className="text-lg font-bold">
        인바디 {chart.startDate} ~ {chart.endDate}
      </h2>
      <p className="text-sm text-muted-foreground">
        측정 {chart.points.length}회
        {last ? ` · 최신 ${last.date}` : ""}
      </p>

      {last ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">근육 해부도</h3>
              <div className="flex gap-1">
                {(["front", "back"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setBodySide(side)}
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      bodySide === side
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-border"
                    }`}
                  >
                    {side === "front" ? "앞" : "뒤"}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative flex justify-center overflow-hidden">
              <Body
                data={balance.bodyData}
                side={bodySide}
                gender={sex === "female" ? "female" : "male"}
                scale={1.05}
                defaultFill={defaultFill}
                border={border}
              />
              {balance.bodyOverlay.length > 0 ? (
                <div className="pointer-events-none absolute inset-0 flex justify-center">
                  <Body
                    data={balance.bodyOverlay}
                    side={bodySide}
                    gender={sex === "female" ? "female" : "male"}
                    scale={1.05}
                    defaultFill="transparent"
                    border="transparent"
                  />
                </div>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: WEAK }}
                />
                취약
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: TARGET }}
                />
                추천 타겟
              </span>
            </div>
            {balance.targetLabels.length > 0 ? (
              <p className="mt-2 text-xs">
                추천: {balance.targetLabels.join(", ")}
                {balance.weakLabels.length > 1
                  ? ` · 취약 ${balance.weakLabels.join(", ")}`
                  : ""}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                다섯 부위가 고르게 잡혀 있습니다.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border p-3">
            <h3 className="mb-2 text-sm font-bold">부위 밸런스</h3>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={balance.radar}>
                  <PolarGrid stroke={axis} />
                  <PolarAngleAxis
                    dataKey="region"
                    tick={{ fill: axis, fontSize: 11 }}
                  />
                  <PolarRadiusAxis
                    tick={{ fill: axis, fontSize: 10 }}
                    axisLine={false}
                  />
                  <Radar
                    name="표준(평균)"
                    dataKey="standard"
                    stroke="#94a3b8"
                    fill="#94a3b8"
                    fillOpacity={0.15}
                  />
                  <Radar
                    name="현재"
                    dataKey="actual"
                    stroke="#2563eb"
                    fill="#2563eb"
                    fillOpacity={0.35}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : null}

      {last ? (
        <CidCard
          point={last}
          heightCm={heightCm}
          sex={sex}
          axis={axis}
          accountKey={accountKey}
          onSaved={setSavedProfile}
        />
      ) : null}

      <div className="my-3 space-y-2">
        {drawn.map((item, index) => (
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
      {chart.points.length === 0 ? (
        <p className="text-sm">
          이 기간에 저장된 인바디가 없습니다. 결과지를 올리면 점이 쌓입니다.
        </p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart.points}>
              <CartesianGrid strokeDasharray="3 3" stroke={axis} opacity={0.25} />
              <XAxis dataKey="date" tick={{ fill: axis, fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fill: axis, fontSize: 11 }} />
              {hasRight ? (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: axis, fontSize: 11 }}
                />
              ) : null}
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {drawn.map((item, index) => marks(item, index))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-3 text-sm">{chart.feedback}</p>
      <AffiliateCarousel block={chart.affiliate} />
      <SourceFooter libs={["recharts", "muscle"]} />
    </div>
  );
}

function InbodyChartLoaded({
  chart,
  theme,
}: {
  chart: InbodyChartData;
  theme: string;
}) {
  const accountKey = useAccountKey(chart.accountKey || undefined);
  return (
    <InbodyChartPanel
      chart={chart}
      theme={theme}
      accountKey={accountKey}
      syncContext
    />
  );
}

export default function InbodyChart() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"show-inbody-chart">();
  if (!toolInfo.isSuccess) return null;
  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <InbodyChartLoaded chart={toolInfo.output} theme={theme} />
    </div>
  );
}

function marks(series: Series, index: number) {
  const color = metricColor[series.metric];
  if (series.visualType === "line") {
    return (
      <Line
        key={index}
        type="monotone"
        dataKey={series.metric}
        name={series.label}
        yAxisId={series.yAxisId}
        stroke={color}
        strokeWidth={2}
        dot
      />
    );
  }
  if (series.visualType === "area") {
    return (
      <Area
        key={index}
        type="monotone"
        dataKey={series.metric}
        name={series.label}
        yAxisId={series.yAxisId}
        stroke={color}
        fill={color}
        fillOpacity={0.25}
      />
    );
  }
  return (
    <Bar
      key={index}
      dataKey={series.metric}
      name={series.label}
      yAxisId={series.yAxisId}
      fill={color}
    />
  );
}
