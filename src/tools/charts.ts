import type { McpServer } from "skybridge/server";
import { z } from "zod";
import { affiliateFor,
  affiliateRedirectDomains } from "../affiliate.js";
import {
  addDays,
  daysBetween,
  getEtagSecret,
  getInbody,
  getUserProfile,
  listInbodyReadings,
  listMealLogs,
  listWorkoutLogs,
  saveInbody,
  listWorkoutWeekPlansOverlapping,
  seoulToday
} from "../db/client.js";
import { nutrientSource } from "../db/food-lookup.js";
import { issueEtag } from "../etag.js";
import {
  dayStatus,
  goalSourceLabel,
  resolveGoals
} from "../goals.js";
import {
  parseWeekPlanPayload
} from "../workout-week-plan.js";
import { resolveClientDay } from "../device-time.js";
import {
  TREE_STAGE_COUNT,
  TREE_STAGE_META,
  growthStageFromGoodDays
} from "../habit-stickers.js";
import {
  estimateOneRm,
  weekStart,
  workoutVolume
} from "../workout.js";

import {
  chartSeriesSchema,
  inbodySeriesSchema,
  eachDate,
  shown,
  modelOnly,
  accountId,
  accountKeyField,
  clientClockFields,
  guestKey,
  mealMissCopy
} from "./helpers.js";

