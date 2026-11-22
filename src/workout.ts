/**
 * Workout math shared by the server and the log card.
 *
 * Volume is weight × reps × sets. 1RM uses Epley: weight × (1 + reps / 30),
 * for 1 to 12 reps only. Burned kcal is a MET estimate: MET × body weight kg ×
 * hours, with MET 5 for strength and 7 for cardio. A strength entry without a
 * duration counts 2.5 minutes per set. When weight·reps·sets are present, a
 * light load factor bumps strength burn so heavier sets count a bit more.
 */

export type WorkoutKind = "strength" | "cardio";

export const MET: Record<WorkoutKind, number> = { strength: 5, cardio: 7 };
export const MINUTES_PER_SET = 2.5;

export function workoutVolume(weightKg: number, reps: number, sets: number) {
  return Math.max(0, weightKg) * Math.max(0, reps) * Math.max(0, sets);
}

export function estimateOneRm(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps < 1 || reps > 12) return 0;
  if (reps === 1) return weightKg;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

export function effectiveMinutes(
  kind: WorkoutKind,
  durationMin: number,
  sets: number,
): number {
  if (durationMin > 0) return durationMin;
  return kind === "strength" && sets > 0 ? sets * MINUTES_PER_SET : 0;
}

/** Strength load bump from external weight × reps × sets vs body weight. */
export function strengthLoadFactor(
  weightKg: number,
  reps: number,
  sets: number,
  bodyWeightKg: number,
): number {
  if (bodyWeightKg <= 0 || weightKg <= 0 || reps <= 0 || sets <= 0) return 1;
  const volume = workoutVolume(weightKg, reps, sets);
  return 1 + Math.min(0.4, volume / (bodyWeightKg * 50));
}

export function estimateBurnedKcal(
  kind: WorkoutKind,
  durationMin: number,
  sets: number,
  bodyWeightKg: number,
  weightKg = 0,
  reps = 0,
  metOverride?: number,
): number {
  if (bodyWeightKg <= 0) return 0;
  const minutes = effectiveMinutes(kind, durationMin, sets);
  if (minutes <= 0) return 0;
  const met =
    metOverride != null && metOverride > 0 ? metOverride : MET[kind];
  const load =
    kind === "strength"
      ? strengthLoadFactor(weightKg, reps, sets, bodyWeightKg)
      : 1;
  return Math.round(met * bodyWeightKg * (minutes / 60) * load);
}

const CARDIO_NAMES = [
  "줄넘기",
  "달리기",
  "러닝",
  "조깅",
  "걷기",
  "산책",
  "자전거",
  "사이클",
  "수영",
  "등산",
  "하이킹",
  "엘립티컬",
  "런닝머신",
  "러닝머신",
  "트레드밀",
] as const;

const STRENGTH_NAMES = [
  "데드리프트",
  "벤치프레스",
  "스쿼트",
  "런지",
  "풀업",
  "턱걸이",
  "푸시업",
  "팔굽혀펴기",
  "딥스",
  "로우",
  "숄더프레스",
  "오버헤드프레스",
  "레그프레스",
  "힙쓰러스트",
  "힙 쓰러스트",
  "플랭크",
  "크런치",
  "컬",
  "랫풀다운",
] as const;

function firstNumber(
  text: string,
  patterns: RegExp[],
): number {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = Number.parseFloat(match[1].replace(",", "."));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/** 카드 자연어 문장에서 종목·시간·거리·세트·중량을 뽑는다. */
export function parseWorkoutNote(note: string): {
  exercise: string;
  kind: WorkoutKind;
  durationMin: number;
  distanceKm: number;
  weightKg: number;
  reps: number;
  sets: number;
} {
  const text = note.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  let exercise = "";
  let kind: WorkoutKind = "strength";
  for (const name of CARDIO_NAMES) {
    if (text.includes(name) || lower.includes(name.toLowerCase())) {
      exercise = name;
      kind = "cardio";
      break;
    }
  }
  if (!exercise) {
    for (const name of STRENGTH_NAMES) {
      if (text.includes(name) || lower.includes(name.toLowerCase())) {
        exercise = name;
        kind = "strength";
        break;
      }
    }
  }
  if (!exercise) {
    const first = text.split(/[\s,./·]+/)[0] ?? text;
    exercise = first.slice(0, 24) || "운동";
    if (
      /뛰|걸|달리|런|조깅|수영|자전거|사이클|줄넘/.test(text)
    ) {
      kind = "cardio";
    }
  }

  const hours = firstNumber(text, [
    /(\d+(?:\.\d+)?)\s*시간/,
    /(\d+(?:\.\d+)?)\s*hours?/i,
    /(\d+(?:\.\d+)?)\s*hrs?/i,
  ]);
  const minutes = firstNumber(text, [
    /(\d+(?:\.\d+)?)\s*분/,
    /(\d+(?:\.\d+)?)\s*mins?/i,
    /(\d+(?:\.\d+)?)\s*minutes?/i,
  ]);
  const durationMin = Math.round(hours * 60 + minutes);
  const distanceKm = firstNumber(text, [
    /(\d+(?:\.\d+)?)\s*km/i,
    /(\d+(?:\.\d+)?)\s*킬로/,
    /(\d+(?:\.\d+)?)\s*킬로미터/,
  ]);
  const weightKg = firstNumber(text, [
    /(\d+(?:\.\d+)?)\s*kg/i,
    /(\d+(?:\.\d+)?)\s*킬로그램/,
    /(\d+(?:\.\d+)?)\s*키로(?!미터)/,
  ]);
  const reps = Math.round(
    firstNumber(text, [
      /(\d+)\s*회/,
      /(\d+)\s*번/,
      /(\d+)\s*reps?/i,
    ]),
  );
  const sets = Math.round(
    firstNumber(text, [
      /(\d+)\s*세트/,
      /(\d+)\s*셋/,
      /(\d+)\s*sets?/i,
    ]),
  );

  // 거리만 있고 시간이 없으면 대략 페이스로 분을 채운다(달리기 ~5.5분/km, 걷기 ~12분/km).
  let minutesOut = durationMin;
  if (minutesOut <= 0 && distanceKm > 0 && kind === "cardio") {
    const perKm = /걷|산책|워킹|walk/i.test(text) ? 12 : 5.5;
    minutesOut = Math.round(distanceKm * perKm);
  }

  return {
    exercise,
    kind,
    durationMin: minutesOut,
    distanceKm,
    weightKg,
    reps,
    sets,
  };
}

/** Monday of the week that holds a YYYY-MM-DD date. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}
