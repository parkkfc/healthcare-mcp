import "@/index.css";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import MuscleBody, {
  type BodyProps,
  type ExtendedBodyPart,
} from "react-muscle-highlighter";
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { useDisplayMode, useOpenExternal, useUser } from "skybridge/web";
import {
  analyzeInbodyWorkout,
  homeEquipmentIds,
  homeEquipmentLabel,
  injuredPartLabel,
  isBodyweightExercise,
  modeLabel,
  normalizeHomeEquipment,
  phaseLabel,
  scaleTimer,
  trainingVenueLabel,
  trainingVenues,
  type HomeEquipment,
  type InjuredPart,
  type SessionPrescription,
  type TrainingVenue,
  type WorkoutTimerMode,
  workoutTimerModes,
} from "@/inbody-analyzer.js";
import type { TargetBodyType } from "@/body-goals.js";
import { shapeNote, type BodyShape } from "@/cid.js";
import {
  calculateWorkingRepsFromMax,
  calculateWorkingWeight,
  type LiftCategory,
} from "@/strength-calculator.js";
import {
  WEEKDAY_ORDER,
  buildWeekCalendar,
  dateInSameWeek,
  sessionKindLabel,
} from "@/workout-schedule.js";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { deviceToday } from "@/device-time.js";
import { TermTip, withTermTips } from "./components/term-tip.js";
import { useAccountKey } from "./use-account-key.js";

const Body =
  typeof MuscleBody === "function"
    ? (MuscleBody as (props: BodyProps) => ReactElement)
    : (
        MuscleBody as unknown as {
          default: (props: BodyProps) => ReactElement;
        }
      ).default;

const WEAK = "#eab308";
const TARGET = "#ef4444";

export type InbodyWorkoutData = Extract<
  ReturnType<typeof useToolInfo<"recommend-inbody-workout">>,
  { isSuccess: true }
>["output"];

type Exercise = InbodyWorkoutData["exercises"][number];

const modeMeta: Record<
  WorkoutTimerMode,
  { label: string; hint: string; term: "rest_timer" | "emom" | "amrap" | "stopwatch" }
> = {
  rest_timer: {
    label: "세트별 휴식",
    hint: "한 세트 후 쉬는 시간을 재고 다음 세트로 갑니다.",
    term: "rest_timer",
  },
  emom: {
    label: "EMOM",
    hint:
      "매 분 시작에 목표 횟수를 하고, 남은 시간은 쉽니다. 운동 중 휴식 시간이 길어지면 심박수가 떨어져 지방 연소 효율이 급감하므로, 단시간 내에 최대 칼로리를 소모하기 위해 시간을 통제합니다.",
    term: "emom",
  },
  amrap: {
    label: "AMRAP",
    hint:
      "여러 개의 다관절 복합 운동을 하나로 묶은 운동 코스(루틴)를 순환하며 반복하는 방식입니다. 마지막 세트는 실패 지점까지 합니다. 운동 중 휴식 시간이 길어지면 심박수가 떨어져 지방 연소 효율이 급감하므로, 단시간 내에 최대 칼로리를 소모하기 위해 시간을 통제합니다.",
    term: "amrap",
  },
  stopwatch: {
    label: "스톱워치",
    hint: "시간 제한 없이 총 경과만 잽니다.",
    term: "stopwatch",
  },
};

function repsRangeForPrescription(rx: SessionPrescription): string {
  if (rx.pct1RmMax <= 60) return "12~15회";
  if (rx.pct1RmMin >= 80) return "1~5회";
  return "8~12회";
}

function shapeGoalWord(shape: string): string {
  if (shape === "C") return "체중감량·근육 채우기";
  if (shape === "D") return "근력·골격근 유지·강화";
  return "체성분 재구성";
}

function modeBecause(input: {
  mode: WorkoutTimerMode;
  shape: string;
  isImbalanced: boolean;
  recoverOnly: boolean;
  avoidHiit: boolean;
  targetBodyLabel: string;
}): string {
  if (input.recoverOnly) {
    return "체수분(ECW) 위험이 있어 강도·시간을 낮춘 회복형 스톱워치로 잡았습니다.";
  }
  if (input.isImbalanced) {
    return "좌우 비대칭이라 세트마다 쉬며 폼을 맞추는 세트별 휴식이 안전합니다.";
  }
  if (input.avoidHiit) {
    return "내장지방·고강도 유예 구간이라 인터벌보다 기초 저항+저강도 흐름이 맞습니다.";
  }
  if (input.mode === "amrap") {
    return `${input.shape === "C" ? "C자형 감량" : "체지방 관리"}에 맞춰, 다관절 3개 내외를 하나의 코스로 묶어 12분 안에 순환하는 AMRAP입니다. 맨몸·가벼운 무게·중고반복으로 돌리고, 마지막 세트는 실패 지점까지 합니다. 운동 중 휴식 시간이 길어지면 심박수가 떨어져 지방 연소 효율이 급감하므로, 단시간 내에 최대 칼로리를 소모하기 위해 시간을 통제합니다.`;
  }
  if (input.mode === "emom") {
    return "분 단위로 밀도를 유지하는 EMOM이 체성분 베이스·근지구력에 맞습니다. 운동 중 휴식 시간이 길어지면 심박수가 떨어져 지방 연소 효율이 급감하므로, 단시간 내에 최대 칼로리를 소모하기 위해 시간을 통제합니다.";
  }
  if (input.mode === "rest_timer") {
    return input.targetBodyLabel
      ? `'${input.targetBodyLabel}' 목표에 맞춰 세트 사이 휴식으로 중량·횟수 품질을 지킵니다.`
      : "중량·횟수 품질을 지키려고 세트별 휴식으로 잡았습니다.";
  }
  return "시간 제한 없이 컨디션에 맞춰 진행하는 스톱워치입니다.";
}

function buildModeWhyLines(input: {
  shape: string;
  phase: 1 | 2 | 3;
  phaseLabel: string;
  isImbalanced: boolean;
  weakLabels: string[];
  targetBodyLabel: string;
  targetDays: number | null | undefined;
  bias: string;
  sessionLabel: string;
  safetyNotes: string[];
  injuredParts: string[];
  structuralTitles: string[];
  mode: WorkoutTimerMode;
  prescription: SessionPrescription | null | undefined;
}): string[] {
  const shape = (["C", "I", "D"].includes(input.shape)
    ? input.shape
    : "I") as BodyShape;
  const shapeBit = shapeNote[shape] || `${shape}자형`;

  const situation: string[] = [];
  if (input.isImbalanced || input.phase === 1) {
    situation.push("좌우 비대칭·교정 단계");
  }
  if (input.weakLabels.length > 0) {
    situation.push(`취약 부위 ${input.weakLabels.join(", ")}`);
  }
  if (input.bias === "upper") situation.push("이번 주는 상체 중심");
  else if (input.bias === "lower") situation.push("이번 주는 하체 중심");
  if (input.injuredParts.length > 0) {
    situation.push(
      `불편 부위 ${input.injuredParts
        .map((p) => injuredPartLabel[p as InjuredPart] ?? p)
        .join(", ")}`,
    );
  }
  if (input.structuralTitles.length > 0) {
    situation.push(`구조 이슈 ${input.structuralTitles.join(", ")}`);
  }
  const recoverOnly = input.safetyNotes.some((n) => /ECW|세포외수분/.test(n));
  const avoidHiit = input.safetyNotes.some((n) => /VFL|내장지방|HIIT/.test(n));
  if (recoverOnly) situation.push("체수분(ECW) 주의·고강도 유예");
  else if (avoidHiit) situation.push("내장지방 보호·HIIT 유예");
  if (situation.length === 0) {
    situation.push(`${input.sessionLabel || "오늘 코스"} · 균형 유지`);
  }

  const goalBits: string[] = [];
  if (input.targetBodyLabel) {
    goalBits.push(`워너비 '${input.targetBodyLabel}'`);
  } else {
    goalBits.push(shapeGoalWord(shape));
  }
  if (input.targetDays && input.targetDays > 0) {
    goalBits.push(`목표 기한 ${input.targetDays}일`);
  }
  goalBits.push(input.phaseLabel || phaseLabel[input.phase]);

  const rx = input.prescription;
  const therefore: string[] = [
    `운동방법 ${modeLabel[input.mode]}`,
  ];
  if (rx && rx.pct1RmMax > 0) {
    therefore.push(`운동무게 1RM의 ${rx.pct1RmMin}~${rx.pct1RmMax}%`);
    therefore.push(`1세트 ${repsRangeForPrescription(rx)}`);
    if (rx.sets > 0) therefore.push(`${rx.sets}세트`);
  }
  const because = modeBecause({
    mode: input.mode,
    shape,
    isImbalanced: input.isImbalanced || input.phase === 1,
    recoverOnly,
    avoidHiit,
    targetBodyLabel: input.targetBodyLabel,
  });

  return [
    `내 체형: ${shapeBit}`,
    `지금 상황: ${situation.join(" · ")}`,
    `내 목표: ${goalBits.join(" · ")}`,
    `그래서 이렇게: ${therefore.join(" · ")}`,
    `이유: ${because}`,
  ];
}

