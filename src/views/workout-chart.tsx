import "@/index.css";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useUser } from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { SourceFooter } from "./components/source-footer.js";
import { useAccountKey } from "./use-account-key.js";

export type WorkoutChartData = Extract<
  ReturnType<typeof useToolInfo<"show-workout-chart">>,
  { isSuccess: true }
>["output"];
type Log = WorkoutChartData["logs"][number];

const VOLUME = "#2563eb";
const ONE_RM = "#e11d48";
const DAY_MS = 86_400_000;

const shortDate = (date: string) => date.slice(5);
const toTime = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
const fromTime = (time: number) =>
  new Date(time).toISOString().slice(5, 10);

function errorText(error: unknown) {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "지우지 못했습니다. 차트를 다시 연 뒤 시도해 주세요.";
}

function logLine(log: Log) {
  const parts =
    log.kind === "strength"
      ? [
          log.weightKg > 0 ? `${log.weightKg}kg` : "맨몸",
          `${log.reps}회 × ${log.sets}세트`,
          log.volume > 0 ? `볼륨 ${log.volume}kg` : "",
        ]
      : [`${log.durationMin}분`];
  return [...parts, log.burnedKcal > 0 ? `${log.burnedKcal}kcal` : ""]
    .filter((part) => part.length > 0)
    .join(" · ");
}

