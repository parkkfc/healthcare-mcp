import { localNoonPassed } from "./device-time.js";

export type HabitStickerKind = "try" | "good";

export type HabitDayLike = {
  status?: string;
  kcal?: number;
  burnedKcal?: number;
  worked?: boolean;
} | null
  | undefined;

export type StickerPeriod = { start: string; end: string };

/**
 * 기록 없음·섭취 과다 → 노력하세요
 * 기록 있고 소모가 목표 운동 kcal 이상 → 참잘했어요
 * (소모가 충분하면 섭취 초과여도 참잘했어요 우선)
 * 주간 코스 휴식일(mark X) → 무조건 참잘했어요
 * 기기 로컬 그날 오후 12시가 지나야 붙음.
 * 워너비 기한 창(period) 밖이면 스티커 없음.
 */
export function stickerForDay(
  dayKey: string,
  day: HabitDayLike,
  goalKcal: number,
  goalBurnKcal: number,
  now: Date,
  period?: StickerPeriod | null,
  isRestDay = false,
): HabitStickerKind | null {
  if (period) {
    if (!period.start || !period.end) return null;
    if (dayKey < period.start || dayKey > period.end) return null;
  } else if (period === null) {
    // Explicit null = body goal window not set → no stickers.
    return null;
  }
  if (!localNoonPassed(dayKey, now)) return null;
  // Planned rest day: always well-done (no burn requirement).
  if (isRestDay) return "good";
  const burnGoal = Math.max(100, goalBurnKcal || Math.round(goalKcal * 0.15));
  const highBurn = Boolean(day?.worked && (day.burnedKcal ?? 0) >= burnGoal);
  const hasMeal = Boolean(day && day.status !== "none");
  const highIntake =
    hasMeal &&
    (day!.status === "over" ||
      day!.status === "far-over" ||
      (day!.kcal ?? 0) > goalKcal);

  if ((hasMeal || day?.worked) && highBurn) return "good";
  if (!hasMeal || highIntake) return "try";
  return null;
}

export const TREE_STAGE_COUNT = 6;

export const TREE_STAGE_META = [
  { level: 1, label: "씨앗", emoji: "🌰" },
  { level: 2, label: "새싹", emoji: "🌱" },
  { level: 3, label: "묘목", emoji: "🌿" },
  { level: 4, label: "어린 나무", emoji: "🪴" },
  { level: 5, label: "울창한 나무", emoji: "🌳" },
  { level: 6, label: "꽃·열매 맺은 거목", emoji: "🌸" },
] as const;

/** 워너비 기한(targetDays)을 6단계로 균등 분배. 참잘 0일이면 1단계. */
export function growthStageFromGoodDays(
  goodDays: number,
  targetDays: number,
): number {
  if (targetDays <= 0) return 1;
  const per = targetDays / TREE_STAGE_COUNT;
  if (per <= 0) return 1;
  return Math.min(
    TREE_STAGE_COUNT,
    Math.max(1, Math.floor(Math.max(0, goodDays) / per) + 1),
  );
}

export function countGoodDaysInPeriod(input: {
  periodStart: string;
  periodEnd: string;
  days: Iterable<{ day: string } & HabitDayLike>;
  goalKcal: number;
  goalBurnKcal: number;
  now: Date;
  eachDate: (start: string, end: string) => string[];
  restDays?: Iterable<string>;
}): number {
  if (!input.periodStart || !input.periodEnd) return 0;
  const period = { start: input.periodStart, end: input.periodEnd };
  const rest = new Set(input.restDays ?? []);
  const byDay = new Map(
    [...input.days].map((row) => [row.day, row] as const),
  );
  let good = 0;
  for (const day of input.eachDate(input.periodStart, input.periodEnd)) {
    if (
      stickerForDay(
        day,
        byDay.get(day),
        input.goalKcal,
        input.goalBurnKcal,
        input.now,
        period,
        rest.has(day),
      ) === "good"
    ) {
      good += 1;
    }
  }
  return good;
}
