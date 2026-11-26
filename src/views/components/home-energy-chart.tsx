import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyEnergyPlan } from "@/goals.js";
import { goalSourceLabel } from "@/goals.js";

type EnergyRow = {
  name: string;
  actual: number | null;
  target: number | null;
  kind: "macro" | "kcal";
  actualG?: number;
  targetG?: number;
};

function formatMacro(kcal: number, grams: number) {
  return `${kcal}kcal (${grams}g)`;
}

export function HomeEnergyChart({
  energy,
  theme,
}: {
  energy: DailyEnergyPlan | null | undefined;
  theme: string;
}) {
  if (!energy || !energy.ready) {
    return (
      <div className="mb-4 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        인바디(와 워너비 체형·기한)를 저장하면 여기에 1일 운동·탄수화물·단백질·지방·기초대사
        kcal 막대가 항상 보입니다.
      </div>
    );
  }

  const axis = theme === "dark" ? "#a1a1aa" : "#71717a";
  const actualFill = theme === "dark" ? "#38bdf8" : "#2563eb";
  const targetFill = theme === "dark" ? "#a78bfa" : "#7c3aed";
  const rows: EnergyRow[] = [
    {
      name: "1일 운동",
      actual: energy.exerciseKcal,
      target: energy.targetExerciseKcal,
      kind: "kcal",
    },
    {
      name: "탄수화물",
      actual: energy.intakeCarbKcal,
      target: energy.carbKcal,
      kind: "macro",
      actualG: energy.intakeCarbG,
      targetG: energy.carbG,
    },
    {
      name: "단백질",
      actual: energy.intakeProteinKcal,
      target: energy.proteinKcal,
      kind: "macro",
      actualG: energy.intakeProteinG,
      targetG: energy.proteinG,
    },
    {
      name: "지방",
      actual: energy.intakeFatKcal,
      target: energy.fatKcal,
      kind: "macro",
      actualG: energy.intakeFatG,
      targetG: energy.fatG,
    },
    {
      name: "기초대사량",
      // 비교 없이 한 막대만 — 기준(보라) 색으로 표시
      actual: null,
      target: energy.bmrKcal,
      kind: "kcal",
    },
  ];

  return (
    <div className="mb-4 rounded-xl border border-border bg-background p-3">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">오늘 에너지 균형</h2>
          <p className="text-[11px] text-muted-foreground">
            {energy.bodyGoalTitle
              ? `${energy.bodyGoalTitle}${
                  energy.targetDays ? ` · ${energy.targetDays}일` : ""
                } 기준`
              : goalSourceLabel[energy.source]}
            {energy.isDeadlineClamped
              ? ` · 안전 기한 최소 ${energy.minSafeDays}일`
              : ""}
          </p>
        </div>
        <div className="text-right text-[11px] leading-snug">
          <p>
            오늘 소비{" "}
            <span className="font-bold">{energy.expenditureKcal}kcal</span>
            <span className="text-muted-foreground">
              {" "}
              (기초 {energy.bmrKcal}+운동 {energy.exerciseKcal})
            </span>
          </p>
          <p>
            오늘 섭취{" "}
            <span className="font-bold">{energy.intakeKcal}kcal</span>
            <span className="text-muted-foreground">
              {" "}
              / 목표 {energy.goalIntakeKcal}kcal
            </span>
          </p>
          <p className="text-muted-foreground">
            탄 {formatMacro(energy.intakeCarbKcal, energy.intakeCarbG)} /{" "}
            {formatMacro(energy.carbKcal, energy.carbG)}
          </p>
          <p className="text-muted-foreground">
            단 {formatMacro(energy.intakeProteinKcal, energy.intakeProteinG)} /{" "}
            {formatMacro(energy.proteinKcal, energy.proteinG)}
          </p>
          <p className="text-muted-foreground">
            지 {formatMacro(energy.intakeFatKcal, energy.intakeFatG)} /{" "}
            {formatMacro(energy.fatKcal, energy.fatG)}
          </p>
          <p className="text-muted-foreground">
            목표 운동 {energy.targetExerciseKcal}kcal · 목표 총소비{" "}
            {energy.targetExpenditureKcal}kcal
          </p>
        </div>
      </div>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 12, right: 8, left: 0, bottom: 4 }}
            barGap={2}
            barCategoryGap="18%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke={axis} opacity={0.35} />
            <XAxis
              dataKey="name"
              tick={{ fill: axis, fontSize: 10 }}
              interval={0}
            />
            <YAxis
              tick={{ fill: axis, fontSize: 10 }}
              unit="kcal"
              width={48}
            />
            <Tooltip
              formatter={(value, name, item) => {
                if (value == null) return [null, null];
                const row = item?.payload as EnergyRow | undefined;
                const label = name === "actual" ? "오늘" : "기준";
                if (row?.kind === "macro") {
                  const grams =
                    name === "actual" ? (row.actualG ?? 0) : (row.targetG ?? 0);
                  return [formatMacro(Number(value), grams), label];
                }
                return [`${Number(value)}kcal`, label];
              }}
              labelFormatter={(label) => String(label)}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend
              formatter={(value) => (value === "actual" ? "오늘" : "기준")}
              wrapperStyle={{ fontSize: 11 }}
            />
            <Bar
              dataKey="actual"
              name="actual"
              fill={actualFill}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="target"
              name="target"
              fill={targetFill}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        파란 막대는 오늘 기록, 보라 막대는 목표(기준)입니다. 탄·단·지는
        kcal와 g를 함께 표기합니다. 기초대사량은 비교 없이 기준 색 한 막대만
        보입니다. 식사·운동을 저장하면 오늘 값이 바로 바뀝니다.
      </p>
    </div>
  );
}