const jargonInText: Array<{
  match: string;
  term: Parameters<typeof withTermTips>[1][number]["term"];
}> = [
  { match: "AMRAP", term: "amrap" },
  { match: "EMOM", term: "emom" },
  { match: "%1RM", term: "pct_1rm" },
  { match: "1RM", term: "one_rm" },
  { match: "최대 횟수", term: "max_reps" },
  { match: "RIR", term: "rir" },
  { match: "RPE", term: "rpe" },
  { match: "HIRT", term: "hirt" },
  { match: "LISS", term: "liss" },
  { match: "C-I-D", term: "cid" },
  { match: "Phase", term: "phase" },
  { match: "편측", term: "unilateral" },
  { match: "고립", term: "isolation" },
  { match: "복합", term: "compound" },
];

function formatClock(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function regionParts(
  key: string,
): Array<{ slug: ExtendedBodyPart["slug"]; side?: "left" | "right" }> {
  switch (key) {
    case "upperLeft":
      return [
        { slug: "deltoids", side: "left" },
        { slug: "biceps", side: "left" },
        { slug: "chest", side: "left" },
      ];
    case "upperRight":
      return [
        { slug: "deltoids", side: "right" },
        { slug: "biceps", side: "right" },
        { slug: "chest", side: "right" },
      ];
    case "core":
      return [{ slug: "abs" }, { slug: "obliques" }];
    case "lowerLeft":
      return [
        { slug: "quadriceps", side: "left" },
        { slug: "calves", side: "left" },
      ];
    case "lowerRight":
      return [
        { slug: "quadriceps", side: "right" },
        { slug: "calves", side: "right" },
      ];
    default:
      return [];
  }
}

type MuscleHit = {
  slug: ExtendedBodyPart["slug"];
  side?: "left" | "right";
  role: "primary" | "secondary";
};

function bothSides(
  slug: ExtendedBodyPart["slug"],
  role: "primary" | "secondary",
): MuscleHit[] {
  return [
    { slug, side: "left", role },
    { slug, side: "right", role },
  ];
}

/** Map a planned move to front-body muscles for the anatomy highlighter. */
function exerciseMuscleHits(
  item: Pick<Exercise, "slug" | "nameKo" | "region">,
): { hits: MuscleHit[]; labels: string[] } {
  const text = `${item.slug} ${item.nameKo}`;
  const hits: MuscleHit[] = [];
  const labels: string[] = [];
  const add = (parts: MuscleHit[], label: string) => {
    hits.push(...parts);
    if (!labels.includes(label)) labels.push(label);
  };

  if (/플라이|fly|풀어파트|벤치|푸시업|push.?up|체스트|인클라인/.test(text)) {
    add(bothSides("chest", "primary"), "가슴");
    add(bothSides("deltoids", "secondary"), "어깨");
    add(bothSides("triceps", "secondary"), "삼두");
  } else if (/숄더|오버헤드|레터럴|사이드 레이즈|lateral/.test(text)) {
    add(bothSides("deltoids", "primary"), "어깨");
    add(bothSides("trapezius", "secondary"), "승모");
  } else if (/트라이|삼두|푸시다운|킥백/.test(text)) {
    add(bothSides("triceps", "primary"), "삼두");
    add(bothSides("forearm", "secondary"), "전완");
  } else if (/이두|바이셉|프리처|인클라인 컬|덤벨 컬|바벨 컬/.test(text)) {
    add(bothSides("biceps", "primary"), "이두");
    add(bothSides("forearm", "secondary"), "전완");
  } else if (/로우|row|풀업|풀다운|랫|chin|리버스|후면/.test(text)) {
    add(bothSides("trapezius", "primary"), "등·승모");
    add(bothSides("biceps", "secondary"), "이두");
    add(bothSides("forearm", "secondary"), "전완");
  } else if (/스쿼트|런지|lunge|스텝|불가리안|익스텐션|extension/.test(text)) {
    add(bothSides("quadriceps", "primary"), "대퇴사두");
    add(bothSides("adductors", "secondary"), "내전근");
  } else if (/데드|루마니안|rdl|쓰러스트|브릿지|스윙|레그컬|leg.?curl/.test(text)) {
    add(bothSides("adductors", "primary"), "햄·둔근(전면 표시)");
    add(bothSides("quadriceps", "secondary"), "대퇴사두");
  } else if (/카프|종아리|calf/.test(text)) {
    add(bothSides("calves", "primary"), "종아리");
  } else if (/플랭크|크런치|데드버그|버드독|니 레이즈|레그 레이즈|코어/.test(text)) {
    add([{ slug: "abs", role: "primary" }], "복근");
    add([{ slug: "obliques", role: "secondary" }], "복사근");
  } else if (item.region === "upper") {
    add(bothSides("chest", "primary"), "상체");
    add(bothSides("deltoids", "secondary"), "어깨");
  } else if (item.region === "lower") {
    add(bothSides("quadriceps", "primary"), "하체");
    add(bothSides("calves", "secondary"), "종아리");
  } else if (item.region === "core") {
    add([{ slug: "abs", role: "primary" }], "코어");
    add([{ slug: "obliques", role: "secondary" }], "복사근");
  } else {
    add(bothSides("chest", "primary"), "전신");
    add(bothSides("quadriceps", "primary"), "하체");
    add([{ slug: "abs", role: "secondary" }], "코어");
  }

  return { hits, labels };
}

/** Union of muscle hits for every move on the selected day. */
function dayMuscleHits(
  exercises: Array<Pick<Exercise, "slug" | "nameKo" | "region">>,
): { hits: MuscleHit[]; labels: string[] } {
  const byKey = new Map<string, MuscleHit>();
  const labels: string[] = [];
  for (const item of exercises) {
    const mapped = exerciseMuscleHits(item);
    for (const label of mapped.labels) {
      if (!labels.includes(label)) labels.push(label);
    }
    for (const hit of mapped.hits) {
      const key = `${hit.slug}:${hit.side ?? "both"}`;
      const prev = byKey.get(key);
      if (!prev || (prev.role === "secondary" && hit.role === "primary")) {
        byKey.set(key, hit);
      }
    }
  }
  return { hits: [...byKey.values()], labels };
}

function regionScoresForExercise(
  item: Pick<Exercise, "slug" | "nameKo" | "region">,
): Array<{ region: string; actual: number; standard: number }> {
  const text = `${item.slug} ${item.nameKo}`;
  const score = {
    "상체 좌": 0,
    "상체 우": 0,
    코어: 0,
    "하체 좌": 0,
    "하체 우": 0,
  };
  const bump = (keys: Array<keyof typeof score>, value: number) => {
    for (const key of keys) score[key] = Math.max(score[key], value);
  };
  if (/플라이|fly|풀어파트|벤치|푸시업|push|체스트|인클라인|숄더|레터럴|트라이|삼두|이두|바이셉|컬|로우|풀업|풀다운|랫|chin|리버스/.test(text) || item.region === "upper") {
    bump(["상체 좌", "상체 우"], 100);
  }
  if (/플랭크|크런치|데드버그|버드독|니 레이즈|레그 레이즈|코어/.test(text) || item.region === "core") {
    bump(["코어"], 100);
  }
  if (/스쿼트|런지|데드|루마니안|쓰러스트|브릿지|스윙|레그|카프|종아리|스텝|불가리안/.test(text) || item.region === "lower") {
    bump(["하체 좌", "하체 우"], 100);
  }
  if (item.region === "full") {
    bump(["상체 좌", "상체 우", "하체 좌", "하체 우"], 80);
    bump(["코어"], 50);
  }
  return Object.entries(score).map(([region, actual]) => ({
    region,
    actual,
    standard: 0,
  }));
}

function regionScoresForDay(
  exercises: Array<Pick<Exercise, "slug" | "nameKo" | "region">>,
): Array<{ region: string; actual: number; standard: number }> {
  const score = {
    "상체 좌": 0,
    "상체 우": 0,
    코어: 0,
    "하체 좌": 0,
    "하체 우": 0,
  };
  for (const item of exercises) {
    for (const row of regionScoresForExercise(item)) {
      const key = row.region as keyof typeof score;
      if (key in score) score[key] = Math.max(score[key], row.actual);
    }
  }
  return Object.entries(score).map(([region, actual]) => ({
    region,
    actual,
    standard: 0,
  }));
}

function AnatomyBlock({
  radar,
  weakParts,
  targetLabels,
  sex,
  theme,
  mode,
  exercise,
  dayExercises,
  dayTitle,
  onShowBody,
  onShowDay,
}: {
  radar: InbodyWorkoutData["radar"];
  weakParts: string[];
  targetLabels: string[];
  sex: string;
  theme: string;
  mode: "body" | "day" | "exercise";
  exercise?: Exercise;
  dayExercises?: Exercise[];
  dayTitle?: string;
  onShowBody: () => void;
  onShowDay?: () => void;
}) {
  const bodyData: ExtendedBodyPart[] = [];
  const bodyOverlay: ExtendedBodyPart[] = [];
  const highlightMap =
    mode === "exercise" && exercise
      ? exerciseMuscleHits(exercise)
      : mode === "day" && dayExercises && dayExercises.length > 0
        ? dayMuscleHits(dayExercises)
        : null;
  const radarData =
    mode === "exercise" && exercise
      ? regionScoresForExercise(exercise)
      : mode === "day" && dayExercises && dayExercises.length > 0
        ? regionScoresForDay(dayExercises)
        : radar;

  if (highlightMap) {
    for (const hit of highlightMap.hits) {
      const color = hit.role === "primary" ? TARGET : WEAK;
      const entry: ExtendedBodyPart = {
        slug: hit.slug,
        color,
        ...(hit.side ? { side: hit.side } : {}),
      };
      if (hit.side === "right") bodyOverlay.push(entry);
      else bodyData.push(entry);
    }
  } else {
    const targetSet = new Set(
      radar
        .filter((row) => targetLabels.includes(row.region))
        .map((row) => row.region),
    );
    const weakSet = new Set(weakParts);
    const keyByLabel: Record<string, string> = {
      "상체 좌": "upperLeft",
      "상체 우": "upperRight",
      코어: "core",
      "하체 좌": "lowerLeft",
      "하체 우": "lowerRight",
    };
    for (const label of [...weakSet, ...targetSet]) {
      const key = keyByLabel[label] ?? "";
      const color = targetSet.has(label) ? TARGET : WEAK;
      for (const part of regionParts(key)) {
        (part.side === "right" ? bodyOverlay : bodyData).push({
          slug: part.slug,
          color,
          ...(part.side ? { side: part.side } : {}),
        });
      }
    }
  }

  const axis = theme === "dark" ? "#a1a1aa" : "#71717a";
  const defaultFill = theme === "dark" ? "#3f3f46" : "#d4d4d8";
  const anatomyTitle =
    mode === "exercise" && exercise
      ? `${exercise.nameKo} 운동 부위`
      : mode === "day"
        ? dayTitle || "오늘 운동 부위"
        : "현재 내몸상태";
  const radarTitle =
    mode === "exercise" && exercise
      ? `${exercise.nameKo} 자극 부위`
      : mode === "day"
        ? "오늘 자극 부위"
        : "부위 밸런스";
  const yellowLabel =
    mode === "exercise" || mode === "day"
      ? "협응근(같이 쓰는 부위)"
      : "취약 부위(상대적으로 약함)";
  const redLabel =
    mode === "exercise"
      ? "주동근(이 운동이 주로 쓰는 부위)"
      : mode === "day"
        ? "오늘 주로 쓰는 부위"
        : "우선·워너비 타겟 부위";
  const partLabels =
    highlightMap && highlightMap.labels.length > 0
      ? highlightMap.labels.join(" · ")
      : "";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">{anatomyTitle}</h3>
          {partLabels ? (
            <p className="mt-0.5 text-[11px] font-medium text-foreground/80">
              {partLabels}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: WEAK }}
              />
              노란색 · {yellowLabel}
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: TARGET }}
              />
              빨간색 · {redLabel}
            </span>
          </div>
        </div>
        {mode === "exercise" || mode === "day" ? (
          <div className="flex flex-wrap gap-1">
            {mode === "exercise" && onShowDay ? (
              <button
                type="button"
                onClick={onShowDay}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold"
              >
                오늘 운동 부위
              </button>
            ) : null}
            <button
              type="button"
              onClick={onShowBody}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold"
            >
              현재 내몸상태 보기
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            요일을 누르면 그날 부위, 종목을 누르면 그 운동 부위로 바뀝니다.
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative flex justify-center overflow-hidden rounded-lg border border-border p-2">
          <Body
            data={bodyData}
            side="front"
            gender={sex === "female" ? "female" : "male"}
            scale={0.95}
            defaultFill={defaultFill}
            border={axis}
          />
          {bodyOverlay.length > 0 ? (
            <div className="pointer-events-none absolute inset-0 flex justify-center p-2">
              <Body
                data={bodyOverlay}
                side="front"
                gender={sex === "female" ? "female" : "male"}
                scale={0.95}
                defaultFill="transparent"
                border="transparent"
              />
            </div>
          ) : null}
        </div>
        <div>
          <h3 className="mb-1 text-sm font-bold">{radarTitle}</h3>
          {(mode === "exercise" || mode === "day") && highlightMap ? (
            <p className="mb-1 text-[11px] text-muted-foreground">
              {highlightMap.labels.join(" · ")}
            </p>
          ) : null}
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke={axis} />
                <PolarAngleAxis
                  dataKey="region"
                  tick={{ fill: axis, fontSize: 10 }}
                />
                <PolarRadiusAxis tick={{ fill: axis, fontSize: 9 }} />
                <Radar
                  name={
                    mode === "exercise" || mode === "day" ? "자극" : "현재"
                  }
                  dataKey="actual"
                  stroke="#2563eb"
                  fill="#2563eb"
                  fillOpacity={0.35}
                />
                {mode === "body" ? (
                  <Radar
                    name="평균"
                    dataKey="standard"
                    stroke="#a1a1aa"
                    fill="#a1a1aa"
                    fillOpacity={0.15}
                  />
                ) : null}
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InbodyWorkoutPanel({
  data,
  theme,
  accountKey,
}: {
  data: InbodyWorkoutData;
  theme: string;
  accountKey: string;
}) {
  const [, setDisplayMode] = useDisplayMode();
  const { callToolAsync: saveSession, isPending: saving } =
    useCallTool("save-workout-log");

  const [venue, setVenue] = useState<TrainingVenue>(
    data.trainingVenue === "home" ? "home" : "gym",
  );
  const [homeGear, setHomeGear] = useState<HomeEquipment[]>(() =>
    normalizeHomeEquipment(
      (data.homeEquipment as HomeEquipment[] | undefined) ?? ["bodyweight"],
    ),
  );

  const baseDate = data.clientDate || data.date || deviceToday();
  const todayWeekday = useMemo(() => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseDate);
    if (!match) return new Date().getDay();
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    ).getDay();
  }, [baseDate]);
  const [selectedWeekday, setSelectedWeekday] = useState(todayWeekday);
  const [weekMarkOverrides, setWeekMarkOverrides] = useState<
    Partial<Record<number, "O" | "X">>
  >({});
  const planDate = useMemo(
    () => dateInSameWeek(baseDate, selectedWeekday),
    [baseDate, selectedWeekday],
  );

  const savedWeek = data.weekPlan ?? null;
  const savedGearKey = (savedWeek?.homeEquipment ?? []).slice().sort().join(",");
  const liveGearKey = homeGear.slice().sort().join(",");
  const weekPlanMatches =
    Boolean(savedWeek) &&
    savedWeek!.venue === venue &&
    (venue !== "home" || savedGearKey === liveGearKey);

  const savedDay = useMemo(() => {
    if (!weekPlanMatches || !savedWeek) return null;
    return (
      savedWeek.days.find((day) => day.date === planDate) ??
      savedWeek.days.find((day) => day.weekday === selectedWeekday) ??
      null
    );
  }, [weekPlanMatches, savedWeek, planDate, selectedWeekday]);

  const live = useMemo(() => {
    // Prefer the Mon–Sun plan already saved on the server for this venue.
    if (weekPlanMatches) return null;
    if (!data.snapshot || !data.catalog?.length) return null;
    return analyzeInbodyWorkout(data.snapshot, data.catalog, {
      targetBodyType: (data.targetBodyType || null) as TargetBodyType | null,
      injuredParts: (data.injuredParts ?? []) as InjuredPart[],
      e1RmByExercise: data.e1RmByExercise ?? {},
      trainingVenue: venue,
      date: planDate,
      recentExerciseNames: data.recentExerciseNames ?? [],
      homeEquipment: venue === "home" ? homeGear : undefined,
      targetDays: data.targetDays ?? null,
    });
  }, [
    weekPlanMatches,
    data.snapshot,
    data.catalog,
    data.targetBodyType,
    data.injuredParts,
    data.e1RmByExercise,
    planDate,
    data.recentExerciseNames,
    data.targetDays,
    venue,
    homeGear,
  ]);

  const weekDays = useMemo(() => {
    if (weekPlanMatches && savedWeek) {
      return savedWeek.days.map((day) => {
        const mark = weekMarkOverrides[day.weekday] ?? day.mark;
        const on = mark === "O";
        return {
          weekday: day.weekday,
          dayLabel: day.dayLabel,
          mark,
          kind: on ? day.templateKind : ("rest" as const),
          templateKind: day.templateKind,
          sessionLabel: on
            ? day.sessionLabel || sessionKindLabel[day.templateKind]
            : "휴식",
        };
      });
    }
    const base = buildWeekCalendar({
      phase: (live?.phase ?? data.phase ?? 2) as 1 | 2 | 3,
      bias: live?.scheduleBias ?? data.scheduleBias ?? "balanced",
    });
    return base.map((day) => {
      const mark = weekMarkOverrides[day.weekday] ?? day.mark;
      const on = mark === "O";
      return {
        ...day,
        mark,
        kind: on ? day.templateKind : ("rest" as const),
        sessionLabel: on
          ? sessionKindLabel[day.templateKind]
          : "휴식",
      };
    });
  }, [
    weekPlanMatches,
    savedWeek,
    weekMarkOverrides,
    live?.phase,
    live?.scheduleBias,
    data.phase,
    data.scheduleBias,
  ]);
  const selectedSlot =
    weekDays.find((day) => day.weekday === selectedWeekday) ?? weekDays[0];
  const isRestDay = selectedSlot?.mark === "X";

  const planExercises = isRestDay
    ? []
    : weekPlanMatches && savedDay
      ? savedDay.exercises
      : (live?.exercises ?? data.exercises);
  const planMode =
    (weekPlanMatches && savedDay
      ? savedDay.recommendedMode
      : live?.recommendedMode) ?? data.recommendedMode;
  const planIntensity =
    (weekPlanMatches && savedDay
      ? savedDay.recommendedIntensity
      : live?.recommendedIntensity) ??
    data.recommendedIntensity ??
    1;
  const planPrescription =
    (weekPlanMatches && savedDay
      ? savedDay.prescription
      : live?.prescription) ?? data.prescription;
  const planSafety = (
    (weekPlanMatches && savedDay
      ? savedDay.safetyNotes
      : live?.safetyNotes) ??
    data.safetyNotes ??
    []
  ).filter((note) => !/DB|데이터베이스|missingSlots/i.test(note));
  const planTargetBody =
    (weekPlanMatches ? savedWeek?.targetBodyLabel : live?.targetBodyLabel) ??
    data.targetBodyLabel;
  const planWeak =
    (weekPlanMatches ? savedWeek?.weakLabels : live?.weakLabels) ??
    data.weakLabels;
  const planTargets =
    (weekPlanMatches ? savedWeek?.targetLabels : live?.targetLabels) ??
    data.targetLabels;
  const sessionLabel =
    (weekPlanMatches && savedDay
      ? savedDay.sessionLabel
      : live?.sessionLabel) ||
    data.sessionLabel ||
    "오늘 코스";
  const planEnergy =
    (weekPlanMatches && savedDay ? savedDay.energy : live?.energy) ??
    data.energy;
  const planPhase = (weekPlanMatches
    ? savedWeek?.phase
    : live?.phase ?? data.phase ?? 2) as 1 | 2 | 3;
  const planPhaseLabel =
    (weekPlanMatches ? savedWeek?.phaseLabel : live?.phaseLabel) ??
    data.phaseLabel ??
    phaseLabel[planPhase];
  const planBias =
    (weekPlanMatches ? savedWeek?.scheduleBias : live?.scheduleBias) ??
    data.scheduleBias ??
    "balanced";
  const planShape = String(
    (weekPlanMatches ? savedWeek?.shape : live?.shape) ?? data.shape ?? "I",
  );
  const planImbalanced = Boolean(
    (weekPlanMatches ? savedWeek?.isImbalanced : live?.isImbalanced) ??
      data.isImbalanced ??
      false,
  );
  const planInjured = (data.injuredParts ?? []) as string[];
  const planStructural = (
    (weekPlanMatches
      ? savedWeek?.structuralIssues
      : live?.structuralIssues) ??
    data.structuralIssues ??
    []
  ).map((issue) => issue.title);

  function setSelectedDayMark(mark: "O" | "X") {
    setWeekMarkOverrides((prev) => ({
      ...prev,
      [selectedWeekday]: mark,
    }));
    setActiveIndex(0);
    setAnatomyView(mark === "O" ? "day" : "body");
    setTimerReady(false);
    setRmOpenSlug(null);
    setRunning(false);
    setSessionActive(false);
    setElapsedSec(0);
    setSetsDone(0);
    setRounds(0);
    setRestLeft(0);
    setNotice(
      mark === "O"
        ? `${selectedSlot?.dayLabel ?? ""}요일을 운동하는 날(O)로 바꿨습니다.`
        : `${selectedSlot?.dayLabel ?? ""}요일을 쉬는 날(X)로 바꿨습니다.`,
    );
  }

  const whyLines = useMemo(
    () =>
      buildModeWhyLines({
        shape: planShape,
        phase: planPhase,
        phaseLabel: planPhaseLabel,
        isImbalanced: planImbalanced,
        weakLabels: planWeak ?? [],
        targetBodyLabel: planTargetBody || "",
        targetDays: data.targetDays,
        bias: planBias,
        sessionLabel,
        safetyNotes: planSafety,
        injuredParts: planInjured,
        structuralTitles: planStructural,
        mode: planMode,
        prescription: planPrescription,
      }),
    [
      planShape,
      planPhase,
      planPhaseLabel,
      planImbalanced,
      planWeak,
      planTargetBody,
      data.targetDays,
      planBias,
      sessionLabel,
      planSafety,
      planInjured,
      planStructural,
      planMode,
      planPrescription,
    ],
  );

  const [mode, setMode] = useState<WorkoutTimerMode>(planMode);
  const [intensity, setIntensity] = useState(planIntensity);
  const [persuasionPending, setPersuasionPending] = useState(false);
  const [persuasionKind, setPersuasionKind] = useState<"mode" | "intensity">(
    "mode",
  );
  const [requestedMode, setRequestedMode] = useState<WorkoutTimerMode | null>(
    null,
  );
  const [requestedIntensity, setRequestedIntensity] = useState<number | null>(
    null,
  );
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [persuasionText, setPersuasionText] = useState("");
  const [running, setRunning] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [restLeft, setRestLeft] = useState(0);
  const [roundLeft, setRoundLeft] = useState(data.timer.roundSec || 60);
  const [limitLeft, setLimitLeft] = useState(data.timer.limitSec);
  const [setsDone, setSetsDone] = useState(0);
  const [rounds, setRounds] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anatomyView, setAnatomyView] = useState<"body" | "day" | "exercise">(
    "day",
  );
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const openExternal = useOpenExternal();
  const { callToolAsync: lookupHowto } = useCallTool("lookup-exercise-howto");
  const [howtoBySlug, setHowtoBySlug] = useState<
    Record<
      string,
      {
        loading: boolean;
        query: string;
        searchUrl: string;
        videos: Array<{
          videoId: string;
          title: string;
          url: string;
          channel: string;
        }>;
        error: string;
      }
    >
  >({});
  const [workingWeights, setWorkingWeights] = useState<Record<string, number>>(
    () =>
      Object.fromEntries(
        planExercises.map((item) => [item.slug, item.workingWeightKg || 0]),
      ),
  );
  const [workingReps, setWorkingReps] = useState<Record<string, number>>(
    () =>
      Object.fromEntries(
        planExercises.map((item) => [item.slug, item.reps || 10]),
      ),
  );
  const [e1RmBySlug, setE1RmBySlug] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      planExercises.map((item) => [
        item.slug,
        item.estimated1RmKg || 0,
      ]),
    ),
  );
  const [maxRepsBySlug, setMaxRepsBySlug] = useState<Record<string, number>>(
    {},
  );
  const [rmOpenSlug, setRmOpenSlug] = useState<string | null>(null);
  const [rmDraft, setRmDraft] = useState("");
  const [showModeWhy, setShowModeWhy] = useState(false);
  const [timerReady, setTimerReady] = useState(false);
  /** Once a course clock has started, exercise taps must not reset it. */
  const [sessionActive, setSessionActive] = useState(false);
  const tickRef = useRef<number | null>(null);
  const anatomyRef = useRef<HTMLDivElement | null>(null);
  const planSyncKey = `${planDate}|${isRestDay ? "X" : "O"}|${venue}:${homeGear.join(",")}|${planExercises.map((item) => item.slug).join(",")}`;
  const planSyncKeyRef = useRef(planSyncKey);

  useEffect(() => {
    if (planSyncKeyRef.current === planSyncKey) return;
    const prevDate = planSyncKeyRef.current.split("|")[0];
    const prevVenueBit = planSyncKeyRef.current.split("|")[2] ?? "";
    const nextVenueBit = `${venue}:${homeGear.join(",")}`;
    planSyncKeyRef.current = planSyncKey;
    setMode(planMode);
    setIntensity(planIntensity);
    setActiveIndex(0);
    setAnatomyView(isRestDay ? "body" : "day");
    setWorkingWeights(
      Object.fromEntries(
        planExercises.map((item) => [item.slug, item.workingWeightKg || 0]),
      ),
    );
    setWorkingReps(
      Object.fromEntries(
        planExercises.map((item) => [item.slug, item.reps || 10]),
      ),
    );
    setE1RmBySlug((prevMap) => {
      const next = { ...prevMap };
      for (const item of planExercises) {
        if (!(item.slug in next) || !next[item.slug]) {
          next[item.slug] = item.estimated1RmKg || 0;
        }
      }
      return next;
    });
    setMaxRepsBySlug((prevMap) => {
      const next: Record<string, number> = {};
      for (const item of planExercises) {
        if (prevMap[item.slug] && prevMap[item.slug] > 0) {
          next[item.slug] = prevMap[item.slug];
        }
      }
      return next;
    });
    setPersuasionPending(false);
    setOverrideConfirmed(false);
    setRunning(false);
    setSessionActive(false);
    setElapsedSec(0);
    setSetsDone(0);
    setRounds(0);
    setRestLeft(0);
    setTimerReady(false);
    setRmOpenSlug(null);
    if (prevDate !== planDate) {
      setNotice(
        `${selectedSlot?.dayLabel ?? ""}요일(${planDate}) 코스로 바꿨습니다.`,
      );
    } else if (prevVenueBit !== nextVenueBit) {
      setNotice(
        venue === "home"
          ? `홈트레이닝 · ${homeGear
              .map((id) => homeEquipmentLabel[id])
              .join("·")} 기구로 코스를 다시 짰습니다.`
          : `${trainingVenueLabel[venue]} 기구로 코스를 다시 짰습니다.`,
      );
    }
  }, [
    planSyncKey,
    planDate,
    planMode,
    planIntensity,
    planExercises,
    venue,
    homeGear,
    selectedSlot?.dayLabel,
    isRestDay,
  ]);

  function toggleHomeGear(id: HomeEquipment) {
    if (id === "bodyweight") return;
    setHomeGear((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      return normalizeHomeEquipment(next);
    });
  }

  async function findHowto(slug: string, nameKo: string) {
    if (howtoBySlug[slug]?.loading) return;
    setHowtoBySlug((prev) => ({
      ...prev,
      [slug]: {
        loading: true,
        query: `${nameKo} 하는법`,
        searchUrl: prev[slug]?.searchUrl ?? "",
        videos: prev[slug]?.videos ?? [],
        error: "",
      },
    }));
    try {
      const result = await lookupHowto({ exerciseName: nameKo, limit: 5 });
      const out = result.structuredContent;
      if (!out) {
        throw new Error("유튜브 검색 결과를 받지 못했습니다.");
      }
      setHowtoBySlug((prev) => ({
        ...prev,
        [slug]: {
          loading: false,
          query: out.query || `${nameKo} 하는법`,
          searchUrl: out.searchUrl || "",
          videos: out.videos ?? [],
          error:
            (out.videos?.length ?? 0) === 0
              ? "영상 목록을 바로 못 가져왔습니다. 아래 검색 페이지를 열어 보세요."
              : "",
        },
      }));
    } catch (error) {
      setHowtoBySlug((prev) => ({
        ...prev,
        [slug]: {
          loading: false,
          query: `${nameKo} 하는법`,
          searchUrl: "",
          videos: [],
          error:
            error instanceof Error && error.message
              ? error.message
              : "유튜브 검색에 실패했습니다.",
        },
      }));
    }
  }

  const active: Exercise | undefined = planExercises[activeIndex];
  const timer =
    mode === planMode && planPrescription
      ? scaleTimer(mode, planPrescription)
      : scaleTimer(mode, Math.max(0.7, intensity));
  const isFullscreenHint = running;

  useEffect(() => {
    if (!running) {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = window.setInterval(() => {
      setElapsedSec((value) => value + 1);
      if (mode === "rest_timer") {
        setRestLeft((value) => (value > 0 ? value - 1 : 0));
      }
      if (mode === "emom") {
        setRoundLeft((value) => {
          if (value <= 1) return timer.roundSec || 60;
          return value - 1;
        });
        setLimitLeft((value) => {
          if (value <= 1) {
            setRunning(false);
            return 0;
          }
          return value - 1;
        });
      }
      if (mode === "amrap") {
        setLimitLeft((value) => {
          if (value <= 1) {
            setRunning(false);
            return 0;
          }
          return value - 1;
        });
      }
    }, 1000);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [running, mode, timer.roundSec]);

  function askMode(next: WorkoutTimerMode) {
    if (next === mode) return;
    if (
      !overrideConfirmed &&
      next !== planMode &&
      mode === planMode
    ) {
      setPersuasionKind("mode");
      setRequestedMode(next);
      setRequestedIntensity(null);
      setPersuasionPending(true);
      setPersuasionText(
        (data.persuasion as Record<string, string>)[next] ??
          (whyLines.join(" · ") || modeMeta[planMode].hint),
      );
      return;
    }
    applyMode(next);
  }

  function applyMode(next: WorkoutTimerMode) {
    setMode(next);
    setPersuasionPending(false);
    setRequestedMode(null);
    const nextTimer = scaleTimer(next, intensity);
    setRestLeft(0);
    setRoundLeft(nextTimer.roundSec || 60);
    setLimitLeft(
      next === "amrap" || next === "emom"
        ? nextTimer.limitSec || 12 * 60
        : nextTimer.limitSec || 0,
    );
    setRunning(false);
    setSessionActive(false);
    setElapsedSec(0);
    setSetsDone(0);
    setRounds(0);
  }

  function keepRecommended() {
    setPersuasionPending(false);
    setRequestedMode(null);
    setRequestedIntensity(null);
    setNotice(
      persuasionKind === "intensity"
        ? "추천 강도를 유지합니다. 워너비 체형까지 한 단계씩 가요."
        : "추천 모드를 유지합니다. 약한 쪽부터 같은 횟수로 가요.",
    );
  }

  function confirmOverride() {
    if (!requestedMode) return;
    setOverrideConfirmed(true);
    applyMode(requestedMode);
    setNotice(
      (data.overrideLine as Record<string, string>)[requestedMode] ??
        "오늘만 봐 드립니다.",
    );
  }

  function startWorkout() {
    // Resume after pause / exercise switch — do not reset course clocks.
    if (sessionActive) {
      setRunning(true);
      setSaved(false);
      setNotice(
        mode === "amrap"
          ? "코스 타이머를 이어서 갑니다. 종목을 바꿔도 시간은 유지됩니다."
          : "타이머를 이어서 갑니다.",
      );
      void setDisplayMode("fullscreen");
      return;
    }
    setSessionActive(true);
    setRunning(true);
    setElapsedSec(0);
    setSetsDone(0);
    setRounds(0);
    setRestLeft(0);
    setRoundLeft(timer.roundSec || 60);
    setLimitLeft(
      mode === "amrap" || mode === "emom"
        ? timer.limitSec || 12 * 60
        : timer.limitSec || 0,
    );
    setSaved(false);
    setNotice(
      mode === "amrap"
        ? "AMRAP 코스 타이머 시작 · 전 종목을 이 시간 안에 순환하세요."
        : mode === "emom"
          ? "EMOM 세션 타이머 시작 · 종목을 바꿔도 세션 시간은 유지됩니다."
          : "",
    );
    void setDisplayMode("fullscreen");
  }

  function completeSet() {
    setSetsDone((value) => value + 1);
    if (mode === "rest_timer") setRestLeft(timer.restSec || 75);
  }

  async function finishAndSave() {
    setRunning(false);
    setSessionActive(false);
    const durationMin = Math.max(1, Math.round((elapsedSec / 60) * 10) / 10);
    const perSets =
      mode === "amrap"
        ? Math.max(1, rounds)
        : Math.max(1, setsDone || timer.sets || 1);
    const entries = planExercises.map((item) => ({
      exercise: item.nameKo,
      kind: item.kind,
      weightKg: isBodyweightExercise(item)
        ? 0
        : (workingWeights[item.slug] ?? item.workingWeightKg ?? 0),
      reps: workingReps[item.slug] ?? item.reps ?? timer.reps ?? 0,
      sets: item.sets || perSets,
      durationMin:
        Math.round((durationMin / Math.max(1, planExercises.length)) * 10) / 10,
    }));
    try {
      const result = await saveSession({
        date: data.date,
        mode,
        recommendedMode: planMode,
        overridden: overrideConfirmed && mode !== planMode,
        durationSec: elapsedSec,
        rounds: mode === "amrap" ? rounds : setsDone,
        entries,
        accountKey,
      });
      setSaved(true);
      setNotice(
        result.structuredContent?.message ??
          "운동을 저장했습니다. 오늘 차트에 소모 칼로리가 붙습니다.",
      );
      void setDisplayMode("inline");
    } catch (error) {
      setNotice(
        error instanceof Error && error.message
          ? error.message
          : "저장하지 못했습니다. 다시 눌러 주세요.",
      );
    }
  }

  const mainClock =
    mode === "rest_timer" && restLeft > 0
      ? restLeft
      : mode === "emom"
        ? roundLeft
        : mode === "amrap"
          ? limitLeft
          : elapsedSec;

  const mainLabel =
    mode === "rest_timer" && restLeft > 0
      ? "휴식"
      : mode === "emom"
        ? "이번 분"
        : mode === "amrap"
          ? "코스 남은 시간"
          : "경과";

  function exerciseLoadReady(item: Exercise | undefined) {
    if (!item) return false;
    if (item.kind === "cardio") return true;
    if (isBodyweightExercise(item)) {
      return (maxRepsBySlug[item.slug] ?? 0) > 0;
    }
    return (
      (e1RmBySlug[item.slug] ?? item.estimated1RmKg ?? 0) > 0 ||
      (workingWeights[item.slug] ?? item.workingWeightKg ?? 0) > 0
    );
  }

  function applyOneRm(item: Exercise, raw: string) {
    const e1 = Math.max(0, Number(raw) || 0);
    setE1RmBySlug((prev) => ({ ...prev, [item.slug]: e1 }));
    if (e1 > 0 && !isBodyweightExercise(item)) {
      const ww = calculateWorkingWeight({
        e1RmKg: e1,
        targetReps: workingReps[item.slug] ?? item.reps ?? 10,
        targetRir: item.targetRir ?? 2,
        category: (item.liftCategory || "lower_compound") as LiftCategory,
        isolation: Boolean(item.isolation),
      });
      setWorkingWeights((prev) => ({ ...prev, [item.slug]: ww }));
      setNotice(`${item.nameKo} 1RM ${e1}kg → 오늘 작업 중량 ${ww}kg`);
    } else if (e1 > 0) {
      setNotice(`${item.nameKo} 1RM ${e1}kg 저장`);
    }
    setRmOpenSlug(null);
    setRmDraft("");
    setTimerReady(true);
    setAnatomyView("exercise");
  }

  function applyMaxReps(item: Exercise, raw: string) {
    const maxReps = Math.max(0, Math.floor(Number(raw) || 0));
    setMaxRepsBySlug((prev) => ({ ...prev, [item.slug]: maxReps }));
    if (maxReps > 0) {
      const working = calculateWorkingRepsFromMax({
        maxReps,
        targetRir: item.targetRir ?? 2,
        pct1RmMin: item.pct1RmMin,
        pct1RmMax: item.pct1RmMax,
      });
      setWorkingReps((prev) => ({ ...prev, [item.slug]: working }));
      setNotice(
        `${item.nameKo} 최대 ${maxReps}회 → 오늘 세트당 ${working}회 (RIR ${item.targetRir ?? 2})`,
      );
    }
    setRmOpenSlug(null);
    setRmDraft("");
    setTimerReady(true);
    setAnatomyView("exercise");
  }

  function showExerciseAnatomy(index: number) {
    setActiveIndex(index);
    setAnatomyView("exercise");
    window.setTimeout(() => {
      anatomyRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  }

  function selectExercise(index: number) {
    setActiveIndex(index);
    setAnatomyView("exercise");
    const item = planExercises[index];
    if (!item) return;
    const ready = exerciseLoadReady(item);
    // Course modes keep one shared clock — never drop the timer panel mid-session.
    if (sessionActive && (mode === "amrap" || mode === "emom")) {
      setTimerReady(true);
      if (!ready && item.kind !== "cardio") {
        setNotice(
          isBodyweightExercise(item)
            ? `${item.nameKo} 최대 횟수가 없어도 코스 타이머는 그대로입니다. 순환을 이어 가세요.`
            : `${item.nameKo} 1RM이 없어도 코스 타이머는 그대로입니다. 순환을 이어 가세요.`,
        );
      }
      return;
    }
    if (sessionActive) {
      setTimerReady(true);
      return;
    }
    setTimerReady(ready);
    if (!ready && item.kind !== "cardio") {
      setNotice(
        isBodyweightExercise(item)
          ? "먼저 '최대횟수 찾기'로 한 세트 최대 횟수를 입력한 뒤 종목을 다시 눌러 주세요."
          : "먼저 '1RM 찾기'로 추정 1RM을 입력한 뒤 종목을 다시 눌러 주세요.",
      );
    }
  }

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} space-y-3 rounded-xl border border-border bg-background p-4 text-foreground`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">맞춤 운동</h2>
          {data.clientTimeZone ? (
            <p className="text-[11px] text-muted-foreground">
              기기 시간대 · {data.clientTimeZone} · 기준일 {baseDate}
            </p>
          ) : null}
        </div>
        {!isFullscreenHint ? (
          <button
            type="button"
            onClick={() => void setDisplayMode("fullscreen")}
            className="rounded-lg border border-border px-2 py-1 text-xs"
          >
            크게
          </button>
        ) : null}
      </div>

      {data.message ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {data.message}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs font-bold text-muted-foreground">
            목표 1일운동 칼로리
          </p>
          <p className="text-base font-bold">
            {planEnergy?.targetExerciseKcal ?? 0}kcal
          </p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs font-bold text-muted-foreground">목표체형</p>
          <p className="text-base font-bold">{planTargetBody || "미설정"}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-[11px] font-bold text-muted-foreground">
            AI 추천 운동방법
          </p>
          <p className="text-sm font-bold">
            <TermTip term={modeMeta[planMode].term}>
              {modeLabel[planMode]}
            </TermTip>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {modeMeta[planMode].hint}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModeWhy((v) => !v)}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
        >
          이유
        </button>
      </div>
      {showModeWhy ? (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm">
          <p className="mb-1 text-xs font-bold">
            왜 이 방식인가요 · 내 체형·상황·목표 기준
          </p>
          <ul className="space-y-1.5 text-sm leading-snug">
            {whyLines.map((line) => (
              <li key={line}>{withTermTips(line, jargonInText)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
        <p className="mb-2 text-xs font-bold text-muted-foreground">
          설명 · Phase로 코스를 나누는 이유
        </p>
        <p className="mb-2 text-xs leading-snug text-muted-foreground">
          지금 적용:{" "}
          <span className="font-bold text-foreground">
            {planPhaseLabel || phaseLabel[planPhase]}
          </span>
          {planShape ? ` · ${planShape}자형` : ""}
          {planMode ? (
            <>
              {" · "}
              <TermTip term={modeMeta[planMode].term}>
                {modeLabel[planMode]}
              </TermTip>
            </>
          ) : null}
        </p>
        <div className="space-y-2.5 text-xs leading-snug">
          <div
            className={`rounded-md border px-2.5 py-2 ${
              planPhase === 1
                ? "border-blue-500/50 bg-blue-500/10"
                : "border-border/60"
            }`}
          >
            <p className="font-bold">Phase 1 · 불균형 교정 및 기초 체력</p>
            <p className="mt-1.5 text-muted-foreground">
              상·하체 좌우 근육량 차이가 5%(또는 0.2~0.3kg) 이상인 비대칭(
              <span className="font-semibold text-foreground">
                isImbalanced: true
              </span>
              ) 상태이거나, 기초 근력이 현저히 부족할 때 최우선으로 배정됩니다.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              강한 쪽 사지가 부하를 대신 드는 보상 작용을 막기 위해 바벨 같은
              양측성 운동을 배제하고, 덤벨·케이블·스플릿 스쿼트 등의{" "}
              <TermTip term="unilateral">편측성</TermTip> 운동이나 기초 맨몸{" "}
              <TermTip term="compound">다관절</TermTip> 운동을 수행합니다.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              시간 압박 인터벌(
              <TermTip term="amrap">AMRAP</TermTip>·
              <TermTip term="emom">EMOM</TermTip>
              )은 금지되며, 약한 쪽부터 시작해 강한 쪽도 같은 횟수로 통제할 수
              있도록{" "}
              <TermTip term="rest_timer">
                세트별 휴식 타이머(rest_timer, 60~120초)
              </TermTip>
              가 강제됩니다.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              관절 스트레스 없이 동작 제어 능력을 기르기 위해{" "}
              <TermTip term="pct_1rm">40~60% 1RM</TermTip>의 저~중강도로 세트당
              12~15회 이상 수행하는 것이 기본 기준입니다.
            </p>
          </div>
          <div
            className={`rounded-md border px-2.5 py-2 ${
              planPhase === 2
                ? "border-blue-500/50 bg-blue-500/10"
                : "border-border/60"
            }`}
          >
            <p className="font-bold">Phase 2 · 체성분 베이스캠프 구축</p>
            <p className="mt-1.5 text-muted-foreground">
              좌우 균형은 잡혀 있지만, 사용자가 선택한 워너비 체형의 체지방률이나
              골격근량과 현재 인바디 수치 사이에 격차가 클 때 진입합니다.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              체지방 감량이 우선인{" "}
              <span className="font-semibold text-foreground">C자형</span>{" "}
              사용자는{" "}
              <TermTip term="compound">다관절 복합(MJ)</TermTip> 전용 루틴과{" "}
              <TermTip term="amrap">AMRAP</TermTip> 또는{" "}
              <TermTip term="emom">EMOM</TermTip> 모드를 통해 1시간 초과 운동 시
              발생하는 중도 탈락률(~30%)을 예방하고, 운동 후 22시간 안정시
              대사량(+23.7%)을 극대화합니다.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              체중·근육 증량이 우선인 저체중 사용자는 대근육 위주의 복합 중량
              운동과{" "}
              <TermTip term="rest_timer">rest_timer</TermTip> 모드로 전체
              골격근량 베이스를 끌어올립니다.
            </p>
          </div>
          <div
            className={`rounded-md border px-2.5 py-2 ${
              planPhase === 3
                ? "border-blue-500/50 bg-blue-500/10"
                : "border-border/60"
            }`}
          >
            <p className="font-bold">Phase 3 · 워너비 체형 디테일 조각</p>
            <p className="mt-1.5 text-muted-foreground">
              기초 체성분과 근력 베이스가 일정 궤도에 도달하면 해금되는 최종
              단계입니다.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              사용자가 고른 워너비 체형의 핵심 타겟 부위(예: 역삼각형 어깨·광배근,
              애플힙·코어)와 인바디 5대 부위 중 상대적 취약 부위(
              <span className="font-semibold text-foreground">weakParts</span>
              )를 결합한{" "}
              <TermTip term="isolation">단일관절 고립(Isolation, SJ)</TermTip>{" "}
              분할 루틴을 집중적으로 배정합니다.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              체형 조형·근비대 목적이라면{" "}
              <TermTip term="pct_1rm">60~80% 1RM</TermTip>
              (8~12회, 휴식 60~180초)을, 고밀도 파워형 스트렝스 목적이라면{" "}
              <TermTip term="pct_1rm">80~100% 1RM</TermTip>
              (1~5회, 휴식 180~300초)을 중심으로{" "}
              <TermTip term="rest_timer">rest_timer</TermTip>를 활용해 정밀하게
              훈련합니다.
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-bold text-muted-foreground">운동 장소</p>
        <div className="flex flex-wrap gap-1">
          {trainingVenues.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setVenue(id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                venue === id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-border"
              }`}
            >
              {trainingVenueLabel[id]}
            </button>
          ))}
        </div>
        {venue === "home" ? (
          <div className="mt-2">
            <p className="mb-1 text-xs font-bold text-muted-foreground">
              집에 있는 기구
            </p>
            <div className="flex flex-wrap gap-1">
              {homeEquipmentIds.map((id) => {
                const on = homeGear.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={id === "bodyweight"}
                    onClick={() => toggleHomeGear(id)}
                    className={`rounded-full border px-3 py-1 text-xs disabled:opacity-100 ${
                      on
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-border"
                    }`}
                  >
                    {homeEquipmentLabel[id]}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {planSafety.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          {planSafety.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="mb-1 text-sm font-bold">이번주 운동코스</h3>
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_ORDER.map((wd) => {
            const slot = weekDays.find((d) => d.weekday === wd)!;
            const selected = selectedWeekday === wd;
            return (
              <button
                key={wd}
                type="button"
                onClick={() => {
                  setSelectedWeekday(wd);
                  setActiveIndex(0);
                  setAnatomyView(slot.mark === "O" ? "day" : "body");
                  setTimerReady(false);
                  setRmOpenSlug(null);
                  setRunning(false);
                  setSessionActive(false);
                  setElapsedSec(0);
                  setSetsDone(0);
                  setRounds(0);
                  setRestLeft(0);
                }}
                className={`min-w-[2.6rem] rounded-lg border px-2 py-1.5 text-center text-xs ${
                  selected
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-border"
                }`}
              >
                <div className="font-bold">{slot.dayLabel}</div>
                <div
                  className={
                    slot.mark === "O"
                      ? selected
                        ? "font-bold text-emerald-200"
                        : "font-bold text-emerald-500"
                      : "opacity-70"
                  }
                >
                  {slot.mark}
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {selectedSlot?.dayLabel}요일 ·{" "}
          {selectedSlot?.mark === "O" ? "운동" : "휴식"}
          {selectedSlot?.mark === "O" ? ` · ${selectedSlot.sessionLabel}` : ""}
          {" · "}
          {planDate}
          {selectedWeekday === todayWeekday ? " (오늘)" : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setSelectedDayMark("O")}
            disabled={selectedSlot?.mark === "O"}
            className="rounded-full border border-emerald-600 px-3 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
          >
            이 날을 운동(O)으로
          </button>
          <button
            type="button"
            onClick={() => setSelectedDayMark("X")}
            disabled={selectedSlot?.mark === "X"}
            className="rounded-full border border-border px-3 py-1 text-xs font-semibold disabled:opacity-40"
          >
            이 날을 휴식(X)으로
          </button>
        </div>
      </div>

      <div ref={anatomyRef}>
        <AnatomyBlock
          radar={data.radar}
          weakParts={planWeak}
          targetLabels={planTargets}
          sex={data.sex}
          theme={theme}
          mode={
            isRestDay
              ? "body"
              : anatomyView === "day" && planExercises.length === 0
                ? "body"
                : anatomyView
          }
          exercise={
            anatomyView === "exercise" ? planExercises[activeIndex] : undefined
          }
          dayExercises={!isRestDay ? planExercises : undefined}
          dayTitle={`${selectedSlot?.dayLabel ?? ""}요일 운동 부위${
            selectedSlot?.sessionLabel ? ` · ${selectedSlot.sessionLabel}` : ""
          }`}
          onShowBody={() => setAnatomyView("body")}
          onShowDay={
            !isRestDay && planExercises.length > 0
              ? () => {
                  setAnatomyView("day");
                  setActiveIndex(0);
                }
              : undefined
          }
        />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-bold">
          오늘의 종목
          {!isRestDay
            ? ` (${trainingVenueLabel[venue]} · ${sessionLabel})`
            : ""}
        </h3>
        {isRestDay ? (
          <p className="rounded-lg border border-border px-3 py-4 text-sm text-muted-foreground">
            쉬는 날(X)입니다. O인 요일을 눌러 운동 종목을 확인하세요.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {planExercises.map((item, index) => {
              const e1Now =
                e1RmBySlug[item.slug] ?? item.estimated1RmKg ?? 0;
              const bodyweight = isBodyweightExercise(item);
              const maxRepsNow = maxRepsBySlug[item.slug] ?? 0;
              const hasRm = bodyweight ? maxRepsNow > 0 : e1Now > 0;
              const repsNow = workingReps[item.slug] ?? item.reps ?? 0;
              const storedWeight =
                workingWeights[item.slug] ?? item.workingWeightKg ?? 0;
              const weightNow =
                storedWeight > 0
                  ? storedWeight
                  : !bodyweight && e1Now > 0
                    ? calculateWorkingWeight({
                        e1RmKg: e1Now,
                        targetReps: repsNow || 10,
                        targetRir: item.targetRir ?? 2,
                        category: (item.liftCategory ||
                          "lower_compound") as LiftCategory,
                        isolation: Boolean(item.isolation),
                      })
                    : 0;
              const setsNow = item.sets ?? 0;
              const loadReady =
                item.kind === "cardio"
                  ? true
                  : bodyweight
                    ? maxRepsNow > 0
                    : hasRm && weightNow > 0;
              return (
                <li
                  key={item.slug}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    index === activeIndex &&
                    (timerReady || anatomyView === "exercise")
                      ? "border-blue-600 bg-blue-600/5"
                      : "border-border"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => selectExercise(index)}
                    >
                      <span className="font-bold">
                        {index + 1}. {item.nameKo}
                      </span>
                      {item.required ? (
                        <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          필수 교정
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      disabled={howtoBySlug[item.slug]?.loading}
                      onClick={() => void findHowto(item.slug, item.nameKo)}
                      className="shrink-0 rounded-full border border-border px-2 py-1 text-[11px] font-semibold disabled:opacity-60"
                    >
                      {howtoBySlug[item.slug]?.loading
                        ? "찾는 중…"
                        : howtoBySlug[item.slug]?.videos?.length
                          ? "영상 다시"
                          : "운동방법 찾기"}
                    </button>
                    <button
                      type="button"
                      onClick={() => showExerciseAnatomy(index)}
                      className="shrink-0 rounded-full border border-border px-2 py-1 text-[11px] font-semibold"
                    >
                      운동부위 보기
                    </button>
                    {item.kind !== "cardio" && bodyweight ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRmOpenSlug(
                            rmOpenSlug === item.slug ? null : item.slug,
                          );
                          setRmDraft(
                            String(maxRepsBySlug[item.slug] || ""),
                          );
                          setActiveIndex(index);
                          setAnatomyView("exercise");
                        }}
                        className="shrink-0 rounded-full border border-border px-2 py-1 text-[11px] font-semibold"
                      >
                        {hasRm ? "최대횟수 수정" : "최대횟수 찾기"}
                      </button>
                    ) : null}
                    {item.kind !== "cardio" && !bodyweight ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRmOpenSlug(
                            rmOpenSlug === item.slug ? null : item.slug,
                          );
                          setRmDraft(
                            String(
                              e1RmBySlug[item.slug] ||
                                item.estimated1RmKg ||
                                "",
                            ),
                          );
                          setActiveIndex(index);
                          setAnatomyView("exercise");
                        }}
                        className="shrink-0 rounded-full border border-border px-2 py-1 text-[11px] font-semibold"
                      >
                        {hasRm ? "1RM 수정" : "1RM 찾기"}
                      </button>
                    ) : null}
                  </div>
                  {loadReady ? (
                    <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 text-xs">
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground">
                          무게
                        </p>
                        <p className="font-bold">
                          {bodyweight ? "맨몸" : `${weightNow}kg`}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground">
                          횟수
                        </p>
                        <p className="font-bold">{repsNow}회</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground">
                          세트
                        </p>
                        <p className="font-bold">
                          {setsNow > 0 ? `${setsNow}세트` : "AMRAP"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      {bodyweight
                        ? "최대 횟수를 입력하면 횟수·세트가 표시됩니다."
                        : "1RM을 입력하면 무게·횟수·세트가 표시됩니다."}
                    </p>
                  )}
                  {rmOpenSlug === item.slug ? (
                    bodyweight ? (
                      <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
                        <p className="font-bold">최대 횟수 찾는 방법</p>
                        <p className="text-muted-foreground">
                          맨몸 동작의 최대 횟수는 웨이트 1RM과 같은
                          기준입니다. 바른 자세로 한 세트에 더 이상 못 할
                          때까지 친 횟수를 적으세요. 무리한 실패 테스트는
                          하지 말고, 폼이 무너지기 직전 횟수면 충분합니다.
                          적용하면 오늘 처방 대역·RIR을 반영해 세트당 목표
                          횟수를 자동으로 내려 잡습니다.
                        </p>
                        <label className="flex flex-wrap items-center gap-2">
                          1세트 최대 횟수
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={rmDraft}
                            onChange={(e) => setRmDraft(e.target.value)}
                            className="w-24 rounded border border-border bg-background px-2 py-1"
                          />
                          <button
                            type="button"
                            onClick={() => applyMaxReps(item, rmDraft)}
                            className="rounded-lg bg-blue-600 px-2.5 py-1 font-semibold text-white"
                          >
                            적용
                          </button>
                        </label>
                      </div>
                    ) : (
                      <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
                        <p className="font-bold">1RM 찾는 방법</p>
                        <p className="text-muted-foreground">
                          1RM은 어떤 무게를 1번 들 때 본인이 낼 수 있는 100%
                          최대 근력(힘)의 기준입니다. 무리한 최대근력 테스트는
                          하지 마세요. 바른 자세로 5~10회 들 수 있는 무게로
                          1세트를 한 뒤, 여유 반복이 거의 없었다면 그 무게를
                          기준으로 추정하거나, 이미 아는 1RM(kg)을 아래에
                          입력하세요. 입력 후 종목을 누르면 타이머가
                          열립니다.
                        </p>
                        <label className="flex flex-wrap items-center gap-2">
                          추정 1RM (kg)
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={rmDraft}
                            onChange={(e) => setRmDraft(e.target.value)}
                            className="w-24 rounded border border-border bg-background px-2 py-1"
                          />
                          <button
                            type="button"
                            onClick={() => applyOneRm(item, rmDraft)}
                            className="rounded-lg bg-blue-600 px-2.5 py-1 font-semibold text-white"
                          >
                            적용
                          </button>
                        </label>
                      </div>
                    )
                  ) : null}
                  {howtoBySlug[item.slug] &&
                  !howtoBySlug[item.slug]?.loading ? (
                    <div className="mt-2 space-y-1.5 rounded-md border border-border bg-background/70 p-2">
                      {howtoBySlug[item.slug]!.error ? (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          {howtoBySlug[item.slug]!.error}
                        </p>
                      ) : null}
                      {howtoBySlug[item.slug]!.videos.length > 0 ? (
                        <ul className="space-y-1.5">
                          {howtoBySlug[item.slug]!.videos.map((video) => (
                            <li key={video.videoId}>
                              <button
                                type="button"
                                onClick={() =>
                                  openExternal(video.url, {
                                    redirectUrl: false,
                                  })
                                }
                                className="w-full text-left text-xs font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400"
                              >
                                {video.title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {(timerReady || sessionActive) && active && !isRestDay ? (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {workoutTimerModes.map((id) => (
              <button
                key={id}
                type="button"
                disabled={sessionActive && running}
                onClick={() => askMode(id)}
                className={`rounded-full border px-3 py-1 text-xs disabled:opacity-50 ${
                  mode === id
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-border"
                }`}
              >
                {modeMeta[id].label}
              </button>
            ))}
          </div>
          {mode === "amrap" ? (
            <p className="text-[11px] text-muted-foreground">
              AMRAP은 종목별 타이머가 아닙니다. 아래 코스 남은 시간 안에 전
              종목을 순환하세요. 종목을 바꿔도 시간은 초기화되지 않습니다.
            </p>
          ) : null}

          {persuasionPending &&
          (requestedMode || requestedIntensity != null) ? (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
              <p className="text-sm font-bold">잠깐, 추천을 지켜 봐요</p>
              <p className="mt-1 text-sm">
                {withTermTips(persuasionText, jargonInText)}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={keepRecommended}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white"
                >
                  추천 유지
                </button>
                <button
                  type="button"
                  onClick={confirmOverride}
                  className="rounded-lg border border-border px-3 py-2 text-sm font-bold"
                >
                  그래도 변경
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border p-4 text-center">
            <div className="text-xs text-muted-foreground">{mainLabel}</div>
            <div className="font-mono text-5xl font-bold tracking-tight">
              {formatClock(mainClock)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              총 경과 {formatClock(elapsedSec)}
              {mode === "amrap"
                ? ` · 라운드 ${rounds}${sessionActive ? " · 코스 공용 타이머" : ""}`
                : mode === "emom"
                  ? ` · 세트 ${setsDone} · 세션 남은 ${formatClock(limitLeft)}`
                  : ` · 세트 ${setsDone}`}
              {active ? ` · 지금 ${active.nameKo}` : ""}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {!running ? (
                <button
                  type="button"
                  onClick={startWorkout}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white"
                >
                  {sessionActive
                    ? "이어서 시작 (크게 보기)"
                    : mode === "amrap"
                      ? "코스 타이머 시작 (크게 보기)"
                      : "운동 시작 (크게 보기)"}
                </button>
              ) : (
                <>
                  {mode === "rest_timer" ||
                  mode === "stopwatch" ||
                  mode === "emom" ? (
                    <button
                      type="button"
                      onClick={completeSet}
                      className="rounded-lg border border-border px-3 py-2 text-sm font-bold"
                    >
                      세트 완료
                    </button>
                  ) : null}
                  {mode === "amrap" ? (
                    <button
                      type="button"
                      onClick={() => setRounds((value) => value + 1)}
                      className="rounded-lg border border-border px-3 py-2 text-sm font-bold"
                    >
                      +1 라운드 완료
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setRunning(false)}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    일시정지
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={saving || saved || elapsedSec < 1}
                onClick={() => void finishAndSave()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {saving
                  ? "저장 중…"
                  : saved
                    ? "저장됨"
                    : "운동 완료 및 기록 저장"}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {notice ? <p className="text-sm">{notice}</p> : null}
    </div>
  );
}

function InbodyWorkoutLoaded({
  data,
  theme,
}: {
  data: InbodyWorkoutData;
  theme: string;
}) {
  const accountKey = useAccountKey(data.accountKey || undefined);
  return (
    <InbodyWorkoutPanel data={data} theme={theme} accountKey={accountKey} />
  );
}

export default function InbodyWorkout() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"recommend-inbody-workout">();
  if (!toolInfo.isSuccess) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} p-4 text-sm text-muted-foreground`}
      >
        인바디 맞춤 운동을 불러오는 중…
      </div>
    );
  }
  if (!toolInfo.output.inbodySaved) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} rounded-xl border border-border bg-background p-4 text-foreground`}
      >
        <h2 className="text-lg font-bold">인바디가 먼저입니다</h2>
        <p className="mt-2 text-sm">{toolInfo.output.message}</p>
      </div>
    );
  }
  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <InbodyWorkoutLoaded data={toolInfo.output} theme={theme} />
    </div>
  );
}
