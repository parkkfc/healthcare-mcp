import type { McpServer } from "skybridge/server";
import { z } from "zod";
import {
  addDays,
  deleteWorkoutLog,
  getEtagSecret,
  getUserProfile,
  getWorkoutLog,
  clearPendingWorkoutBurn,
  findExercisesByName,
  getPendingWorkoutBurn,
  insertExercises,
  insertWorkoutLogs,
  listExercises,
  upsertPendingWorkoutBurn,
  listWorkoutLogs,
  seoulToday,
  getWorkoutWeekPlan,
  upsertWorkoutWeekPlan
} from "../db/client.js";
import {
  workoutKinds,
  workoutModes
} from "../db/schema.js";
import { checkEtag } from "../etag.js";
import {
  findBodyGoal,
  type TargetBodyType
} from "../body-goals.js";
import {
  injuredPartIds,
  injuredPartLabel,
  modeLabel,
  overrideCopy,
  persuasionCopy,
  regionValues,
  scaleTimer,
  homeEquipmentIds,
  homeEquipmentNeeded,
  normalizeHomeEquipment,
  trainingVenues,
  venueOf,
  workoutTimerModes,
  type HomeEquipment,
  type InjuredPart,
  type PlannedExercise,
  type StructuralIssue,
  type TrainingVenue,
  type WorkoutTimerMode
} from "../inbody-analyzer.js";
import {
  estimate1RM,
  inferLiftCategory
} from "../strength-calculator.js";
import {
  evidenceForPlan,
  evidenceRedirectDomains,
  formatEvidenceForModel
} from "../workout-evidence.js";
import { glossaryList } from "../workout-glossary.js";
import { slotByRole,
  exerciseRoleIds } from "../workout-schedule.js";
import {
  buildWeekPlanPayload,
  homeEquipmentKey,
  parseWeekPlanPayload,
  pickWeekPlanDay,
  seoulWeekBounds,
  weekPlanFingerprint,
  weekPlanHasGaps,
  type WeekPlanPayload
} from "../workout-week-plan.js";

const weekPlanDaySaveSchema = z.object({
  date: z.string().describe("YYYY-MM-DD"),
  weekday: z.number().int().min(0).max(6),
  dayLabel: z.string(),
  mark: z.enum(["O", "X"]),
  kind: z.string(),
  templateKind: z.string(),
  sessionLabel: z.string(),
  sessionKind: z.string(),
  sessionFocus: z.enum(["upper", "lower", "full"]),
  recommendedMode: z.enum(workoutTimerModes),
  recommendedIntensity: z.number(),
  prescription: z.any().nullable(),
  safetyNotes: z.array(z.string()),
  missingSlots: z.array(z.any()).default([]),
  exercises: z.array(z.any()),
  energy: z.any().nullable(),
});

const weekPlanSaveSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  venue: z.enum(trainingVenues).optional(),
  homeEquipment: z.array(z.enum(homeEquipmentIds)).optional(),
  phase: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  phaseLabel: z.string(),
  scheduleBias: z.string(),
  scheduleReason: z.string().optional(),
  weekHint: z.string().optional(),
  shape: z.string(),
  isImbalanced: z.boolean(),
  weakLabels: z.array(z.string()),
  targetLabels: z.array(z.string()),
  targetBodyType: z.string().optional(),
  targetBodyLabel: z.string().optional(),
  structuralIssues: z.array(z.any()).optional(),
  fingerprint: z.string().optional(),
  source: z.enum(["cache", "fresh"]).optional(),
  days: z.array(weekPlanDaySaveSchema).min(7).max(7),
});
import { resolveClientDay } from "../device-time.js";
import { searchExerciseHowto } from "../youtube-howto.js";
import {
  estimateBurnedKcal,
  parseWorkoutNote,
  workoutVolume
} from "../workout.js";

import {
  shown,
  modelOnly,
  accountId,
  readyUserId,
  accountKeyField,
  clientClockFields,
  guestKey,
  etagField,
  preconditionFailed,
  workoutEntrySchema,
  normalizeWorkoutEntry
} from "./helpers.js";

