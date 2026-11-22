import "@/index.css";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "skybridge/web";
import { useToolInfo } from "@/helpers.js";
import { localNoonPassed } from "@/device-time.js";
import {
  countGoodDaysInPeriod,
  stickerForDay,
  type HabitStickerKind,
} from "@/habit-stickers.js";
import tryHarderSticker from "@/widgets/노력하세요.png";
import wellDoneSticker from "@/widgets/참잘했어요.png";
import {
  HabitGrowthTree,
  resolveHabitGrowth,
} from "./habit-growth-tree.js";

export type HabitCalendarData = Extract<
  ReturnType<typeof useToolInfo<"show-habit-calendar">>,
  { isSuccess: true }
>["output"];

type DayStatus = "met" | "over" | "far-over" | "none";
type DayRow = HabitCalendarData["days"][number];

const MET = "#16a34a";
const OVER = "#f59e0b";
const FAR_OVER = "#dc2626";

const statusLabel = {
  met: "목표 안",
  over: "목표 초과",
  "far-over": "크게 초과",
  none: "식사 기록 없음",
} as const;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function monthKey(date: string) {
  return date.slice(0, 7);
}

function shiftMonth(ym: string, delta: number) {
  const [year = 1970, month = 1] = ym.split("-").map(Number);
  const cursor = new Date(year, month - 1 + delta, 1);
  const nextYear = cursor.getFullYear();
  const nextMonth = String(cursor.getMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

function monthTitle(ym: string) {
  const [year = "1970", month = "1"] = ym.split("-");
  return `${year}년 ${Number(month)}월`;
}

function daysInMonth(ym: string) {
  const [year = 1970, month = 1] = ym.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return Array.from({ length: last }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${ym}-${day}`;
  });
}

/** Sunday-first month grid with leading/trailing blanks. */
function monthCells(ym: string) {
  const days = daysInMonth(ym);
  const first = new Date(`${days[0]}T12:00:00`);
  const leading = first.getDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function cellColor(day: DayRow | undefined, empty: string): string {
  if (!day || day.status === "none") return empty;
  if (day.status === "met") return MET;
  if (day.status === "over") return OVER;
  return FAR_OVER;
}

function eachDate(start: string, end: string): string[] {
  if (start > end) return [];
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    const next = new Date(`${cursor}T12:00:00`);
    next.setDate(next.getDate() + 1);
    cursor = next.toLocaleDateString("en-CA");
  }
  return out;
}

export function HabitCalendarPanel({
  data,
  theme,
}: {
  data: HabitCalendarData;
  theme: string;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const dark = theme === "dark";
  const empty = dark ? "#3f3f46" : "#e4e4e7";
  const byDay = useMemo(
    () => new Map(data.days.map((day) => [day.day, day])),
    [data.days],
  );

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const firstMonth = monthKey(data.startDate);
  const lastMonth = monthKey(data.endDate);
  const [month, setMonth] = useState(lastMonth);

  const canPrev = month > firstMonth;
  const canNext = month < lastMonth;
  const cells = monthCells(month);
  const { summary } = data;
  const selected = selectedDay ? byDay.get(selectedDay) : undefined;
  const goalBurnKcal =
    typeof data.goalBurnKcal === "number" && data.goalBurnKcal > 0
      ? data.goalBurnKcal
      : Math.round(data.goalKcal * 0.15);

  const growthMeta = data.growth;
  const targetDays =
    typeof growthMeta?.targetDays === "number" && growthMeta.targetDays > 0
      ? growthMeta.targetDays
      : typeof data.targetDays === "number" && data.targetDays > 0
        ? data.targetDays
        : 0;
  const periodStart =
    typeof growthMeta?.periodStart === "string" && growthMeta.periodStart
      ? growthMeta.periodStart
      : "";
  const periodEnd =
    typeof growthMeta?.periodEnd === "string" && growthMeta.periodEnd
      ? growthMeta.periodEnd
      : "";
  const bodyGoalSaved = Boolean(
    growthMeta?.bodyGoalSaved && periodStart && periodEnd && targetDays > 0,
  );
  const stickerPeriod = bodyGoalSaved
    ? { start: periodStart, end: periodEnd }
    : null;
  const restDays = useMemo(
    () => new Set(Array.isArray(data.restDays) ? data.restDays : []),
    [data.restDays],
  );

  // Always count on device — noon gate must use the widget clock.
  const goodDays = useMemo(() => {
    if (!bodyGoalSaved || !periodStart || !periodEnd) return 0;
    return countGoodDaysInPeriod({
      periodStart,
      periodEnd,
      days: data.days,
      goalKcal: data.goalKcal,
      goalBurnKcal,
      now,
      eachDate,
      restDays,
    });
  }, [
    bodyGoalSaved,
    periodStart,
    periodEnd,
    data.days,
    data.goalKcal,
    goalBurnKcal,
    now,
    restDays,
  ]);

  const growth = resolveHabitGrowth({
    targetDays,
    periodStart,
    periodEnd,
    goodDays,
    bodyGoalSaved,
  });

  return (
    <div className="min-h-[20rem] rounded-xl border border-border bg-background p-4 text-foreground">
      <div>
        <h2 className="text-lg font-bold">성실도 달력</h2>
        <p className="text-xs text-muted-foreground">
          {data.startDate} ~ {data.endDate} · 목표 {data.goalKcal}kcal ·{" "}
          {data.goalSourceLabel}
          {data.clientTimeZone ? ` · ${data.clientTimeZone}` : ""}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {bodyGoalSaved
            ? `스티커는 워너비 기간 ${periodStart}~${periodEnd} · 오후 12시 이후. 운동 쉬는 날(주간 코스 X)은 참잘했어요.`
            : "워너비 체형·기한을 저장하면 그 시작일부터 기한까지 스티커가 붙습니다."}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => {
            setMonth((current) => shiftMonth(current, -1));
            setSelectedDay(null);
          }}
          className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          이전
        </button>
        <h3 className="text-base font-bold tabular-nums">{monthTitle(month)}</h3>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => {
            setMonth((current) => shiftMonth(current, 1));
            setSelectedDay(null);
          }}
          className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          다음
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="py-1 text-xs font-bold text-muted-foreground"
          >
            {label}
          </div>
        ))}
        {cells.map((day, index) => {
          if (!day) {
            return <div key={`blank-${index}`} className="aspect-square" />;
          }
          const row = byDay.get(day);
          const color = cellColor(row, empty);
          const inRange = day >= data.startDate && day <= data.endDate;
          const dayNum = Number(day.slice(8, 10));
          const active = selectedDay === day;
          const onEmpty = color === empty;
          const sticker: HabitStickerKind | null = inRange
            ? stickerForDay(
                day,
                row,
                data.goalKcal,
                goalBurnKcal,
                now,
                stickerPeriod,
                restDays.has(day),
              )
            : null;
          return (
            <button
              key={day}
              type="button"
              disabled={!inRange}
              onClick={() => setSelectedDay(day)}
              className={`relative aspect-square overflow-hidden rounded-lg text-sm font-bold tabular-nums transition disabled:opacity-30 ${
                active
                  ? "ring-2 ring-blue-600 ring-offset-1 ring-offset-background"
                  : ""
              }`}
              style={{
                background: inRange ? color : "transparent",
                color: inRange
                  ? onEmpty
                    ? dark
                      ? "#e4e4e7"
                      : "#18181b"
                    : "#ffffff"
                  : undefined,
              }}
              title={
                sticker === "good"
                  ? `${day} · 참잘했어요`
                  : sticker === "try"
                    ? `${day} · 노력하세요`
                    : day
              }
            >
              {sticker ? (
                <img
                  src={sticker === "good" ? wellDoneSticker : tryHarderSticker}
                  alt={sticker === "good" ? "참잘했어요" : "노력하세요"}
                  className="pointer-events-none absolute inset-[6%] h-[88%] w-[88%] object-contain drop-shadow-sm"
                  draggable={false}
                />
              ) : null}
              <span
                className={`relative z-10 inline-block min-w-[1.1em] rounded-md px-0.5 ${
                  sticker ? "bg-black/55 text-white shadow-sm" : ""
                }`}
              >
                {dayNum}
              </span>
            </button>
          );
        })}
      </div>

      <HabitGrowthTree growth={growth} />

      {selectedDay ? (
        <div className="mt-3 rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-bold tabular-nums">
            {selectedDay.slice(0, 4)}년 {Number(selectedDay.slice(5, 7))}월{" "}
            {Number(selectedDay.slice(8, 10))}일
          </p>
          <p className="mt-1 text-muted-foreground">
            {selected
              ? `${statusLabel[selected.status as DayStatus]} · 섭취 ${selected.kcal}kcal`
              : "식사 기록 없음"}
          </p>
          {selected?.worked ? (
            <p className="text-muted-foreground">
              운동 소모 {selected.burnedKcal}kcal
            </p>
          ) : (
            <p className="text-muted-foreground">운동 기록 없음</p>
          )}
          {(() => {
            const isRest = restDays.has(selectedDay);
            const kind = stickerForDay(
              selectedDay,
              selected,
              data.goalKcal,
              goalBurnKcal,
              now,
              stickerPeriod,
              isRest,
            );
            if (!kind) {
              if (!stickerPeriod) {
                return (
                  <p className="mt-1 text-xs text-muted-foreground">
                    워너비 체형 기한을 정하면 스티커가 붙습니다.
                  </p>
                );
              }
              if (
                selectedDay < stickerPeriod.start ||
                selectedDay > stickerPeriod.end
              ) {
                return (
                  <p className="mt-1 text-xs text-muted-foreground">
                    스티커는 워너비 기간({stickerPeriod.start}~
                    {stickerPeriod.end})에만 붙습니다.
                  </p>
                );
              }
              return !localNoonPassed(selectedDay, now) ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  스티커는 이날 오후 12시 이후에 붙습니다.
                </p>
              ) : null;
            }
            return (
              <p className="mt-1 font-semibold">
                {kind === "good"
                  ? isRest
                    ? "참잘했어요 (운동 쉬는 날)"
                    : "참잘했어요"
                  : "노력하세요"}
              </p>
            );
          })()}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          날짜를 누르면 그날 식단·운동 기록이 나옵니다.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: MET }} />
          목표 안 {summary.metDays}일
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OVER }} />
          초과 {summary.overDays}일
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: FAR_OVER }}
          />
          크게 초과 {summary.farOverDays}일
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: empty }} />
          미기록 {summary.missedDays}일
        </span>
        <span className="inline-flex items-center gap-1">
          <img
            src={wellDoneSticker}
            alt=""
            className="h-5 w-5 object-contain"
            draggable={false}
          />
          참잘했어요 (소모↑ 또는 쉬는 날 · 12시 후)
        </span>
        <span className="inline-flex items-center gap-1">
          <img
            src={tryHarderSticker}
            alt=""
            className="h-5 w-5 object-contain"
            draggable={false}
          />
          노력하세요 (워너비 기간 · 미기록·섭취↑ · 12시 후)
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg border border-border py-2">
          <div className="text-muted-foreground">기록한 날</div>
          <div className="text-base font-bold">
            {summary.loggedDays}/{summary.totalDays}
          </div>
        </div>
        <div className="rounded-lg border border-border py-2">
          <div className="text-muted-foreground">연속 기록</div>
          <div className="text-base font-bold">{summary.currentStreak}일</div>
        </div>
        <div className="rounded-lg border border-border py-2">
          <div className="text-muted-foreground">운동한 날</div>
          <div className="text-base font-bold">{summary.workoutDays}일</div>
        </div>
      </div>

      <p className="mt-3 text-sm">{data.feedback}</p>
      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "habit-calendar",
          month,
          selectedDay,
          startDate: data.startDate,
          endDate: data.endDate,
          summary,
          clientDate: data.clientDate ?? null,
          clientTimeZone: data.clientTimeZone ?? null,
          growth,
          stickers: {
            window: bodyGoalSaved
              ? `${periodStart}~${periodEnd}`
              : "none — set body goal first",
            good: "참잘했어요 — 워너비 기간 + 소모 kcal ≥ 목표 운동 (12:00 이후)",
            try: "노력하세요 — 워너비 기간 + 미기록/섭취 초과 (12:00 이후)",
          },
        })}
      />
    </div>
  );
}

export default function HabitCalendar() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"show-habit-calendar">();
  if (!toolInfo.isSuccess) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} min-h-[20rem] rounded-xl border border-border bg-background p-4 text-foreground`}
      >
        <p className="text-sm text-muted-foreground">성실도 달력을 불러오는 중…</p>
      </div>
    );
  }
  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <HabitCalendarPanel data={toolInfo.output} theme={theme} />
    </div>
  );
}