// Tool registration module (behavior preserved from server.ts).
export function registerCharts<S extends McpServer>(server: S) {
  return server
      .registerTool(
        {
          name: "get-daily-summary-chart",
          description:
            "하루(생략하면 오늘) 요약을 목표 달성 링으로 보여 준다. 활동 칼로리·탄수화물·단백질·지방 달성률과 끼니별 칼로리가 나온다. 목표는 save-goals로 저장한 값이고, 없으면 인바디로 추정한다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다. accountKey를 지어내지 않는다.",
          inputSchema: {
            date: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Daily diet summary",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Loading the diet summary…",
            "openai/toolInvocation/invoked": "Diet summary ready.",
          },
          view: {
            component: "daily-summary",
            description: "Daily goal rings and meal calories",
            csp: {
              resourceDomains: [
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
              ],
              redirectDomains: affiliateRedirectDomains,
            },
          },
        },
        async ({ date, accountKey }, extra) => {
          const day = date && date.length > 0 ? date : seoulToday();
          const userId = await accountId(extra, accountKey);
          const [meals, workouts, user] = await Promise.all([
            listMealLogs(userId, day, day),
            listWorkoutLogs(userId, day, day),
            getUserProfile(userId),
          ]);
          const totals = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
          let carb = 0;
          let protein = 0;
          let fat = 0;
          for (const row of meals) {
            totals[row.meal] += row.kcal;
            carb += row.carbG;
            protein += row.proteinG;
            fat += row.fatG;
          }
          const breakfast = Math.round(totals.breakfast);
          const lunch = Math.round(totals.lunch);
          const dinner = Math.round(totals.dinner);
          const snack = Math.round(totals.snack);
          const kcal = breakfast + lunch + dinner + snack;
          const carbG = Math.round(carb);
          const proteinG = Math.round(protein);
          const fatG = Math.round(fat);
          const burned = Math.round(
            workouts.reduce((sum, row) => sum + row.burnedKcal, 0),
          );
          const goals = resolveGoals(user);
          const ring = (
            key: "activity" | "carb" | "protein" | "fat",
            label: string,
            value: number,
            goal: number,
            unit: "kcal" | "g",
          ) => ({
            key,
            label,
            value,
            goal,
            unit,
            percent: goal > 0 ? Math.round((value / goal) * 100) : 0,
          });
          const rings = [
            ring("activity", "활동 칼로리", burned, goals.burnKcal, "kcal"),
            ring("carb", "탄수화물", carbG, goals.carbG, "g"),
            ring("protein", "단백질", proteinG, goals.proteinG, "g"),
            ring("fat", "지방", fatG, goals.fatG, "g"),
          ];
          const logged = meals.length > 0;
          const proteinGap = logged ? Math.max(0, goals.proteinG - proteinG) : 0;
          const remaining = goals.kcal - kcal;
          const feedback = !logged
            ? "이 날은 식사 기록이 없습니다. 한 끼만 올려도 링이 돌기 시작해요."
            : remaining < 0
              ? `목표보다 ${-remaining}kcal 많습니다. 다음 한 끼는 가볍게 가 봐요.`
              : `목표까지 ${remaining}kcal 남았어요. 다음 한 끼가 승부처입니다.`;
          const affiliate = await affiliateFor(
            proteinGap > 0 ? { kind: "protein", gapG: proteinGap } : null,
          );
          return {
            content: logged
              ? `${day} 섭취 ${kcal}kcal(목표 ${goals.kcal}kcal, ${goalSourceLabel[goals.source]}), 소모 ${burned}kcal. 아침 ${breakfast}, 점심 ${lunch}, 저녁 ${dinner}, 간식 ${snack}. 탄 ${carbG}g, 단 ${proteinG}g, 지 ${fatG}g. ${feedback} 출처: ${nutrientSource.ko}`
              : `${day} ${feedback}`,
            structuredContent: {
              date: day,
              breakfast,
              lunch,
              dinner,
              snack,
              kcal,
              carbG,
              proteinG,
              fatG,
              burned,
              goalKcal: goals.kcal,
              goalSource: goals.source,
              goalSourceLabel: goalSourceLabel[goals.source],
              rings,
              toneLevel: 0,
              feedback,
              source: logged ? nutrientSource : null,
              affiliate,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "show-inbody-chart",
          description:
            "저장된 인바디 측정일의 체중·골격근·체지방·부위 근육 변화를 차트로 보여 준다. 근육 해부도, 5부위 방사형 차트, C-I-D 체형 막대(체중·골격근량·체지방량의 표준 대비 %)가 함께 나온다. 사용자가 ‘인바디 보여줘’처럼 물으면 이 도구를 쓴다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다. accountKey를 지어내지 않고, 사용자에게 식별 불가를 말하지 않는다. 1주·1달처럼 기간에 모양을 고정하지 않는다. 사용자가 말한 시작일·종료일과, 질문 의도에 맞춘 series를 넘긴다. 날짜를 생략하면 저장된 전체를 그린다. 체중·체성분 추세는 line, 측정일 크기 비교는 bar, 누적 경향은 area다. kg는 yAxisId left, 체지방률은 right다.",
          inputSchema: {
            startDate: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. 생략하면 첫 측정일."),
            endDate: z
              .string()
              .optional()
              .describe("YYYY-MM-DD. 생략하면 마지막 측정일."),
            series: z
              .array(inbodySeriesSchema)
              .min(1)
              .optional()
              .describe(
                "한 차트에 겹칠 지표. 생략하면 체중·골격근·체지방 line. 체중 변화면 weightKg line, 체성분이면 골격근·체지방을 함께, 부위 균형이면 다섯 근육을 고른다.",
              ),
            ...accountKeyField(),
          },
          annotations: {
            title: "InBody change chart",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Drawing the InBody chart…",
            "openai/toolInvocation/invoked": "InBody chart ready.",
          },
          view: {
            component: "inbody-chart",
            description: "Weight and body-composition change chart",
            csp: { redirectDomains: affiliateRedirectDomains },
          },
        },
        async ({ startDate, endDate, series, accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          const body = await getUserProfile(userId);
          let all = await listInbodyReadings(userId, "0000-01-01", "9999-12-31");
          if (all.length === 0) {
            const latest = await getInbody(userId);
            if (
              latest?.inbodyMeasuredOn &&
              latest.weightKg != null &&
              latest.skeletalMuscleKg != null &&
              latest.bodyFatKg != null
            ) {
              await saveInbody(userId, {
                inbodyMeasuredOn: latest.inbodyMeasuredOn,
                weightKg: latest.weightKg,
                skeletalMuscleKg: latest.skeletalMuscleKg,
                bodyFatKg: latest.bodyFatKg,
                bodyFatPercent: latest.bodyFatPercent ?? 0,
                muscleUpperLeftKg: latest.muscleUpperLeftKg ?? 0,
                muscleUpperRightKg: latest.muscleUpperRightKg ?? 0,
                muscleCoreKg: latest.muscleCoreKg ?? 0,
                muscleLowerLeftKg: latest.muscleLowerLeftKg ?? 0,
                muscleLowerRightKg: latest.muscleLowerRightKg ?? 0,
                ...(latest.ecwRatio != null
                  ? { ecwRatio: latest.ecwRatio }
                  : {}),
                ...(latest.visceralFatLevel != null
                  ? { visceralFatLevel: latest.visceralFatLevel }
                  : {}),
                ...(latest.heightCm != null
                  ? { heightCm: latest.heightCm }
                  : {}),
                ...(latest.sex === "female" || latest.sex === "male"
                  ? { sex: latest.sex }
                  : {}),
              });
              all = await listInbodyReadings(userId, "0000-01-01", "9999-12-31");
            }
          }
          const start = startDate && startDate.length > 0 ? startDate : (all[0]?.measuredOn ?? seoulToday());
          const end = endDate && endDate.length > 0 ? endDate : (all.at(-1)?.measuredOn ?? start);
          const from = start <= end ? start : end;
          const to = start <= end ? end : start;
          const rows = all.filter(
            (row) => row.measuredOn >= from && row.measuredOn <= to,
          );
          const points = rows.map((row) => ({
            date: row.measuredOn,
            weightKg: row.weightKg,
            skeletalMuscleKg: row.skeletalMuscleKg,
            bodyFatKg: row.bodyFatKg,
            bodyFatPercent: row.bodyFatPercent,
            muscleUpperLeftKg: row.muscleUpperLeftKg,
            muscleUpperRightKg: row.muscleUpperRightKg,
            muscleCoreKg: row.muscleCoreKg,
            muscleLowerLeftKg: row.muscleLowerLeftKg,
            muscleLowerRightKg: row.muscleLowerRightKg,
          }));
          const first = points[0];
          const last = points.at(-1);
          const weightDelta =
            first && last ? Math.round((last.weightKg - first.weightKg) * 10) / 10 : 0;
          const fatDelta =
            first && last ? Math.round((last.bodyFatKg - first.bodyFatKg) * 10) / 10 : 0;
          const feedback =
            points.length === 0
              ? "이 기간에 저장된 인바디가 없습니다. 결과지를 올리면 여기부터 점이 찍힙니다."
              : points.length < 2
                ? "기록이 한 번뿐입니다. 다음 결과지를 올리면 변화가 선으로 이어집니다."
              : weightDelta > 0 || fatDelta > 0
                ? `체중 ${weightDelta}kg, 체지방 ${fatDelta}kg. 다음 측정 전에 한 끼를 정리해 봐요.`
                : `체중 ${weightDelta}kg, 체지방 ${fatDelta}kg. 다음 결과지까지 이 방향을 유지해 봐요.`;
          const lower = last
            ? last.muscleLowerLeftKg + last.muscleLowerRightKg
            : 0;
          const upper = last
            ? last.muscleUpperLeftKg + last.muscleUpperRightKg
            : 0;
          const drawn = (series ?? [
            {
              metric: "weightKg" as const,
              label: "체중",
              visualType: "line" as const,
              yAxisId: "left" as const,
            },
            {
              metric: "skeletalMuscleKg" as const,
              label: "골격근",
              visualType: "line" as const,
              yAxisId: "left" as const,
            },
            {
              metric: "bodyFatKg" as const,
              label: "체지방",
              visualType: "line" as const,
              yAxisId: "left" as const,
            },
          ]).map((item) => ({
            metric: item.metric,
            label: item.label,
            visualType: item.visualType,
            yAxisId: item.yAxisId,
          }));
          return {
            content: `${from}~${to} 인바디 ${points.length}회. ${drawn
              .map((item) => `${item.label} ${item.visualType}`)
              .join(", ")}. ${feedback}`,
            structuredContent: {
              startDate: from,
              endDate: to,
              points,
              series: drawn,
              heightCm: body?.heightCm ?? 0,
              sex: body?.sex ?? "",
              toneLevel: 0,
              feedback,
              affiliate: await affiliateFor(
                last !== undefined && lower < upper
                  ? { kind: "lower-body" }
                  : null,
              ),
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "show-diet-chart",
          description:
            "저장된 식단을 차트로 보여 준다. 카드 기본은 기간별 탄·단·지 kcal 누적 막대와 하루 권장 kcal 기준선이다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다. accountKey를 지어내지 않는다. 생략하면 최근 30일이다. 질문 의도에 맞춘 series를 넘길 수 있다. 목표를 지켰는지 물으면 metric balance를 bar로 넣는다. 한 달이 넘는 성실도는 show-habit-calendar를 쓴다.",
          inputSchema: {
            startDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 30일 전."),
            endDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘."),
            series: z
              .array(chartSeriesSchema)
              .min(1)
              .optional()
              .describe(
                "한 차트에 겹칠 지표. 생략하면 kcal 누적 bar와 burnedKcal line. 질문 의도에 맞게 막대·꺾은선·영역을 조합한다.",
              ),
            goalKcal: z
              .number()
              .positive()
              .optional()
              .describe(
                "사용자가 이번 질문에서 말한 하루 목표 칼로리. 생략하면 저장한 목표나 인바디 추정치를 쓴다.",
              ),
            proteinGoalG: z
              .number()
              .positive()
              .optional()
              .describe("하루 단백질 목표(g). 평균이 이보다 낮으면 부족분 카드를 붙인다."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Diet chart",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Drawing the diet chart…",
            "openai/toolInvocation/invoked": "Diet chart ready.",
          },
          view: {
            component: "diet-chart",
            description: "Composable diet chart for the requested period",
            csp: { redirectDomains: affiliateRedirectDomains },
          },
        },
        async ({ startDate, endDate, series, goalKcal, proteinGoalG, accountKey }, extra) => {
          const today = seoulToday();
          const defaultStart = addDays(today, -29);
          const rawStart = startDate && startDate.length > 0 ? startDate : defaultStart;
          const rawEnd = endDate && endDate.length > 0 ? endDate : today;
          const start = rawStart <= rawEnd ? rawStart : rawEnd;
          const end = rawStart <= rawEnd ? rawEnd : rawStart;
          const userId = await accountId(extra, accountKey);
          const [rows, workouts, user] = await Promise.all([
            listMealLogs(userId, start, end),
            listWorkoutLogs(userId, start, end),
            getUserProfile(userId),
          ]);
          const emptyDay = () => ({
            kcal: 0,
            carbG: 0,
            proteinG: 0,
            fatG: 0,
            breakfast: 0,
            lunch: 0,
            dinner: 0,
            snack: 0,
            burnedKcal: 0,
          });
          const byDate = new Map<string, ReturnType<typeof emptyDay>>();
          for (const date of eachDate(start, end)) byDate.set(date, emptyDay());
          for (const row of rows) {
            const day = byDate.get(row.date) ?? emptyDay();
            day.kcal += row.kcal;
            day.carbG += row.carbG;
            day.proteinG += row.proteinG;
            day.fatG += row.fatG;
            day[row.meal] += row.kcal;
            byDate.set(row.date, day);
          }
          for (const row of workouts) {
            const day = byDate.get(row.date) ?? emptyDay();
            day.burnedKcal += row.burnedKcal;
            byDate.set(row.date, day);
          }
          const goals = resolveGoals(user, goalKcal);
          const goal = goals.kcal;
          const points = [...byDate.entries()].map(([date, totals]) => ({
            date,
            kcal: Math.round(totals.kcal),
            carbG: Math.round(totals.carbG),
            proteinG: Math.round(totals.proteinG),
            fatG: Math.round(totals.fatG),
            breakfast: Math.round(totals.breakfast),
            lunch: Math.round(totals.lunch),
            dinner: Math.round(totals.dinner),
            snack: Math.round(totals.snack),
            burnedKcal: Math.round(totals.burnedKcal),
            carbKcal: Math.round(totals.carbG * 4),
            proteinKcal: Math.round(totals.proteinG * 4),
            fatKcal: Math.round(totals.fatG * 9),
            // Days without a meal log have no balance to judge.
            balance: totals.kcal > 0 ? Math.round(totals.kcal - goal) : 0,
          }));
          const logged = points.filter((point) => point.kcal > 0);
          const dayCount = logged.length || 1;
          const avgProtein =
            logged.reduce((sum, point) => sum + point.proteinG, 0) / dayCount;
          const proteinTarget = proteinGoalG ?? goals.proteinG;
          const proteinGap =
            logged.length > 0
              ? Math.max(0, Math.round(proteinTarget - avgProtein))
              : 0;
          const avgKcal =
            logged.reduce((sum, point) => sum + point.kcal, 0) / dayCount;
          const surplus = logged.length > 0 && avgKcal > goal;
          const feedback = surplus
            ? "괜찮아요. 내일은 한 끼만 더 맞춰 봐요."
            : "이 기간 그래프는 정직합니다. 내일 한 끼가 다음 점입니다.";
          const drawn = (series ?? [
            {
              metric: "kcal" as const,
              label: "섭취 칼로리",
              visualType: "bar" as const,
              isStacked: true,
              yAxisId: "left" as const,
            },
            {
              metric: "burnedKcal" as const,
              label: "운동 소모",
              visualType: "line" as const,
              isStacked: false,
              yAxisId: "left" as const,
            },
          ]).map((item) => ({
            metric: item.metric,
            label: item.label,
            visualType: item.visualType,
            isStacked: item.isStacked ?? false,
            yAxisId: item.yAxisId,
          }));
          const hasIntake = logged.length > 0;
          return {
            content: hasIntake
              ? `${start}~${end} 차트 ${drawn
                  .map((item) => `${item.label} ${item.visualType}`)
                  .join(", ")}. ${feedback} 출처: ${nutrientSource.ko}`
              : `${start}~${end} ${feedback}`,
            structuredContent: {
              startDate: start,
              endDate: end,
              goalKcal: goal,
              goalCarbG: goals.carbG,
              goalProteinG: goals.proteinG,
              goalFatG: goals.fatG,
              goalCarbKcal: goals.carbKcal,
              goalProteinKcal: goals.proteinKcal,
              goalFatKcal: goals.fatKcal,
              ffmKg: goals.ffmKg,
              bmrKcal: goals.bmrKcal,
              tdeeKcal: goals.tdeeKcal,
              hasGoal: true,
              goalSource: goals.source,
              goalSourceLabel: goalSourceLabel[goals.source],
              points,
              series: drawn,
              source: hasIntake ? nutrientSource : null,
              toneLevel: 0,
              feedback,
              affiliate: await affiliateFor(
                proteinGap > 0 ? { kind: "protein", gapG: proteinGap } : null,
              ),
            },
          };
        },
      )
      .registerTool(
        {
          name: "show-workout-chart",
          description:
            "저장된 운동의 성장을 차트로 보여 준다. 종목별 주간 총 볼륨(중량 kg × 횟수 × 세트)은 영역 차트, 추정 1RM(Epley)은 산점도로 그린다. 점진적 과부하나 ‘스쿼트 늘었어?’ 같은 질문에 쓴다. exercise를 생략하면 가장 자주 한 종목을 고르고, 카드에서 종목을 바꿀 수 있다. 최근 기록에는 id와 etag가 붙고, delete-workout-log는 그 etag로만 지운다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다.",
          inputSchema: {
            exercise: z.string().optional().describe("먼저 보여 줄 종목. 생략 가능"),
            startDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 12주 전."),
            endDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘."),
            ...accountKeyField(),
          },
          annotations: {
            title: "Workout volume and 1RM",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Drawing the workout chart…",
            "openai/toolInvocation/invoked": "Workout chart ready.",
          },
          view: {
            component: "workout-chart",
            description: "Weekly volume area chart and 1RM scatter chart",
          },
        },
        async ({ exercise, startDate, endDate, accountKey }, extra) => {
          const today = seoulToday();
          const rawStart =
            startDate && startDate.length > 0 ? startDate : addDays(today, -83);
          const rawEnd = endDate && endDate.length > 0 ? endDate : today;
          const start = rawStart <= rawEnd ? rawStart : rawEnd;
          const end = rawStart <= rawEnd ? rawEnd : rawStart;
          const userId = await accountId(extra, accountKey);
          const [rows, secret] = await Promise.all([
            listWorkoutLogs(userId, start, end),
            getEtagSecret(userId),
          ]);
          const lastWeek = weekStart(end);
          const names = [...new Set(rows.map((row) => row.exercise))];
          const exercises = names
            .map((name) => {
              const own = rows.filter((row) => row.exercise === name);
              const volumeByWeek = new Map<string, number>();
              const burnedByWeek = new Map<string, number>();
              const oneRmByDate = new Map<
                string,
                { oneRm: number; weightKg: number; reps: number }
              >();
              for (const row of own) {
                const week = weekStart(row.date);
                volumeByWeek.set(
                  week,
                  (volumeByWeek.get(week) ?? 0) +
                    workoutVolume(row.weightKg, row.reps, row.sets),
                );
                burnedByWeek.set(
                  week,
                  (burnedByWeek.get(week) ?? 0) + row.burnedKcal,
                );
                const oneRm = estimateOneRm(row.weightKg, row.reps);
                const best = oneRmByDate.get(row.date);
                if (oneRm > 0 && (!best || oneRm > best.oneRm)) {
                  oneRmByDate.set(row.date, {
                    oneRm,
                    weightKg: row.weightKg,
                    reps: row.reps,
                  });
                }
              }
              const weekly: {
                week: string;
                volume: number;
                burnedKcal: number;
              }[] = [];
              let week = weekStart(own[0]?.date ?? end);
              while (week <= lastWeek && weekly.length < 60) {
                weekly.push({
                  week,
                  volume: Math.round(volumeByWeek.get(week) ?? 0),
                  burnedKcal: Math.round(burnedByWeek.get(week) ?? 0),
                });
                week = addDays(week, 7);
              }
              return {
                exercise: name,
                kind: own[0]?.kind ?? "strength",
                sessions: new Set(own.map((row) => row.date)).size,
                weekly,
                oneRm: [...oneRmByDate.entries()].map(([date, best]) => ({
                  date,
                  ...best,
                })),
              };
            })
            .sort((a, b) => b.sessions - a.sessions);
          const wanted = exercise?.trim().toLowerCase() ?? "";
          const selected =
            (wanted.length > 0
              ? exercises.find((item) =>
                  item.exercise.toLowerCase().includes(wanted),
                )
              : undefined) ?? exercises[0];
          const issuedAt = Date.now();
          const logs = await Promise.all(
            rows
              .slice(-30)
              .reverse()
              .map(async (row) => ({
                id: row.id,
                etag: await issueEtag(
                  secret,
                  "workout_log",
                  row.id,
                  row.createdAt,
                  issuedAt,
                ),
                date: row.date,
                exercise: row.exercise,
                kind: row.kind,
                weightKg: row.weightKg,
                reps: row.reps,
                sets: row.sets,
                durationMin: row.durationMin,
                burnedKcal: Math.round(row.burnedKcal),
                volume: Math.round(
                  workoutVolume(row.weightKg, row.reps, row.sets),
                ),
              })),
          );
          // Strength grows in volume (kg), cardio in burned kcal.
          const strength = selected?.kind !== "cardio";
          const weekValue = (offset: number) => {
            const week = selected?.weekly.at(offset);
            return week ? (strength ? week.volume : week.burnedKcal) : 0;
          };
          const recent = weekValue(-1);
          const previous = weekValue(-2);
          const measure = strength ? "주간 볼륨이" : "주간 소모가";
          const unit = strength ? "kg" : "kcal";
          const feedback = !selected
            ? "이 기간에 저장된 운동이 없습니다. 오늘 한 운동을 말해 주면 여기부터 선이 시작됩니다."
            : selected.weekly.length < 2
              ? `${selected.exercise} 기록이 한 주뿐입니다. 다음 주 기록이 붙으면 성장이 보입니다.`
              : recent > previous
                ? `${selected.exercise} ${measure}이(가) ${previous}${unit}에서 ${recent}${unit}로 올랐어요. 다음 주에도 한 칸만 더 올려 봐요.`
                : recent === previous
                  ? `${selected.exercise} ${measure}이(가) 지난주와 같은 ${recent}${unit}입니다. 다음 운동에서 한 세트만 더 채워 봐요.`
                  : `${selected.exercise} ${measure}이(가) ${previous}${unit}에서 ${recent}${unit}로 내려왔어요. 다음 운동에서 한 세트만 더 채워 봐요.`;
          return {
            content: [
              shown(
                `${start}~${end} 운동 ${rows.length}줄, ${exercises.length}종목. ${feedback}`,
              ),
              modelOnly(
                "logs의 id와 etag는 15분 동안만 delete-workout-log에 쓸 수 있습니다. 사용자가 지우자고 한 기록 하나만 지웁니다.",
              ),
            ],
            structuredContent: {
              startDate: start,
              endDate: end,
              selected: selected?.exercise ?? "",
              exercises,
              logs,
              totalBurnedKcal: Math.round(
                rows.reduce((sum, row) => sum + row.burnedKcal, 0),
              ),
              toneLevel: 0,
              feedback,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "show-habit-calendar",
          description:
            "한 달이 넘는 식단·운동 성실도를 월별 달력 한 장으로 보여 준다(식단/운동 탭 없음). ‘오늘’은 기기 로컬 날짜(clientDate·clientTimeZone)를 쓴다. 칸 색은 섭취 목표. 스티커는 워너비 체형 시작일(targetStartedOn)~기한 끝날에만, 기기 오후 12시 이후: 미기록·섭취 과다=노력하세요, 기록+소모 충분=참잘했어요. 달력 아래 성장 나무도 같은 기간의 참잘했어요를 6단계로 균등 분배한다. 홈 위젯이 clientDate를 넘긴다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다.",
          inputSchema: {
            startDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 90일 전."),
            endDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 기기 오늘."),
            goalKcal: z
              .number()
              .positive()
              .optional()
              .describe(
                "사용자가 이번 질문에서 말한 하루 목표 칼로리. 생략하면 저장한 목표나 인바디 추정치를 쓴다.",
              ),
            ...clientClockFields(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Habit calendar",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Drawing the habit calendar…",
            "openai/toolInvocation/invoked": "Habit calendar ready.",
          },
          view: {
            component: "habit-calendar",
            description: "Monthly habit calendar with day numbers",
          },
        },
        async (
          { startDate, endDate, goalKcal, accountKey, clientDate, clientTimeZone },
          extra,
        ) => {
          const clock = resolveClientDay(clientDate, clientTimeZone);
          const today = clock.day;
          const rawStart =
            startDate && startDate.length > 0 ? startDate : addDays(today, -89);
          const rawEnd = endDate && endDate.length > 0 ? endDate : today;
          const end = rawStart <= rawEnd ? rawEnd : rawStart;
          const firstAsked = rawStart <= rawEnd ? rawStart : rawEnd;
          // The heatmap holds at most one year.
          const start =
            daysBetween(firstAsked, end) > 365 ? addDays(end, -365) : firstAsked;
          const userId = await accountId(extra, accountKey);
          // Need profile first so growth window (targetDays) can widen the fetch.
          const user = await getUserProfile(userId);
          const targetDays =
            typeof user?.targetDays === "number" && user.targetDays > 0
              ? user.targetDays
              : 0;
          const targetStartedOn =
            typeof user?.targetStartedOn === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(user.targetStartedOn)
              ? user.targetStartedOn
              : "";
          const targetEndedOnRaw =
            typeof user?.targetEndedOn === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(user.targetEndedOn)
              ? user.targetEndedOn
              : "";
          const bodyGoalSaved = Boolean(
            user?.targetBodyType && targetDays > 0 && targetStartedOn,
          );
          // Stickers + tree: only the saved body-goal window (prefer stored end).
          const growthPeriodStart = bodyGoalSaved ? targetStartedOn : "";
          const growthPeriodEnd = bodyGoalSaved
            ? targetEndedOnRaw ||
              addDays(targetStartedOn, Math.max(0, targetDays - 1))
            : "";
          const fetchStart =
            bodyGoalSaved && growthPeriodStart && growthPeriodStart < start
              ? growthPeriodStart
              : start;
          const stickerRangeStart = growthPeriodStart || fetchStart;
          const stickerRangeEnd = growthPeriodEnd || end;
          const [meals, workouts, weekPlanRows] = await Promise.all([
            listMealLogs(userId, fetchStart, end),
            listWorkoutLogs(userId, fetchStart, end),
            // Rest-day stickers only matter inside a saved body-goal window.
            bodyGoalSaved
              ? listWorkoutWeekPlansOverlapping(
                  userId,
                  stickerRangeStart,
                  stickerRangeEnd,
                )
              : Promise.resolve([]),
          ]);
          // Newest plan wins when the same date appears in multiple venue rows.
          const markByDay = new Map<string, "O" | "X">();
          for (const row of [...weekPlanRows].reverse()) {
            const plan = parseWeekPlanPayload(row.planJson);
            if (!plan) continue;
            for (const slot of plan.days) {
              if (
                slot?.date &&
                (slot.mark === "O" || slot.mark === "X") &&
                slot.date >= stickerRangeStart &&
                slot.date <= stickerRangeEnd
              ) {
                markByDay.set(slot.date, slot.mark);
              }
            }
          }
          const restDays = [...markByDay]
            .filter(([, mark]) => mark === "X")
            .map(([day]) => day)
            .sort();
          const goals = resolveGoals(user, goalKcal);
          const kcalByDay = new Map<string, number>();
          for (const row of meals) {
            kcalByDay.set(row.date, (kcalByDay.get(row.date) ?? 0) + row.kcal);
          }
          const burnedByDay = new Map<string, number>();
          for (const row of workouts) {
            burnedByDay.set(
              row.date,
              (burnedByDay.get(row.date) ?? 0) + row.burnedKcal,
            );
          }
          // Include growth-window logs even when they fall before the calendar start.
          const dataDays = eachDate(fetchStart, end);
          const days = dataDays
            .filter((day) => kcalByDay.has(day) || burnedByDay.has(day))
            .map((day) => {
              const kcal = Math.round(kcalByDay.get(day) ?? 0);
              return {
                day,
                kcal,
                burnedKcal: Math.round(burnedByDay.get(day) ?? 0),
                status: kcalByDay.has(day)
                  ? dayStatus(kcal, goals.kcal)
                  : ("none" as const),
                worked: burnedByDay.has(day),
              };
            });
          const calendarDays = days.filter(
            (item) => item.day >= start && item.day <= end,
          );
          const allDays = eachDate(start, end);
          const count = (status: string) =>
            calendarDays.filter((item) => item.status === status).length;
          const loggedDays = calendarDays.filter(
            (item) => item.status !== "none",
          ).length;
          let currentStreak = 0;
          let cursor = kcalByDay.has(end) ? end : addDays(end, -1);
          while (cursor >= start && kcalByDay.has(cursor)) {
            currentStreak += 1;
            cursor = addDays(cursor, -1);
          }
          const summary = {
            totalDays: allDays.length,
            loggedDays,
            metDays: count("met"),
            overDays: count("over"),
            farOverDays: count("far-over"),
            missedDays: allDays.length - loggedDays,
            workoutDays: calendarDays.filter((item) => item.worked).length,
            currentStreak,
          };
          const feedback =
            summary.loggedDays === 0
              ? "이 기간에 식사 기록이 없습니다. 오늘 한 끼부터 칸을 채워 봐요."
              : summary.missedDays > 0
                ? `${summary.totalDays}일 중 ${summary.missedDays}일이 회색입니다. ${
                    mealMissCopy()
                  }`
                : `${summary.totalDays}일을 하루도 빠짐없이 기록했어요. 초록 ${summary.metDays}일, 내일도 한 칸 더 심어 봐요.`;
          // Growth stage is finalized in the widget (device noon). Server sends the window.
          const growthStage = bodyGoalSaved
            ? growthStageFromGoodDays(0, targetDays)
            : 1;
          const growthLabel =
            TREE_STAGE_META[Math.max(0, growthStage - 1)]?.label ?? "씨앗";
          return {
            content: `${start}~${end} ${summary.totalDays}일 중 기록 ${summary.loggedDays}일(목표 안 ${summary.metDays}, 초과 ${summary.overDays}, 크게 초과 ${summary.farOverDays}), 운동 ${summary.workoutDays}일, 연속 ${summary.currentStreak}일. 목표 ${goals.kcal}kcal(${goalSourceLabel[goals.source]}). ${feedback}${
              bodyGoalSaved
                ? ` 스티커·성장나무는 ${growthPeriodStart}~${growthPeriodEnd}(워너비 ${targetDays}일)에만 적용. 주간 코스 휴식일(X)은 참잘했어요. 참잘을 ${TREE_STAGE_COUNT}단계로 균등 분배(위젯 계산).`
                : " 워너비 체형·시작일이 없으면 스티커는 없고 성장나무는 1단계(씨앗)만 보여 준다."
            }`,
            structuredContent: {
              startDate: start,
              endDate: end,
              goalKcal: goals.kcal,
              goalBurnKcal: goals.burnKcal,
              goalSource: goals.source,
              goalSourceLabel: goalSourceLabel[goals.source],
              days,
              restDays,
              summary,
              toneLevel: 0,
              feedback,
              clientDate: today,
              clientTimeZone: clock.timeZone,
              targetDays,
              targetStartedOn: targetStartedOn || null,
              targetEndedOn: growthPeriodEnd || null,
              growth: {
                bodyGoalSaved,
                targetDays,
                targetStartedOn: targetStartedOn || null,
                targetEndedOn: growthPeriodEnd || null,
                periodStart: growthPeriodStart,
                periodEnd: growthPeriodEnd,
                stageCount: TREE_STAGE_COUNT,
                // Placeholder; widget recounts with device noon.
                goodDays: 0,
                stage: growthStage,
                stageLabel: growthLabel,
              },
            },
          };
        },
      )
}