// Tool registration module (behavior preserved from server.ts).
export function registerWorkout<S extends McpServer>(server: S) {
  return server
      .registerTool(
        {
          name: "log-workout",
          description:
            "사용자가 한 운동을 문장 카드로 연다. 근력/유산소를 고르지 않는다. 카드 검색 시 호스트가 문장(예: 달리기 60분동안 3km)을 해석해 lookup-workout-burn에 note·exercise·kind·durationMin·distanceKm·burnedKcal를 넣는다. MET를 묻지 않는다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다.",
          inputSchema: {
            date: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
            entries: z
              .array(workoutEntrySchema)
              .min(1)
              .describe("종목마다 한 줄. 같은 종목을 중량을 바꿔 했으면 줄을 나눈다."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Confirm workout",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening the workout card…",
            "openai/toolInvocation/invoked": "Workout card ready.",
          },
          view: {
            component: "log-workout",
            description: "Confirm sets, reps and weight before saving",
          },
        },
        async ({ date, entries, accountKey }, extra) => {
          const userId = await readyUserId(extra, accountKey);
          const user = userId ? await getUserProfile(userId) : null;
          const day = date && date.length > 0 ? date : seoulToday();
          const items = entries.map(normalizeWorkoutEntry);
          return {
            content: [
              shown(
                `${day} 운동 ${items.map((item) => item.exercise).join(", ")}. 카드에서 확인하고 저장해 주세요.`,
              ),
              modelOnly(
                "운동 카드를 열었습니다. 사용자가 저장할 때까지 기다리세요. 저장 전에는 기록되지 않습니다.",
              ),
            ],
            structuredContent: {
              date: day,
              entries: items,
              bodyWeightKg: user?.weightKg ?? 0,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "lookup-workout-burn",
          description:
            "운동 기록 문장의 소모 kcal를 카드에 넣는다. 사용자는 '달리기 60분동안 3km를 뛰었어'처럼 자연어로 적는다. 카드가 note만 넘기면 서버가 문장에서 종목·시간·거리·세트를 읽고 MET·체중으로 kcal를 바로 계산한다. burnedKcal가 있으면 그 값을 쓴다. 채팅 입력창에 글을 넣지 않는다.",
          inputSchema: {
            note: z
              .string()
              .describe("카드에 적힌 운동 문장 원문. peek·저장 모두 이 문자열로 맞춘다."),
            exercise: z
              .string()
              .optional()
              .describe("문장에서 뽑은 짧은 종목명. 예: 달리기, 스쿼트"),
            kind: z
              .enum(workoutKinds)
              .optional()
              .describe("문장이 달리기·걷기·자전거·수영이면 cardio, 아니면 strength"),
            weightKg: z.number().nonnegative().optional(),
            reps: z.number().int().nonnegative().optional(),
            sets: z.number().int().nonnegative().optional(),
            durationMin: z.number().nonnegative().optional(),
            distanceKm: z
              .number()
              .nonnegative()
              .optional()
              .describe("문장에 있는 거리(km). 없으면 생략"),
            burnedKcal: z
              .number()
              .positive()
              .optional()
              .describe("호스트가 추정한 소모 kcal. 있으면 저장, 없으면 peek."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Lookup workout burn",
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Resolving workout kcal…",
            "openai/toolInvocation/invoked": "Workout kcal ready.",
          },
        },
        async (
          {
            note,
            exercise,
            kind,
            weightKg,
            reps,
            sets,
            durationMin,
            distanceKm,
            burnedKcal: burnedInput,
            accountKey,
          },
          extra,
        ) => {
          const userId = await readyUserId(extra, accountKey);
          const sentence = (note ?? "").replace(/\s+/g, " ").trim();
          if (!userId) {
            return {
              content: "계정을 확인할 수 없습니다.",
              structuredContent: {
                ok: false,
                waiting: false,
                note: sentence,
                exercise: "",
                matchedName: "",
                kind: kind ?? "strength",
                burnedKcal: 0,
                distanceKm: 0,
                message: "로그인·accountKey 후 다시 하세요.",
              },
              isError: true,
            };
          }
          const user = await getUserProfile(userId);
          const bodyWeightKg = user?.weightKg ?? 0;
          const weight = weightKg ?? 0;
          const repN = reps ?? 0;
          const setN = sets ?? 0;
          const minutesIn = durationMin ?? 0;
          const distance = distanceKm ?? 0;
          const hostBurn =
            typeof burnedInput === "number" &&
            Number.isFinite(burnedInput) &&
            burnedInput > 0
              ? Math.round(burnedInput)
              : 0;

          if (hostBurn > 0) {
            const shortName = (exercise ?? "").replace(/\s+/g, " ").trim();
            if (sentence.length === 0 || shortName.length === 0) {
              return {
                content: "문장과 종목 이름이 필요합니다.",
                structuredContent: {
                  ok: false,
                  waiting: false,
                  note: sentence,
                  exercise: shortName,
                  matchedName: "",
                  kind: kind ?? "strength",
                  burnedKcal: 0,
                  distanceKm: distance,
                  message: "note(원문)와 exercise, burnedKcal를 함께 넣으세요.",
                },
                isError: true,
              };
            }
            const hits = await findExercisesByName(shortName, 5);
            const hit = hits[0];
            const resolvedKind = hit?.kind ?? kind ?? "strength";
            const matchedName = hit?.nameKo ?? shortName;
            await upsertPendingWorkoutBurn(userId, {
              note: sentence,
              exercise: shortName,
              kind: resolvedKind,
              matchedName,
              burnedKcal: hostBurn,
              weightKg: weight,
              reps: repN,
              sets: setN,
              durationMin: minutesIn,
              distanceKm: distance,
            });
            const message = `${matchedName}: 약 ${hostBurn}kcal${
              distance > 0 ? ` · ${distance}km` : ""
            }${minutesIn > 0 ? ` · ${minutesIn}분` : ""}.`;
            return {
              content: message,
              structuredContent: {
                ok: true,
                waiting: false,
                note: sentence,
                exercise: shortName,
                matchedName,
                kind: resolvedKind,
                burnedKcal: hostBurn,
                bodyWeightKg,
                minutes: minutesIn,
                distanceKm: distance,
                volumeKg: Math.round(workoutVolume(weight, repN, setN)),
                weightKg: weight,
                reps: repN,
                sets: setN,
                durationMin: minutesIn,
                message,
                source: "host" as const,
              },
            };
          }

          const pending = await getPendingWorkoutBurn(userId);
          const sameNote =
            pending != null &&
            sentence.length > 0 &&
            pending.note.replace(/\s+/g, " ").trim() === sentence;
          if (pending && sameNote) {
            const updatedAtMs = Date.parse(pending.updatedAt || "");
            const ageMs = Number.isFinite(updatedAtMs)
              ? Date.now() - updatedAtMs
              : 0;
            if (ageMs >= 0 && ageMs < 5 * 60_000) {
              await clearPendingWorkoutBurn(userId);
              return {
                content: `${pending.matchedName || pending.exercise}: ${pending.burnedKcal}kcal`,
                structuredContent: {
                  ok: true,
                  waiting: false,
                  note: pending.note,
                  exercise: pending.exercise,
                  matchedName: pending.matchedName || pending.exercise,
                  kind: pending.kind,
                  burnedKcal: Math.round(pending.burnedKcal),
                  bodyWeightKg,
                  minutes: pending.durationMin,
                  distanceKm: pending.distanceKm,
                  volumeKg: Math.round(
                    workoutVolume(
                      pending.weightKg,
                      pending.reps,
                      pending.sets,
                    ),
                  ),
                  weightKg: pending.weightKg,
                  reps: pending.reps,
                  sets: pending.sets,
                  durationMin: pending.durationMin,
                  message: `${pending.matchedName || pending.exercise}: 약 ${Math.round(pending.burnedKcal)}kcal${
                    pending.distanceKm > 0 ? ` · ${pending.distanceKm}km` : ""
                  }${pending.durationMin > 0 ? ` · ${pending.durationMin}분` : ""}.`,
                  source: "host" as const,
                },
              };
            }
          }

          if (sentence.length === 0) {
            return {
              content: "운동 문장이 비어 있습니다.",
              structuredContent: {
                ok: false,
                waiting: false,
                note: "",
                exercise: "",
                matchedName: "",
                kind: kind ?? "strength",
                burnedKcal: 0,
                distanceKm: 0,
                message: "문장을 적은 뒤 검색하세요.",
              },
              isError: true,
            };
          }

          // 카드가 note만 넘기면 서버가 문장을 읽고 바로 kcal를 낸다(채팅 입력 없음).
          const parsed = parseWorkoutNote(sentence);
          const shortName = (
            (exercise ?? "").replace(/\s+/g, " ").trim() || parsed.exercise
          ).slice(0, 40);
          const hits = await findExercisesByName(shortName, 5);
          const hit = hits[0];
          const resolvedKind = hit?.kind ?? kind ?? parsed.kind;
          const matchedName = hit?.nameKo ?? shortName;
          const resolvedWeight = weight > 0 ? weight : parsed.weightKg;
          const resolvedReps = repN > 0 ? repN : parsed.reps;
          const resolvedSets = setN > 0 ? setN : parsed.sets;
          const resolvedMinutes =
            minutesIn > 0 ? minutesIn : parsed.durationMin;
          const resolvedDistance =
            distance > 0 ? distance : parsed.distanceKm;
          if (bodyWeightKg <= 0) {
            return {
              content: "체중이 없어 kcal를 계산하지 못했습니다.",
              structuredContent: {
                ok: false,
                waiting: false,
                note: sentence,
                exercise: shortName,
                matchedName,
                kind: resolvedKind,
                burnedKcal: 0,
                distanceKm: resolvedDistance,
                message: "인바디 체중을 먼저 저장한 뒤 다시 검색하세요.",
              },
              isError: true,
            };
          }
          const burned = estimateBurnedKcal(
            resolvedKind,
            resolvedMinutes,
            resolvedSets,
            bodyWeightKg,
            resolvedWeight,
            resolvedReps,
          );
          if (burned <= 0) {
            return {
              content: "시간이나 세트를 문장에서 읽지 못했습니다.",
              structuredContent: {
                ok: false,
                waiting: false,
                note: sentence,
                exercise: shortName,
                matchedName,
                kind: resolvedKind,
                burnedKcal: 0,
                distanceKm: resolvedDistance,
                message:
                  "예: 달리기 60분동안 3km를 뛰었어 / 스쿼트 60kg 10회 3세트",
              },
              isError: true,
            };
          }
          const message = `${matchedName}: 약 ${burned}kcal${
            resolvedDistance > 0 ? ` · ${resolvedDistance}km` : ""
          }${resolvedMinutes > 0 ? ` · ${resolvedMinutes}분` : ""}.`;
          return {
            content: message,
            structuredContent: {
              ok: true,
              waiting: false,
              note: sentence,
              exercise: shortName,
              matchedName,
              kind: resolvedKind,
              burnedKcal: burned,
              bodyWeightKg,
              minutes: resolvedMinutes,
              distanceKm: resolvedDistance,
              volumeKg: Math.round(
                workoutVolume(resolvedWeight, resolvedReps, resolvedSets),
              ),
              weightKg: resolvedWeight,
              reps: resolvedReps,
              sets: resolvedSets,
              durationMin: resolvedMinutes,
              message,
              source: "server" as const,
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-workout-logs",
          description:
            "운동 카드에서 사용자가 검색으로 확인한 운동을 저장한다. 종목마다 한 줄을 새로 넣고, 기존 기록을 고치거나 지우지 않는다. burnedKcal가 있으면 그 값을 쓰고, 없으면 체중·MET·중량·횟수·세트·시간으로 추정한다.",
          inputSchema: {
            date: z.string().describe("YYYY-MM-DD"),
            entries: z.array(workoutEntrySchema).min(1),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save workout",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the workout…",
            "openai/toolInvocation/invoked": "Workout saved.",
          },
        },
        async ({ date, entries, accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          const user = await getUserProfile(userId);
          const day = date.length > 0 ? date : seoulToday();
          const bodyWeightKg = user?.weightKg ?? 0;
          const items = entries
            .map(normalizeWorkoutEntry)
            .filter((item) => item.exercise.length > 0)
            .map((item) => ({
              ...item,
              burnedKcal:
                item.burnedKcal > 0
                  ? item.burnedKcal
                  : estimateBurnedKcal(
                      item.kind,
                      item.durationMin,
                      item.sets,
                      bodyWeightKg,
                      item.weightKg,
                      item.reps,
                    ),
            }));
          if (items.length === 0) {
            return {
              content: "종목 이름이 비어 있어 저장하지 않았습니다.",
              structuredContent: {
                saved: false,
                date: day,
                count: 0,
                burnedKcal: 0,
                volumeKg: 0,
              },
              isError: true,
            };
          }
          await insertWorkoutLogs(userId, day, items);
          const burnedKcal = items.reduce((sum, item) => sum + item.burnedKcal, 0);
          const volumeKg = Math.round(
            items.reduce(
              (sum, item) =>
                sum + workoutVolume(item.weightKg, item.reps, item.sets),
              0,
            ),
          );
          const burnNote =
            bodyWeightKg > 0
              ? `소모 약 ${burnedKcal}kcal(MET 추정)`
              : "저장된 체중이 없어 소모 칼로리는 계산하지 않았습니다";
          return {
            content: `${day} 운동 ${items.length}종목 저장. 총 볼륨 ${volumeKg}kg, ${burnNote}.`,
            structuredContent: {
              saved: true,
              date: day,
              count: items.length,
              burnedKcal,
              volumeKg,
            },
          };
        },
      )
      .registerTool(
        {
          name: "delete-workout-log",
          description:
            "저장된 운동 기록 한 줄을 지운다. 사용자가 그 기록을 지우자고 했을 때만 호출한다. show-workout-chart가 최근 15분 안에 그 줄에 발급한 etag가 있어야 하고, 아니면 precondition_failed로 거절한다. 한 번에 한 줄만 지운다.",
          inputSchema: {
            id: z.number().int().describe("show-workout-chart가 돌려준 운동 기록 id"),
            etag: etagField,
            ...accountKeyField(),
          },
          annotations: {
            title: "Delete one workout log",
            readOnlyHint: false,
            destructiveHint: true,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Deleting the workout log…",
            "openai/toolInvocation/invoked": "Workout log deleted.",
          },
        },
        async ({ id, etag, accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          const row = await getWorkoutLog(userId, id);
          if (!row) return preconditionFailed("not_found");
          const check = await checkEtag(
            await getEtagSecret(userId),
            "workout_log",
            id,
            row.createdAt,
            etag,
          );
          if (check !== "ok") return preconditionFailed(check);
          await deleteWorkoutLog(userId, id);
          const message = `${row.date} ${row.exercise} 기록을 지웠습니다.`;
          return {
            content: message,
            structuredContent: {
              ok: true,
              error: "",
              reason: "",
              message,
              deletedId: id,
            },
          };
        },
      )
      .registerTool(
        {
          name: "recommend-inbody-workout",
          description:
            "저장된 인바디(체중·골격근·체지방·5부위·키·성별·ECW/TBW·VFL)와 워너비 체형으로 맞춤 운동 카드를 연다. ECW·VFL은 save-inbody에 저장된 값을 쓰고, 이 도구에 다시 넣지 않는다. 없으면 결과지 사진으로 save-inbody를 다시 호출하라고 안내한다. ‘오늘’·이번 주(월~일)는 기기 로컬 날짜(clientDate·clientTimeZone, 없으면 date) 기준이다. 그 주 계획이 DB에 있으면 불러오기만 한다(weekPlan.source=cache). 없으면 월~일 코스를 짜되, 빈 슬롯(missingSlots)이 있으면 저장·뷰를 하지 않고 isError로 돌린다. 그때 호스트는 search-training-docs(topic=workout_course) → add-catalog-exercises로 역할을 채운 뒤 같은 trainingVenue·homeEquipment·clientDate로 이 도구를 한 번만 다시 호출한다. 슬롯이 꽉 찬 뒤에만 카드를 연다(source=fresh). source=cache이면 search-training-docs를 다시 부르지 않는다. 홈 위젯이 clientDate를 넘긴다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다.",
          inputSchema: {
            date: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. clientDate가 있으면 clientDate 우선."),
            trainingVenue: z
              .enum(trainingVenues)
              .optional()
              .describe("gym=헬스장(기본), home=홈트레이닝."),
            homeEquipment: z
              .array(z.enum(homeEquipmentIds))
              .optional()
              .describe(
                "홈트레이닝일 때 집에 있는 기구. bodyweight|dumbbell|kettlebell|band|pullup_bar|bench. 생략하면 맨몸만.",
              ),
            injuredParts: z
              .array(z.enum(injuredPartIds))
              .optional()
              .describe(
                "불편·부상 부위. shoulder|wrist|elbow|low_back|knee|ankle|neck. 없으면 생략하거나 빈 배열.",
              ),
            ...clientClockFields(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Recommend InBody workout",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Loading or building this week’s workout…",
            "openai/toolInvocation/invoked": "Workout plan ready.",
          },
          view: {
            component: "inbody-workout",
            description: "InBody-based workout plan with timer modes",
            csp: {
              redirectDomains: [
                ...evidenceRedirectDomains,
                "https://www.youtube.com",
                "https://youtube.com",
                "https://m.youtube.com",
              ],
            },
          },
        },
        async (
          {
            date,
            accountKey,
            injuredParts,
            trainingVenue,
            homeEquipment,
            clientDate,
            clientTimeZone,
          },
          extra,
        ) => {
          const userId = await accountId(extra, accountKey);
          const clock = resolveClientDay(
            clientDate && clientDate.length > 0
              ? clientDate
              : date && date.length > 0
                ? date
                : undefined,
            clientTimeZone,
          );
          const day = clock.day;
          const venue: TrainingVenue =
            trainingVenue === "home" ? "home" : "gym";
          const gear: HomeEquipment[] =
            venue === "home"
              ? normalizeHomeEquipment(homeEquipment as HomeEquipment[] | undefined)
              : [];
          const user = await getUserProfile(userId);
          const emptyRadar = [
            { region: "상체 좌", actual: 0, standard: 0 },
            { region: "상체 우", actual: 0, standard: 0 },
            { region: "코어", actual: 0, standard: 0 },
            { region: "하체 좌", actual: 0, standard: 0 },
            { region: "하체 우", actual: 0, standard: 0 },
          ];
          if (
            !user?.inbodyMeasuredOn ||
            !(user.weightKg && user.weightKg > 0)
          ) {
            return {
              content: [
                shown(
                  "인바디가 아직 없어 맞춤 운동을 만들지 못했습니다. 결과지 사진을 올려 주세요.",
                ),
                modelOnly(
                  "인바디가 없다. save-inbody로 저장한 뒤 recommend-inbody-workout을 다시 호출하세요.",
                ),
              ],
              structuredContent: {
                inbodySaved: false,
                bodyGoalSaved: false,
                message:
                  "인바디 결과지를 먼저 저장해 주세요. 저장되면 체형과 좌우 밸런스에 맞춰 운동과 타이머를 짜 드립니다.",
                date: day,
                clientDate: day,
                clientTimeZone: clock.timeZone,
                weekPlan: null as WeekPlanPayload | null,
                shape: "I",
                phase: 1,
                phaseLabel: "",
                isImbalanced: false,
                recommendedMode: "emom" as const,
                recommendedIntensity: 0.7,
                reason: "",
                inbodyReasoning: "",
                safetyNotes: [] as string[],
                injuredParts: [] as string[],
                prescription: null,
                evidence: [] as ReturnType<typeof evidenceForPlan>,
                glossary: [] as ReturnType<typeof glossaryList>,
                persuasion: {},
                persuasionIntensity: {},
                overrideLine: {},
                weakLabels: [] as string[],
                targetLabels: [] as string[],
                targetBodyType: "",
                targetBodyLabel: "",
                trainingVenue: venue,
                sessionFocus: "full" as const,
                sessionKind: "full" as const,
                sessionLabel: "",
                scheduleBias: "balanced" as const,
                scheduleReason: "",
                weekHint: "",
                splitLabel: "",
                missingSlots: [] as Array<{
                  role: string;
                  label: string;
                  region: string;
                  muscles: string;
                  hint: string;
                }>,
                recentExerciseNames: [] as string[],
                homeEquipment: gear,
                splitRecommended: false,
                splitHint: "",
                catalog: [] as Array<{
                  slug: string;
                  nameKo: string;
                  kind: "strength" | "cardio";
                  laterality: "unilateral" | "bilateral";
                  region: "upper" | "core" | "lower" | "full";
                  isolation: number;
                  cue: string;
                }>,
                snapshot: null,
                e1RmByExercise: {} as Record<string, number>,
                structuralIssues: [] as StructuralIssue[],
                exercises: [] as PlannedExercise[],
                timer: scaleTimer("emom", 1),
                radar: emptyRadar,
                sex: user?.sex ?? "",
                bodyFatKg: 0,
                toneLevel: user?.toneLevel ?? 0,
                accountKey: guestKey(userId),
              },
            };
          }
          const catalog = (await listExercises()).map((row) => ({
            slug: row.slug,
            nameKo: row.nameKo,
            kind: row.kind,
            laterality: row.laterality,
            region: row.region,
            isolation: row.isolation,
            cue: row.cue,
          }));
          const recentLogs = await listWorkoutLogs(
            userId,
            addDays(day, -56),
            day,
          );
          const e1RmByExercise: Record<string, number> = {};
          for (const row of recentLogs) {
            if (row.weightKg <= 0 || row.reps < 1 || row.reps > 10) continue;
            const category = inferLiftCategory(row.exercise, row.exercise);
            const e1 = estimate1RM({
              weightKg: row.weightKg,
              performedReps: row.reps,
              category,
            });
            if (e1 <= 0) continue;
            const prev = e1RmByExercise[row.exercise] ?? 0;
            if (e1 > prev) e1RmByExercise[row.exercise] = e1;
          }
          const priorLogs = recentLogs.filter((row) => row.date < day);
          const lastTrainDate = priorLogs.reduce(
            (max, row) => (row.date > max ? row.date : max),
            "",
          );
          const recentExerciseNames = lastTrainDate
            ? [
                ...new Set(
                  priorLogs
                    .filter((row) => row.date === lastTrainDate)
                    .map((row) => row.exercise),
                ),
              ]
            : [];
          const snapshot = {
            heightCm: user.heightCm ?? 0,
            sex: (user.sex === "female" ? "female" : "male") as "male" | "female",
            weightKg: user.weightKg ?? 0,
            skeletalMuscleKg: user.skeletalMuscleKg ?? 0,
            bodyFatKg: user.bodyFatKg ?? 0,
            bodyFatPercent: user.bodyFatPercent ?? 0,
            muscleUpperLeftKg: user.muscleUpperLeftKg ?? 0,
            muscleUpperRightKg: user.muscleUpperRightKg ?? 0,
            muscleCoreKg: user.muscleCoreKg ?? 0,
            muscleLowerLeftKg: user.muscleLowerLeftKg ?? 0,
            muscleLowerRightKg: user.muscleLowerRightKg ?? 0,
            ecwRatio: user.ecwRatio ?? null,
            visceralFatLevel: user.visceralFatLevel ?? null,
          };
          const goalId = findBodyGoal(user.targetBodyType)?.id ?? null;
          const injured = (injuredParts ?? []) as InjuredPart[];
          const { weekStart, weekEnd } = seoulWeekBounds(day);
          const gearKey = homeEquipmentKey(venue, gear);
          const fingerprint = weekPlanFingerprint({
            targetBodyType: goalId,
            targetDays: user.targetDays ?? null,
            injuredParts: injured,
            inbodyMeasuredOn: user.inbodyMeasuredOn,
            weightKg: snapshot.weightKg,
            skeletalMuscleKg: snapshot.skeletalMuscleKg,
            bodyFatKg: snapshot.bodyFatKg,
            muscleUpperLeftKg: snapshot.muscleUpperLeftKg,
            muscleUpperRightKg: snapshot.muscleUpperRightKg,
            muscleCoreKg: snapshot.muscleCoreKg,
            muscleLowerLeftKg: snapshot.muscleLowerLeftKg,
            muscleLowerRightKg: snapshot.muscleLowerRightKg,
            heightCm: snapshot.heightCm,
            sex: snapshot.sex,
            ecwRatio: snapshot.ecwRatio,
            visceralFatLevel: snapshot.visceralFatLevel,
            catalogSlugs: catalog.map((row) => row.slug),
          });

          let weekPlan: WeekPlanPayload | null = null;
          const savedRow = await getWorkoutWeekPlan({
            userId,
            weekStart,
            venue,
            homeEquipment: gearKey,
          });
          if (savedRow) {
            const parsed = parseWeekPlanPayload(savedRow.planJson);
            if (
              parsed &&
              savedRow.fingerprint === fingerprint &&
              !weekPlanHasGaps(parsed)
            ) {
              weekPlan = { ...parsed, source: "cache" };
            }
          }
          if (!weekPlan) {
            weekPlan = buildWeekPlanPayload({
              weekStart,
              weekEnd,
              snapshot,
              catalog,
              targetBodyType: goalId,
              injuredParts: injured,
              e1RmByExercise,
              trainingVenue: venue,
              homeEquipment: gear,
              recentExerciseNames,
              targetDays: user.targetDays ?? null,
              fingerprint,
            });
            if (weekPlanHasGaps(weekPlan)) {
              const gapByRole = new Map<
                string,
                {
                  role: string;
                  label: string;
                  muscles: string;
                  hint: string;
                }
              >();
              for (const dayRow of weekPlan.days) {
                for (const slot of dayRow.missingSlots ?? []) {
                  if (!gapByRole.has(slot.role)) {
                    gapByRole.set(slot.role, slot);
                  }
                }
              }
              const missingSlots = [...gapByRole.values()];
              const gearHint =
                venue === "home"
                  ? `homeEquipment=${gear.join(",") || "bodyweight"}`
                  : "gym";
              const slotLines = missingSlots
                .map(
                  (slot) =>
                    `- ${slot.role}: ${slot.label} (${slot.muscles}). ${slot.hint}`,
                )
                .join("\n");
              return {
                content: [
                  shown(
                    "이번 주 맞춤 운동 카드는 종목 DB가 비어 있는 역할이 있어 아직 열지 않았다.",
                  ),
                  modelOnly(
                    `weekPlan에 missingSlots가 있어 저장·뷰를 하지 않았다(reason=workout_catalog_gaps). 사용자에게 빈 역할을 운동처럼 말하지 마라. 입력창에 쓰지 마라. 순서: (1) search-training-docs topic=workout_course로 체형·Phase·역할 근거 확인 (2) add-catalog-exercises에 아래 role만 넣고 장소는 ${venue}, ${gearHint}. 역할마다 종목 1개 (3) 같은 trainingVenue·homeEquipment·clientDate로 recommend-inbody-workout을 한 번만 다시 호출해 완성 카드를 연다.\n${slotLines}`,
                  ),
                ],
                isError: true as const,
                structuredContent: {
                  ok: false as const,
                  reason: "workout_catalog_gaps",
                  weekStart,
                  weekEnd,
                  trainingVenue: venue,
                  homeEquipment: gear,
                  missingSlots,
                  message:
                    "빈 슬롯을 카탈로그로 채운 뒤에만 맞춤 운동 카드를 연다.",
                },
              };
            }
            await upsertWorkoutWeekPlan({
              userId,
              weekStart,
              weekEnd,
              venue,
              homeEquipment: gearKey,
              fingerprint,
              planJson: JSON.stringify({ ...weekPlan, source: "fresh" }),
            });
            weekPlan = { ...weekPlan, source: "fresh" };
          }

          const daySlice =
            pickWeekPlanDay(weekPlan, day) ??
            weekPlan.days.find((slot) => slot.mark === "O") ??
            weekPlan.days[0]!;
          const restToday = daySlice.mark === "X";
          const dayPrescription = daySlice.prescription;
          const plan = {
            shape: weekPlan.shape as "C" | "I" | "D",
            phase: weekPlan.phase,
            phaseLabel: weekPlan.phaseLabel,
            isImbalanced: weekPlan.isImbalanced,
            upper: { gapKg: 0, gapPct: 0, weaker: null as "left" | "right" | null },
            lower: { gapKg: 0, gapPct: 0, weaker: null as "left" | "right" | null },
            weakLabels: weekPlan.weakLabels,
            targetLabels: weekPlan.targetLabels,
            targetBodyType: (weekPlan.targetBodyType ||
              null) as TargetBodyType | null,
            targetBodyLabel: weekPlan.targetBodyLabel,
            trainingVenue: weekPlan.venue,
            sessionFocus: daySlice.sessionFocus,
            sessionKind: restToday ? ("full" as const) : daySlice.sessionKind === "rest" ? ("full" as const) : daySlice.sessionKind,
            sessionLabel: daySlice.sessionLabel,
            scheduleBias: weekPlan.scheduleBias,
            scheduleReason: weekPlan.scheduleReason,
            weekHint: weekPlan.weekHint,
            splitLabel: daySlice.sessionLabel,
            missingSlots: daySlice.missingSlots,
            homeEquipment: weekPlan.homeEquipment,
            splitRecommended: false,
            splitHint: weekPlan.weekHint,
            recommendedMode: daySlice.recommendedMode,
            recommendedIntensity: daySlice.recommendedIntensity,
            prescription:
              dayPrescription ??
              ({
                mode: "rest_timer" as const,
                sets: 0,
                reps: 0,
                targetRir: 2,
                pct1RmMin: 0,
                pct1RmMax: 0,
                restSec: 0,
                limitSec: 0,
                roundSec: 0,
                intensityFactor: 1,
                bandLabel: "휴식",
              } as const),
            reason: `${weekPlan.scheduleReason} ${weekPlan.weekHint}`.trim(),
            inbodyReasoning: `${weekPlan.phaseLabel} · ${weekPlan.shape}자형 · ${weekPlan.weekHint}`,
            safetyNotes: daySlice.safetyNotes,
            injuredParts: injured,
            structuralIssues: weekPlan.structuralIssues,
            exercises: restToday ? ([] as PlannedExercise[]) : daySlice.exercises,
            timer: dayPrescription
              ? scaleTimer(dayPrescription.mode, dayPrescription)
              : scaleTimer("rest_timer", 1),
            energy: daySlice.energy ?? {
              targetExerciseKcal: 0,
              strengthBurnKcal: 0,
              cardioBurnKcal: 0,
              cardioMinutes: 0,
              goalIntakeKcal: 0,
              bmrKcal: 0,
            },
          };
          const weekPlanSource = weekPlan.source;
          const values = regionValues(snapshot);
          const mean =
            values.filter((item) => item.kg > 0).reduce((sum, item) => sum + item.kg, 0) /
              Math.max(1, values.filter((item) => item.kg > 0).length) || 0;
          const label = {
            upperLeft: "상체 좌",
            upperRight: "상체 우",
            core: "코어",
            lowerLeft: "하체 좌",
            lowerRight: "하체 우",
          } as const;
          const radar = values.map((item) => ({
            region: label[item.key],
            actual: Math.round(item.kg * 10) / 10,
            standard: Math.round(mean * 10) / 10,
          }));
          const toneLevel = user.toneLevel ?? 0;
          const persuasion: Record<string, string> = {};
          const persuasionIntensity: Record<string, string> = {};
          const overrideLine: Record<string, string> = {};
          for (const mode of workoutTimerModes) {
            if (mode === plan.recommendedMode) continue;
            persuasion[mode] = persuasionCopy({
              recommendedMode: plan.recommendedMode,
              requestedMode: mode,
              isImbalanced: plan.isImbalanced,
              shape: plan.shape,
              bodyFatKg: snapshot.bodyFatKg,
              upperGapKg: plan.upper.gapKg,
              upperGapPct: plan.upper.gapPct,
              lowerGapKg: plan.lower.gapKg,
              lowerGapPct: plan.lower.gapPct,
              weakLabels: plan.weakLabels,
              targetBodyLabel: plan.targetBodyLabel,
              toneLevel,
              kind: "mode",
            });
            overrideLine[mode] = overrideCopy(mode);
          }
          for (const step of [0.7, 0.85, 1, 1.15, 1.3]) {
            if (Math.abs(step - plan.recommendedIntensity) < 0.01) continue;
            persuasionIntensity[String(step)] = persuasionCopy({
              recommendedMode: plan.recommendedMode,
              requestedMode: plan.recommendedMode,
              isImbalanced: plan.isImbalanced,
              shape: plan.shape,
              bodyFatKg: snapshot.bodyFatKg,
              upperGapKg: plan.upper.gapKg,
              upperGapPct: plan.upper.gapPct,
              lowerGapKg: plan.lower.gapKg,
              lowerGapPct: plan.lower.gapPct,
              weakLabels: plan.weakLabels,
              targetBodyLabel: plan.targetBodyLabel,
              toneLevel,
              kind: "intensity",
              recommendedIntensity: plan.recommendedIntensity,
              requestedIntensity: step,
            });
          }
          const goalNote = goalId
            ? ""
            : " 워너비 체형이 없으면 choose-body-goal을 먼저 열라고 안내하세요.";
          const structuralNote =
            plan.structuralIssues.length > 0
              ? ` 구조 문제: ${plan.structuralIssues.map((issue) => `${issue.title}: ${issue.detail}`).join(" ")} 체중·체지방과 상관없이 왜 꼭 해야 하는지 설명하고, 모드·강도를 바꿔도 필수 교정 종목은 빼지 마세요.`
              : "";
          const exerciseBrief = plan.exercises
            .map((item, index) => {
              const load =
                item.workingWeightKg > 0
                  ? `${item.workingWeightKg}kg`
                  : "무게 탐색";
              return `${index + 1}. ${item.nameKo}${item.required ? "(필수)" : ""} — ${item.sets || "AMRAP"}×${item.reps}회 · ${load} · 방법: ${item.method} · 이유: ${item.why}`;
            })
            .join("\n");
          const injuryAsk =
            injured.length === 0
              ? " 아직 injuredParts가 비어 있으면, 운동 전에 어깨·손목·허리·무릎 등 불편한 곳이 있는지 채팅으로만 한 줄 묻는다. recommend-inbody-workout을 다시 열어 카드를 추가하지 마세요. 사용자가 말한 부위는 다음 저장·장소 변경 때 injuredParts로 넘긴다."
              : ` 불편 부위: ${injured
                  .map((p) => injuredPartLabel[p] ?? p)
                  .join(", ")}.`;
          const evidence = evidenceForPlan({
            isImbalanced: plan.isImbalanced,
            shape: plan.shape,
            phase: plan.phase,
            recommendedMode: plan.recommendedMode,
            hasWeakPriority: plan.weakLabels.length > 0,
          });
          const evidenceBlock = formatEvidenceForModel(evidence);
          const cacheNote =
            weekPlanSource === "cache"
              ? ` 이번 주(${weekStart}~${weekEnd}) 계획은 이미 DB에 있어서 불러오기만 했다(weekPlan.source=cache). search-training-docs를 다시 부르지 마세요. 사용자가 근거·왜?를 물을 때만 검색하세요.`
              : ` 이번 주(${weekStart}~${weekEnd}) 코스를 새로 짜서 DB에 저장했다(weekPlan.source=fresh). 아직 workout_course를 안 읽었으면 search-training-docs로 1회만 읽어 설득·근거에 쓰고, 카드를 다시 열지 마세요.`;
          const inbodyGateNote =
            snapshot.ecwRatio == null || snapshot.visceralFatLevel == null
              ? " 저장된 인바디에 ECW/TBW 또는 VFL이 없다. 결과지 사진으로 save-inbody를 다시 호출해 ecwRatio·visceralFatLevel·heightCm·sex를 채우세요. 안전 게이트가 약해질 수 있다."
              : ` ECW/TBW=${snapshot.ecwRatio}, VFL=${snapshot.visceralFatLevel}(저장값).`;
          return {
            content: [
              shown(
                restToday
                  ? `${plan.phaseLabel} · ${plan.shape}자형 · ${day}은 휴식(X)입니다. 이번 주 ${weekStart}~${weekEnd} 코스는 ${weekPlanSource === "cache" ? "저장된 계획" : "새로 저장"}입니다.`
                  : `${plan.phaseLabel} · ${plan.shape}자형 · ${venue === "home" ? "홈트레이닝" : "헬스장"} · ${plan.sessionLabel} · ${modeLabel[plan.recommendedMode]} · ${plan.prescription.bandLabel}. ${plan.exercises.map((item) => (item.required ? `${item.nameKo}(필수)` : item.nameKo)).join(", ")}.`,
              ),
              modelOnly(
                `맞춤 운동 카드를 열었습니다.${cacheNote}${inbodyGateNote} ${plan.scheduleReason} ${plan.weekHint}. ${plan.inbodyReasoning}. 부위는 트레이너가 정했다. 사용자에게 상체/하체/전신을 고르라고 하지 마세요. 헬스장/홈트레이닝과 집 기구만 카드에서 바꿉니다. 사용자에게 코스 요약과 각 종목의 method·why를 설명해 주세요.\n${exerciseBrief || "(오늘은 휴식)"}
모드·중량을 단순 회피로 낮추려 하면 설득하고, 부상·통증이면 즉시 대체합니다.${structuralNote}${goalNote}${injuryAsk}\n사용자가 "왜?", "근거가 뭐야?", "논문/링크 보여줘"라고 하면 structuredContent.evidence의 pitch와 links URL을 그대로 보여 주세요. 지어내지 마세요. AMRAP·EMOM·RIR·%1RM 등 용어를 물을 때는 structuredContent.glossary의 body로 쉽게 설명해 주세요.\n과학적 근거:\n${evidenceBlock}`,
              ),
            ],
            structuredContent: {
              inbodySaved: true,
              bodyGoalSaved: Boolean(goalId),
              message: goalId
                ? weekPlanSource === "cache"
                  ? `이번 주(${weekStart}~${weekEnd}) 저장된 코스를 불러왔습니다.`
                  : `이번 주(${weekStart}~${weekEnd}) 코스를 짜서 저장했습니다.`
                : "워너비 체형 사진을 고르면 운동 코스와 설득 멘트가 그 목표를 따라갑니다.",
              date: day,
              clientDate: day,
              clientTimeZone: clock.timeZone,
              weekPlan,
              shape: plan.shape,
              phase: plan.phase,
              phaseLabel: plan.phaseLabel,
              isImbalanced: plan.isImbalanced,
              recommendedMode: plan.recommendedMode,
              recommendedIntensity: plan.recommendedIntensity,
              reason: plan.reason,
              inbodyReasoning: plan.inbodyReasoning,
              safetyNotes: plan.safetyNotes,
              injuredParts: plan.injuredParts,
              prescription: plan.prescription,
              evidence,
              glossary: glossaryList().map((item) => ({
                id: item.id,
                label: item.label,
                title: item.title,
                body: item.body,
              })),
              persuasion,
              persuasionIntensity,
              overrideLine,
              weakLabels: plan.weakLabels,
              targetLabels: plan.targetLabels,
              targetBodyType: plan.targetBodyType ?? "",
              targetBodyLabel: plan.targetBodyLabel,
              trainingVenue: plan.trainingVenue,
              sessionFocus: plan.sessionFocus,
              sessionKind: plan.sessionKind,
              sessionLabel: plan.sessionLabel,
              scheduleBias: plan.scheduleBias,
              scheduleReason: plan.scheduleReason,
              weekHint: plan.weekHint,
              splitLabel: plan.splitLabel,
              missingSlots: plan.missingSlots,
              recentExerciseNames,
              homeEquipment: plan.homeEquipment,
              splitRecommended: plan.splitRecommended,
              splitHint: plan.splitHint,
              catalog,
              snapshot,
              e1RmByExercise,
              structuralIssues: plan.structuralIssues,
              exercises: plan.exercises,
              timer: plan.timer,
              radar,
              sex: snapshot.sex,
              bodyFatKg: snapshot.bodyFatKg,
              targetDays: user.targetDays ?? 0,
              energy: plan.energy,
              toneLevel,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "add-catalog-exercises",
          description:
            "맞춤 운동 DB에 없는 역할만 종목으로 넣는다. recommend-inbody-workout이 workout_catalog_gaps로 거절했을 때(또는 missingSlots)의 role만 받는다. 이미 DB에 있는 종목은 다시 넣지 않는다. 뷰를 열거나 바꾸지 않는다. 넣은 뒤 같은 장소·기구·clientDate로 recommend-inbody-workout을 한 번만 호출해 완성 카드를 연다(미완성 카드 재오픈 아님).",
          inputSchema: {
            trainingVenue: z
              .enum(trainingVenues)
              .describe("지금 카드의 장소. gym 또는 home."),
            homeEquipment: z
              .array(z.enum(homeEquipmentIds))
              .optional()
              .describe("home일 때 집에 있는 기구. gym이면 생략."),
            exercises: z
              .array(
                z.object({
                  role: z
                    .enum(exerciseRoleIds as [string, ...string[]])
                    .describe("missingSlots의 role. 그 외는 거절된다."),
                  slug: z
                    .string()
                    .min(3)
                    .max(40)
                    .describe("영문 소문자와 하이픈. 예: incline-db-press"),
                  nameKo: z.string().min(2).max(40).describe("한글 종목 이름"),
                  laterality: z
                    .enum(["unilateral", "bilateral"])
                    .describe("한 팔·한 다리면 unilateral, 양쪽이면 bilateral"),
                  cue: z
                    .string()
                    .min(4)
                    .max(160)
                    .describe("한 줄 수행 포인트"),
                }),
              )
              .min(1)
              .max(8),
          },
          annotations: {
            title: "Add catalog exercises",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Adding missing exercises…",
            "openai/toolInvocation/invoked": "Catalog updated.",
          },
        },
        async ({ trainingVenue, homeEquipment, exercises }) => {
          const venue: TrainingVenue =
            trainingVenue === "home" ? "home" : "gym";
          const gear = new Set(
            normalizeHomeEquipment(
              venue === "home" ? (homeEquipment as HomeEquipment[]) : undefined,
            ),
          );
          const accepted: {
            slug: string;
            nameKo: string;
            kind: "strength";
            laterality: "unilateral" | "bilateral";
            region: "upper" | "core" | "lower" | "full";
            isolation: number;
            cue: string;
          }[] = [];
          const rejected: string[] = [];
          for (const item of exercises) {
            const slot = slotByRole(item.role);
            if (!slot) {
              rejected.push(`${item.role}: 알 수 없는 역할`);
              continue;
            }
            const slug = item.slug
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, "")
              .slice(0, 40);
            const nameKo = item.nameKo.trim();
            if (slug.length < 3 || nameKo.length < 2) {
              rejected.push(`${item.nameKo}: 이름 형식이 맞지 않습니다`);
              continue;
            }
            const draft = { slug, nameKo };
            if (
              venue === "home" &&
              (venueOf(draft) === "gym" || !gear.has(homeEquipmentNeeded(draft)))
            ) {
              rejected.push(
                `${nameKo}: 홈에서 고른 기구(${[...gear].join(", ")})로 할 수 없습니다`,
              );
              continue;
            }
            accepted.push({
              slug,
              nameKo,
              kind: "strength",
              laterality: item.laterality,
              region: slot.region,
              isolation: slot.isolation,
              cue: item.cue.trim(),
            });
          }
          const saved =
            accepted.length > 0 ? await insertExercises(accepted) : { saved: [], skipped: [] };
          const line = [
            saved.saved.length > 0 ? `추가: ${saved.saved.join(", ")}` : "",
            saved.skipped.length > 0 ? `이미 있음: ${saved.skipped.join(", ")}` : "",
            rejected.length > 0 ? `거절: ${rejected.join(" / ")}` : "",
          ]
            .filter(Boolean)
            .join(". ");
          return {
            content: [
              shown(line || "넣을 종목이 없습니다."),
              modelOnly(
                `${line || "변경 없음."} 뷰는 아직 없다. 이어서 recommend-inbody-workout을 trainingVenue=${venue}${venue === "home" ? `, homeEquipment=${[...gear].join(",")}` : ""}로 한 번만 열어 완성 카드를 연다. 부위를 사용자에게 고르라고 하지 마세요. 거절된 종목은 기구에 맞게 다시 넣으세요. 입력창에 쓰지 마라.`,
              ),
            ],
            structuredContent: {
              saved: saved.saved,
              skipped: saved.skipped,
              rejected,
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-workout-week-plan",
          description:
            "맞춤 운동 카드에서 편집한 이번 주(월~일) 코스(요일 O/X·종목)를 workout_week_plans에 저장한다. 뷰를 열거나 바꾸지 않는다. O인데 exercises가 비어 있으면 거절한다. 입력창에 쓰지 마라.",
          inputSchema: {
            trainingVenue: z
              .enum(trainingVenues)
              .describe("gym 또는 home. 카드의 장소."),
            homeEquipment: z
              .array(z.enum(homeEquipmentIds))
              .optional()
              .describe("home일 때 집 기구. gym이면 생략."),
            plan: weekPlanSaveSchema.describe(
              "카드 draftWeek 전체. weekStart·weekEnd·days(7일) 필수.",
            ),
            ...clientClockFields(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save weekly workout course",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving this week’s course…",
            "openai/toolInvocation/invoked": "Weekly course saved.",
          },
        },
        async (
          { trainingVenue, homeEquipment, plan, clientDate, clientTimeZone, accountKey },
          extra,
        ) => {
          const userId = await readyUserId(extra, accountKey);
          if (!userId) {
            return {
              content: [
                shown("로그인이 필요합니다."),
                modelOnly(
                  "save-workout-week-plan은 ready 계정만 저장한다. open-home으로 키를 확보한 뒤 다시 호출하세요. 입력창에 쓰지 마라.",
                ),
              ],
              isError: true as const,
              structuredContent: {
                ok: false as const,
                loginRequired: true,
                message: "로그인이 필요합니다.",
              },
            };
          }
          const venue: TrainingVenue =
            trainingVenue === "home" ? "home" : "gym";
          const gear = normalizeHomeEquipment(
            venue === "home" ? (homeEquipment as HomeEquipment[]) : undefined,
          );
          const gearKey = homeEquipmentKey(venue, gear);
          const emptyO = plan.days.find(
            (day) => day.mark === "O" && (day.exercises?.length ?? 0) === 0,
          );
          if (emptyO) {
            return {
              content: [
                shown(
                  `${emptyO.dayLabel || emptyO.date}은 운동(O)인데 종목이 없어 저장하지 않았다.`,
                ),
                modelOnly(
                  "O일 exercises가 비어 저장 거절. 카드에서 다시 O로 채우거나 휴식(X)으로 바꾼 뒤 save-workout-week-plan을 호출하세요. recommend를 다시 열지 마세요. 입력창에 쓰지 마라.",
                ),
              ],
              isError: true as const,
              structuredContent: {
                ok: false as const,
                reason: "empty_training_day",
                date: emptyO.date,
                message: "운동(O) 날에 종목이 없습니다.",
              },
            };
          }
          const gapDay = plan.days.find(
            (day) =>
              day.mark === "O" && (day.missingSlots?.length ?? 0) > 0,
          );
          if (gapDay) {
            return {
              content: [
                shown("빈 운동 역할(missingSlots)이 있어 저장하지 않았다."),
                modelOnly(
                  "missingSlots가 있는 O일이 있다. add-catalog-exercises 후 카드에서 종목을 채우고 다시 저장하세요. 입력창에 쓰지 마라.",
                ),
              ],
              isError: true as const,
              structuredContent: {
                ok: false as const,
                reason: "workout_catalog_gaps",
                date: gapDay.date,
                message: "빈 슬롯이 있는 날은 저장할 수 없습니다.",
              },
            };
          }
          const clock = resolveClientDay(
            clientDate && clientDate.length > 0
              ? clientDate
              : plan.weekStart,
            clientTimeZone,
          );
          const { weekStart, weekEnd } = seoulWeekBounds(
            clock.day || plan.weekStart,
          );
          if (plan.weekStart !== weekStart) {
            return {
              content: [
                shown("이번 주 시작일(월요일)이 기기 날짜 주와 맞지 않아 저장하지 않았다."),
                modelOnly(
                  `plan.weekStart=${plan.weekStart}, 기기 주 월요일=${weekStart}. 같은 주 계획만 저장하세요. 입력창에 쓰지 마라.`,
                ),
              ],
              isError: true as const,
              structuredContent: {
                ok: false as const,
                reason: "week_mismatch",
                message: "주 시작일이 맞지 않습니다.",
              },
            };
          }
          const existing = await getWorkoutWeekPlan({
            userId,
            weekStart,
            venue,
            homeEquipment: gearKey,
          });
          let fingerprint = plan.fingerprint || existing?.fingerprint || "";
          if (!fingerprint) {
            const user = await getUserProfile(userId);
            const catalog = await listExercises();
            fingerprint = weekPlanFingerprint({
              targetBodyType: user?.targetBodyType ?? null,
              targetDays: user?.targetDays ?? null,
              injuredParts: [],
              inbodyMeasuredOn: user?.inbodyMeasuredOn,
              weightKg: user?.weightKg ?? 0,
              skeletalMuscleKg: user?.skeletalMuscleKg ?? 0,
              bodyFatKg: user?.bodyFatKg ?? 0,
              muscleUpperLeftKg: user?.muscleUpperLeftKg ?? 0,
              muscleUpperRightKg: user?.muscleUpperRightKg ?? 0,
              muscleCoreKg: user?.muscleCoreKg ?? 0,
              muscleLowerLeftKg: user?.muscleLowerLeftKg ?? 0,
              muscleLowerRightKg: user?.muscleLowerRightKg ?? 0,
              heightCm: user?.heightCm ?? null,
              sex: user?.sex ?? null,
              ecwRatio: user?.ecwRatio ?? null,
              visceralFatLevel: user?.visceralFatLevel ?? null,
              catalogSlugs: catalog.map((row) => row.slug),
            });
          } else if (existing?.fingerprint) {
            fingerprint = existing.fingerprint;
          }
          const payload: WeekPlanPayload = {
            ...(plan as unknown as WeekPlanPayload),
            weekStart,
            weekEnd: plan.weekEnd || weekEnd,
            venue,
            homeEquipment: gear,
            fingerprint,
            source: "cache",
          };
          await upsertWorkoutWeekPlan({
            userId,
            weekStart,
            weekEnd: payload.weekEnd,
            venue,
            homeEquipment: gearKey,
            fingerprint,
            planJson: JSON.stringify(payload),
          });
          return {
            content: [
              shown(
                `이번 주(${weekStart}~${payload.weekEnd}) 운동 코스를 저장했습니다.`,
              ),
              modelOnly(
                "workout_week_plans에 저장했다. recommend-inbody-workout을 다시 열지 마세요. 입력창에 쓰지 마라.",
              ),
            ],
            structuredContent: {
              ok: true as const,
              weekStart,
              weekEnd: payload.weekEnd,
              message: "이번 주 코스를 저장했습니다.",
            },
          };
        },
      )
      .registerTool(
        {
          name: "lookup-exercise-howto",
          description:
            "운동 종목 이름을 유튜브에서 '{종목} 하는법'으로 검색해 영상 링크를 돌려준다. 맞춤 운동 카드의 '운동방법 찾기'가 호출한다. 뷰를 바꾸지 않는다.",
          inputSchema: {
            exerciseName: z
              .string()
              .min(1)
              .max(80)
              .describe("운동 종목 한글 이름. 예: 푸시업"),
            limit: z
              .number()
              .int()
              .min(1)
              .max(8)
              .optional()
              .describe("가져올 영상 수. 생략하면 5."),
          },
          annotations: {
            title: "Find exercise how-to videos",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Searching YouTube for how-to…",
            "openai/toolInvocation/invoked": "How-to videos ready.",
          },
        },
        async ({ exerciseName, limit }) => {
          const result = await searchExerciseHowto(exerciseName, limit ?? 5);
          const lines =
            result.videos.length > 0
              ? result.videos
                  .map((item, index) => `${index + 1}. ${item.title} — ${item.url}`)
                  .join("\n")
              : `검색 결과 HTML을 읽지 못했습니다. 유튜브에서 직접 보세요: ${result.searchUrl}`;
          return {
            content: [
              shown(
                result.videos.length > 0
                  ? `'${result.query}' 유튜브 영상 ${result.videos.length}개를 찾았습니다.`
                  : `'${result.query}' 영상 목록을 바로 못 가져왔습니다. 검색 페이지 링크를 열 수 있습니다.`,
              ),
              modelOnly(
                `유튜브 검색 '${result.query}'. 사용자에게 URL을 그대로 보여 주세요. 지어내지 마세요.\n${lines}`,
              ),
            ],
            structuredContent: {
              exerciseName,
              query: result.query,
              searchUrl: result.searchUrl,
              videos: result.videos,
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-workout-log",
          description:
            "인바디 맞춤 운동 카드에서 사용자가 완료를 누른 뒤 호출한다. 수행한 타이머 모드, 총 시간(초), 라운드/세트, 종목 목록을 저장한다. 종목마다 workout_logs 한 줄을 새로 넣고 기존 기록을 고치지 않는다. log-workout 카드의 저장은 save-workout-logs를 쓴다.",
          inputSchema: {
            date: z.string().describe("YYYY-MM-DD"),
            mode: z.enum(workoutTimerModes).describe("실제로 수행한 타이머 모드"),
            recommendedMode: z
              .enum(workoutTimerModes)
              .describe("카드가 처음 추천한 모드"),
            overridden: z
              .boolean()
              .describe("추천 모드를 설득 후 바꿨으면 true"),
            durationSec: z.number().nonnegative().describe("총 운동 시간(초)"),
            rounds: z
              .number()
              .int()
              .nonnegative()
              .describe("AMRAP 라운드 또는 완료 세트 수"),
            entries: z
              .array(workoutEntrySchema)
              .min(1)
              .describe("수행한 종목"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save timed workout",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the timed workout…",
            "openai/toolInvocation/invoked": "Timed workout saved.",
          },
        },
        async (
          {
            date,
            mode,
            recommendedMode,
            overridden,
            durationSec,
            rounds,
            entries,
            accountKey,
          },
          extra,
        ) => {
          const userId = await accountId(extra, accountKey);
          const user = await getUserProfile(userId);
          const day = date.length > 0 ? date : seoulToday();
          const bodyWeightKg = user?.weightKg ?? 0;
          const durationMin =
            Math.round((Math.max(0, durationSec) / 60) * 10) / 10;
          const items = entries
            .map(normalizeWorkoutEntry)
            .filter((item) => item.exercise.length > 0)
            .map((item, _index, list) => {
              const share =
                item.durationMin > 0
                  ? item.durationMin
                  : Math.round((durationMin / Math.max(1, list.length)) * 10) /
                    10;
              return {
                ...item,
                durationMin: share,
                burnedKcal: estimateBurnedKcal(
                  item.kind,
                  share,
                  item.sets,
                  bodyWeightKg,
                  item.weightKg,
                  item.reps,
                ),
                mode: mode as (typeof workoutModes)[number],
                rounds,
              };
            });
          if (items.length === 0) {
            return {
              content: "종목이 비어 있어 저장하지 않았습니다.",
              structuredContent: {
                saved: false,
                message: "종목이 비어 있어 저장하지 않았습니다.",
                date: day,
                burnedKcal: 0,
                volumeKg: 0,
              },
              isError: true,
            };
          }
          await insertWorkoutLogs(userId, day, items);
          const burnedKcal = items.reduce((sum, item) => sum + item.burnedKcal, 0);
          const volumeKg = Math.round(
            items.reduce(
              (sum, item) =>
                sum + workoutVolume(item.weightKg, item.reps, item.sets),
              0,
            ),
          );
          const overrideNote =
            overridden && mode !== recommendedMode
              ? ` 추천은 ${modeLabel[recommendedMode as WorkoutTimerMode]}였는데 ${modeLabel[mode]}로 바꿨습니다.`
              : "";
          const message = `${day} ${modeLabel[mode]} 운동 저장. ${items.length}종목, ${durationMin}분, 라운드/세트 ${rounds}, 소모 약 ${burnedKcal}kcal.${overrideNote}`;
          return {
            content: message,
            structuredContent: {
              saved: true,
              message,
              date: day,
              mode,
              recommendedMode,
              overridden,
              durationSec,
              rounds,
              count: items.length,
              burnedKcal,
              volumeKg,
            },
          };
        },
      )
}