export function WorkoutChartPanel({
  data,
  theme,
  accountKey,
}: {
  data: WorkoutChartData;
  theme: string;
  accountKey: string;
}) {
  const { callToolAsync: deleteLog, isPending: deleting } =
    useCallTool("delete-workout-log");
  const [selectedName, setSelectedName] = useState(data.selected);
  const [logs, setLogs] = useState<Log[]>(data.logs);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const axis = theme === "dark" ? "#e4e4e7" : "#3f3f46";
  const selected =
    data.exercises.find((item) => item.exercise === selectedName) ??
    data.exercises[0];
  const strength = selected?.kind !== "cardio";
  const areaKey = strength ? "volume" : "burnedKcal";
  const areaUnit = strength ? "kg" : "kcal";
  const oneRm = (selected?.oneRm ?? []).map((point) => ({
    ...point,
    time: toTime(point.date),
  }));
  const best = oneRm.reduce((top, point) => Math.max(top, point.oneRm), 0);
  const shownLogs = logs.filter(
    (log) => !selected || log.exercise === selected.exercise,
  );

  async function remove(log: Log) {
    try {
      const result = await deleteLog({ id: log.id, etag: log.etag, accountKey });
      const body = result.structuredContent;
      if (body?.ok) {
        setLogs((current) => current.filter((item) => item.id !== log.id));
        setDeleteId(null);
        setNotice(`${body.message} 차트는 다시 열면 반영됩니다.`);
      } else {
        setNotice(body?.message ?? "지우지 못했습니다. 차트를 다시 열어 주세요.");
      }
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  return (
    <div className="p-4 bg-background text-foreground rounded-xl border border-border">
      <h2 className="text-lg font-bold">운동 성장</h2>
      <p className="text-xs text-muted-foreground">
        {data.startDate} ~ {data.endDate} · 총 소모 약 {data.totalBurnedKcal}kcal
      </p>

      {!selected ? (
        <p className="mt-3 text-sm">{data.feedback}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1">
            {data.exercises.map((item) => (
              <button
                key={item.exercise}
                type="button"
                onClick={() => {
                  setSelectedName(item.exercise);
                  setDeleteId(null);
                }}
                className={`rounded-full border px-3 py-1 text-xs ${
                  item.exercise === selected.exercise
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-border"
                }`}
              >
                {item.exercise} {item.sessions}회
              </button>
            ))}
          </div>

          <h3 className="mt-3 text-sm font-bold">
            {strength ? "주간 총 볼륨" : "주간 소모 칼로리"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {strength
              ? "중량 kg × 횟수 × 세트를 한 주씩 더했습니다."
              : "유산소는 볼륨 대신 MET 추정 소모 칼로리를 한 주씩 더했습니다."}
          </p>
          <div className="mt-1 h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={selected.weekly}>
                <defs>
                  <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VOLUME} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={VOLUME} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={axis}
                  opacity={0.25}
                />
                <XAxis
                  dataKey="week"
                  tickFormatter={shortDate}
                  tick={{ fill: axis, fontSize: 11 }}
                />
                <YAxis
                  tick={{ fill: axis, fontSize: 11 }}
                  unit={areaUnit}
                  width={64}
                />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey={areaKey}
                  name={strength ? "주간 볼륨" : "주간 소모"}
                  stroke={VOLUME}
                  strokeWidth={2}
                  fill="url(#volumeFill)"
                  dot={{ r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {strength ? (
            <>
              <h3 className="mt-3 text-sm font-bold">
                추정 1RM{best > 0 ? ` · 최고 ${best}kg` : ""}
              </h3>
              <p className="text-xs text-muted-foreground">
                Epley 식(중량 × (1 + 횟수 ÷ 30))으로 추정했고, 1~12회 기록만
                씁니다.
              </p>
              {oneRm.length === 0 ? (
                <p className="mt-1 text-sm">
                  중량과 횟수가 있는 기록이 없어 1RM을 추정하지 못했습니다.
                </p>
              ) : (
                <div className="mt-1 h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={axis}
                        opacity={0.25}
                      />
                      <XAxis
                        type="number"
                        dataKey="time"
                        name="날짜"
                        domain={[
                          (first: number) => first - 3 * DAY_MS,
                          (last: number) => last + 3 * DAY_MS,
                        ]}
                        tickFormatter={fromTime}
                        tick={{ fill: axis, fontSize: 11 }}
                      />
                      <YAxis
                        type="number"
                        dataKey="oneRm"
                        name="추정 1RM"
                        unit="kg"
                        width={64}
                        domain={["auto", "auto"]}
                        tick={{ fill: axis, fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value, name) =>
                          name === "날짜"
                            ? fromTime(Number(value))
                            : `${String(value)}kg`
                        }
                      />
                      <Scatter data={oneRm} name="추정 1RM" fill={ONE_RM} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          ) : null}

          <p className="mt-3 text-sm">{data.feedback}</p>

          <h3 className="mt-3 text-sm font-bold">최근 기록</h3>
          {shownLogs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              최근 30줄 안에 이 종목 기록이 없습니다.
            </p>
          ) : (
            <ul className="mt-1 max-h-56 space-y-1 overflow-auto text-xs">
              {shownLogs.map((log) => (
                <li
                  key={log.id}
                  className="rounded-lg border border-border px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-bold">{log.date}</span>{" "}
                      {logLine(log)}
                    </span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() =>
                        setDeleteId(deleteId === log.id ? null : log.id)
                      }
                      className="shrink-0 rounded-full border border-red-600/50 px-2 py-0.5 text-red-600 disabled:opacity-60"
                    >
                      지우기
                    </button>
                  </div>
                  {deleteId === log.id ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span>이 한 줄을 지울까요? 되돌릴 수 없습니다.</span>
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void remove(log)}
                        className="rounded-lg bg-red-600 px-2 py-0.5 font-bold text-white disabled:opacity-60"
                      >
                        {deleting ? "지우는 중…" : "지우기"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(null)}
                        className="rounded-lg border border-border px-2 py-0.5"
                      >
                        취소
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {notice ? <p className="mt-2 text-sm">{notice}</p> : null}
        </>
      )}
      <SourceFooter
        libs={["recharts"]}
        note="소모 칼로리는 저장된 체중과 MET(근력 5, 유산소 7)로 추정한 값입니다. 1RM은 Epley 식입니다."
      />
      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "workout-chart",
          exercise: selected?.exercise ?? "",
          bestOneRmKg: best,
          lastWeek: selected?.weekly.at(-1) ?? null,
        })}
      />
    </div>
  );
}

function WorkoutChartLoaded({
  data,
  theme,
}: {
  data: WorkoutChartData;
  theme: string;
}) {
  const accountKey = useAccountKey(data.accountKey || undefined);
  return <WorkoutChartPanel data={data} theme={theme} accountKey={accountKey} />;
}

export default function WorkoutChart() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"show-workout-chart">();
  if (!toolInfo.isSuccess) return null;
  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <WorkoutChartLoaded data={toolInfo.output} theme={theme} />
    </div>
  );
}
