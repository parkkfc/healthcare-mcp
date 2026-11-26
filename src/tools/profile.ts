import { FileRef } from "skybridge/server";
import type { McpServer } from "skybridge/server";
import { z } from "zod";
import {
  addDays,
  daysBetween,
  getHandProfile,
  getInbody,
  getUserProfile,
  INBODY_MIN_INTERVAL_DAYS,
  listInbodyReadings,
  saveBodyProfile,
  saveDisplayName,
  saveGoals,
  saveHandProfile,
  saveInbody,
  clearTargetBodyGoal,
  saveTargetBodyType
} from "../db/client.js";
import {
  sexes,
  targetBodyTypes
} from "../db/schema.js";
import {
  goalFieldsFromInbody,
  goalSourceLabel,
  resolveGoals
} from "../goals.js";
import {
  bodyGoalLabel,
  bodyGoalPresets,
  findBodyGoal,
  type TargetBodyType
} from "../body-goals.js";
import { resolveClientDay } from "../device-time.js";
import {
  identify,
  identityProblem
} from "../identity.js";

import {
  shown,
  modelOnly,
  withHomeTip,
  guideNextStep,
  normalizeDisplayName,
  accountId,
  readyUserId,
  accountKeyField,
  clientClockFields,
  guestKey,
  rememberAccountKey
} from "./helpers.js";

// Tool registration module (behavior preserved from server.ts).
export function registerProfile<S extends McpServer>(server: S) {
  return server
      .registerTool(
        {
          name: "set-display-name",
          description:
            "MVP에서는 호출하지 않는다. 사용자는 ‘고객님’으로만 부른다. (이후 단계에서만) 사용자가 자기 이름을 적는 카드를 바로 연다. 저장 여부를 조회하지 않는다. 저장된 이름이 없거나 이름을 바꾸겠다고 하면 호출한다. 이름을 대화로 묻지 않는다. Claude에서는 알려진 accountKey를 넘긴다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Set display name",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening the name card…",
            "openai/toolInvocation/invoked": "Name card ready.",
          },
          view: {
            component: "set-display-name",
            description: "Type the name the trainer should use",
          },
        },
        async ({ accountKey }, extra) => {
          const userId = await readyUserId(extra, accountKey);
          return {
            content: [
              modelOnly(
                "이름 카드를 열었습니다. 사용자가 저장할 때까지 기다리세요. 대화로 이름을 받지 마세요.",
              ),
            ],
            structuredContent: {
              saved: false,
              displayName: "",
              accountKey: userId?.startsWith("guest_") ? userId : "",
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-display-name",
          description:
            "이름 카드에서 사용자가 적은 이름을 users.display_name에 저장한다. 카드 버튼으로만 호출한다. 계정 번호로 쓰지 않는다. Claude에서는 카드의 accountKey를 함께 넘긴다.",
          inputSchema: {
            name: z.string().describe("사용자가 카드에 적은 이름"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save display name",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the name…",
            "openai/toolInvocation/invoked": "Name saved.",
          },
        },
        async ({ name, accountKey }, extra) => {
          const displayName = normalizeDisplayName(name);
          if (!displayName) {
            return {
              content: [
                shown("이름은 1~16자의 글자로 저장합니다. 카드에서 다시 적어 주세요."),
              ],
              structuredContent: { saved: false, displayName: "", accountKey: "" },
              isError: true,
            };
          }
          const identity = await identify(extra, accountKey, { wait: true });
          if (identity.state !== "ready") {
            const problem = identityProblem(identity);
            return {
              content: [
                shown(withHomeTip(problem.shown)),
                modelOnly(problem.model),
              ],
              structuredContent: { saved: false, displayName: "", accountKey: "" },
              isError: true,
            };
          }
          const userId = identity.userId;
          await saveDisplayName(userId, displayName);
          const keyHint = rememberAccountKey(userId);
          const next = guideNextStep("hand");
          return {
            content: [
              shown(
                withHomeTip(
                  `${displayName} 이름으로 저장했습니다. 다음으로 손 크기를 등록해요.`,
                ),
              ),
              modelOnly(
                `이제 ${displayName}으로 부르세요. ${next.model}`,
              ),
              ...(keyHint ? [keyHint] : []),
            ],
            structuredContent: {
              saved: true,
              displayName,
              accountKey: guestKey(userId),
              nextStep: "hand",
            },
          };
        },
      )
      .registerTool(
        {
          name: "get-hand-size",
          description:
            "저장된 손 길이·손바닥 폭·1줌 부피(ml)를 조회한다. 대화가 시작되면, 그리고 식사 사진(그릇·줌)을 분석하기 전에 호출한다. Claude에서는 accountKey를 넘긴다. saved가 false면 신용카드와 손·생쌀 1줌 사진을 요청하고 preview-hand-size로 저장한다. 글만 기록(기준 분량)은 손 없이도 가능하다. saved가 true여도 식사 사진에는 매번 손바닥이 그릇 옆에 보여야 한다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Get saved hand size",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Checking saved hand size…",
            "openai/toolInvocation/invoked": "Hand size checked.",
          },
        },
        async ({ accountKey }, extra) => {
          const profile = await getHandProfile(await accountId(extra, accountKey));
          if (!profile) {
            return {
              content: [
                shown("저장된 손 치수·1줌이 없습니다."),
                modelOnly(
                  "지금 신용카드(8.56cm × 5.4cm)와 손을 나란히 놓은 사진을 요청하세요. 생쌀 1줌은 참고 사진처럼 네 손가락이 손바닥을 덮는 형태로 쥔 뒤, 그 쌀의 무게(g) 또는 컵·그릇에 넣고 용기 지름·쌀이 쌓인 높이를 알려 달라고 하세요. 1줌은 한식 반찬 kcal 줌 계산에 쓰입니다. 홈 손 치수 카드 또는 preview-hand-size로 저장하세요. 사진·줌·그릇 경로에서는 저장 전에 식사 사진을 분석하지 마세요. 글만(바나나 1개 등)은 손 없이도 됩니다.",
                ),
              ],
              structuredContent: {
                saved: false,
                handLengthCm: 0,
                handWidthCm: 0,
                handfulVolumeMl: 0,
              },
            };
          }
          return {
            content: [
              shown(
                `손 길이 ${profile.handLengthCm}cm, 손바닥 폭 ${profile.handWidthCm}cm, 1줌 ${profile.handfulVolumeMl}ml이 저장되어 있습니다.`,
              ),
              modelOnly(
                "식사 사진에는 매번 손바닥이 그릇 옆에 보여야 합니다. 그릇 지름은 그 사진의 손바닥과 저장된 폭을 비교해 추정하세요. 한식 반찬·고기·튀김 줌은 handfulVolumeMl을 씁니다.",
              ),
            ],
            structuredContent: {
              saved: true,
              handLengthCm: profile.handLengthCm,
              handWidthCm: profile.handWidthCm,
              handfulVolumeMl: profile.handfulVolumeMl ?? 0,
            },
          };
        },
      )
      .registerTool(
        {
          name: "preview-hand-size",
          description:
            "신용카드(8.56cm × 5.4cm)와 손 사진에서 손 길이·폭을 읽고, 생쌀 1줌 부피(ml) 확인 카드를 연다. 카드의 손사진은 참고용이다. 손모양은 네 손가락이 손바닥을 덮는 형태. 사용자는 생쌀 무게(g) 또는 컵·그릇 지름·쌀 쌓인 높이를 알려 준다(다른 손 사진을 또 찍으라고 하지 않는다). 1줌은 한식 반찬 kcal 줌 계산에 쓰인다. riceGrams 또는 cupDiameterCm+riceHeightCm을 넣거나 카드에서 입력한다. get-hand-size saved true이면 다시 호출하지 않는다.",
          inputSchema: {
            handLengthCm: z
              .number()
              .positive()
              .describe("카드 기준으로 읽은 손 길이(cm)"),
            handWidthCm: z
              .number()
              .positive()
              .describe("카드 기준으로 읽은 손바닥 폭(cm)"),
            riceGrams: z
              .number()
              .nonnegative()
              .optional()
              .describe("생쌀 1줌 무게(g). 없으면 카드에서 입력"),
            cupDiameterCm: z
              .number()
              .nonnegative()
              .optional()
              .describe("쌀을 담은 컵/그릇 지름(cm)"),
            riceHeightCm: z
              .number()
              .nonnegative()
              .optional()
              .describe("컵 안 쌀이 쌓인 높이(cm)"),
            handfulVolumeMl: z
              .number()
              .positive()
              .optional()
              .describe("이미 계산한 1줌 부피(ml)"),
            photo: FileRef.optional().describe(
              "The exact photo file the user uploaded",
            ),
          },
          annotations: {
            title: "Confirm hand size",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/fileParams": ["photo"],
            "openai/toolInvocation/invoking": "Reading hand size…",
            "openai/toolInvocation/invoked": "Hand size ready to save.",
          },
          view: {
            component: "preview-hand-size",
            description: "Confirm hand size and one-handful volume",
            csp: {
              resourceDomains: [
                "https://files.oaiusercontent.com",
                "https://*.oaiusercontent.com",
                "https://oaiusercontent.com",
                "https://chatgpt.com",
              ],
            },
          },
        },
        async ({
          handLengthCm,
          handWidthCm,
          riceGrams,
          cupDiameterCm,
          riceHeightCm,
          handfulVolumeMl,
          photo,
        }) => {
          const { resolveHandfulVolumeMl } = await import("../handful.js");
          const resolved =
            handfulVolumeMl && handfulVolumeMl > 0
              ? {
                  volumeMl: handfulVolumeMl,
                  fromGramsMl: 0,
                  fromCupMl: 0,
                }
              : resolveHandfulVolumeMl({
                  riceGrams,
                  cupDiameterCm,
                  riceHeightCm,
                });
          return {
            content: [
              shown(
                `손 길이 ${handLengthCm}cm, 손바닥 폭 ${handWidthCm}cm${
                  resolved.volumeMl > 0
                    ? `, 1줌 약 ${resolved.volumeMl}ml`
                    : ""
                }.`,
              ),
              modelOnly(
                "카드에서 손 치수와 1줌 부피를 확인한 뒤 저장하세요. 1줌이 비어 있으면 카드에서 쌀 g 또는 컵 지름·높이를 받습니다.",
              ),
            ],
            structuredContent: {
              handLengthCm,
              handWidthCm,
              riceGrams: riceGrams ?? 0,
              cupDiameterCm: cupDiameterCm ?? 0,
              riceHeightCm: riceHeightCm ?? 0,
              handfulVolumeMl: resolved.volumeMl,
              photoUrl: photo?.download_url ?? "",
              photo: {
                file_id: photo?.file_id ?? "",
                download_url: photo?.download_url ?? "",
                mime_type: photo?.mime_type ?? "",
                file_name: photo?.file_name ?? "",
              },
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-hand-size",
          description:
            "확인 카드에서 사용자가 확정한 손 길이·손바닥 폭·1줌 부피(ml)를 저장한다. 카드의 저장 버튼으로만 호출한다.",
          inputSchema: {
            handLengthCm: z.number().positive(),
            handWidthCm: z.number().positive(),
            handfulVolumeMl: z.number().positive(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save hand size",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving hand size…",
            "openai/toolInvocation/invoked": "Hand size saved.",
          },
        },
        async (
          { handLengthCm, handWidthCm, handfulVolumeMl, accountKey },
          extra,
        ) => {
          const saved = await saveHandProfile(
            await accountId(extra, accountKey),
            handLengthCm,
            handWidthCm,
            handfulVolumeMl,
          );
          const next = guideNextStep("inbody");
          return {
            content: [
              shown(
                withHomeTip(
                  `손 길이 ${saved.handLengthCm}cm, 손바닥 폭 ${saved.handWidthCm}cm, 1줌 ${saved.handfulVolumeMl}ml을 저장했습니다. 다음으로 인바디를 등록해요.`,
                ),
              ),
              modelOnly(
                `다음 식사 사진부터는 이 폭·1줌을 기준으로 하고, 사진에는 매번 손바닥이 보여야 합니다. ${next.model}`,
              ),
            ],
            structuredContent: { ...saved, nextStep: "inbody" },
          };
        },
      )
      .registerTool(
        {
          name: "get-inbody",
          description:
            "users에 저장된 최신 인바디 분석을 조회한다. 대화가 시작되면 get-hand-size, get-hand-size와 함께 호출한다. Claude에서는 accountKey를 넘긴다. saved가 false면 결과지 사진을 지금 요청하고, 사진을 읽으면 save-inbody로 저장한다. 결과지가 없다고 하면 그 항목만 넘긴다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Get InBody",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Checking saved InBody…",
            "openai/toolInvocation/invoked": "InBody checked.",
          },
        },
        async ({ accountKey }, extra) => {
          const saved = await getInbody(await accountId(extra, accountKey));
          if (!saved || saved.inbodyMeasuredOn == null) {
            return {
              content: [
                shown("저장된 인바디가 없습니다."),
                modelOnly(
                  "지금 결과지 사진을 올려 달라고 하세요. 사진에서 체중, 골격근량, 체지방량, 체지방률, 상체 좌우·코어·하체 좌우 근육량, 신장(heightCm), 성별(sex), 세포외수분비 ECW/TBW(ecwRatio), 내장지방레벨(visceralFatLevel)을 읽어 save-inbody로 저장하세요. 값을 지어내지 마세요. 결과지가 없다고 하면 이 항목만 넘기세요.",
                ),
              ],
              structuredContent: {
                saved: false,
                measuredOn: "",
                weightKg: 0,
                skeletalMuscleKg: 0,
                bodyFatKg: 0,
                bodyFatPercent: 0,
                muscleUpperLeftKg: 0,
                muscleUpperRightKg: 0,
                muscleCoreKg: 0,
                muscleLowerLeftKg: 0,
                muscleLowerRightKg: 0,
                heightCm: 0,
                sex: "",
                ecwRatio: 0,
                visceralFatLevel: 0,
              },
            };
          }
          return {
            content: [
              shown(
                `${saved.inbodyMeasuredOn} 인바디. 체중 ${saved.weightKg}kg, 골격근량 ${saved.skeletalMuscleKg}kg, 체지방량 ${saved.bodyFatKg}kg, 체지방률 ${saved.bodyFatPercent}%.`,
              ),
            ],
            structuredContent: {
              saved: true,
              measuredOn: saved.inbodyMeasuredOn,
              weightKg: saved.weightKg ?? 0,
              skeletalMuscleKg: saved.skeletalMuscleKg ?? 0,
              bodyFatKg: saved.bodyFatKg ?? 0,
              bodyFatPercent: saved.bodyFatPercent ?? 0,
              muscleUpperLeftKg: saved.muscleUpperLeftKg ?? 0,
              muscleUpperRightKg: saved.muscleUpperRightKg ?? 0,
              muscleCoreKg: saved.muscleCoreKg ?? 0,
              muscleLowerLeftKg: saved.muscleLowerLeftKg ?? 0,
              muscleLowerRightKg: saved.muscleLowerRightKg ?? 0,
              heightCm: saved.heightCm ?? 0,
              sex: saved.sex ?? "",
              ecwRatio: saved.ecwRatio ?? 0,
              visceralFatLevel: saved.visceralFatLevel ?? 0,
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-inbody",
          description:
            "호스트가 인바디 결과지에서 읽은 분석을 저장한다. 필수 등록이다. 대화·홈 위젯에 accountKey(guest_/user_)가 있으면 반드시 넣어 호출한다. 로그인 직후 채팅에 loginRequired=false·accountKey가 있으면 다시 로그인을 요구하지 말고 바로 이 도구로 저장한다. ‘로그인한 계정에만 저장’이라고 거절하지 않는다. 결과지에서 반드시 읽는다: 체중, 골격근량, 체지방량, 체지방률, 부위별 근육량(상체 좌/우·코어·하체 좌/우 kg), 신장(heightCm), 성별(sex), 세포외수분비 ECW/TBW(ecwRatio), 내장지방레벨(visceralFatLevel). 값을 지어내지 않는다. 안 보이면 전체 결과지 사진을 다시 요청한다. 저장 후 서버가 이 인바디(+워너비 체형)로 1일 권장 kcal·탄단지를 다시 계산해 users 목표에 넣는다. 같은 측정일 수정은 허용, 다른 측정일은 최소 28일 간격. 영양 수치를 추정해서 넣지 않는다.",
          inputSchema: {
            measuredOn: z.string().describe("결과지 측정일 YYYY-MM-DD"),
            weightKg: z.number().positive().describe("체중(kg)"),
            skeletalMuscleKg: z.number().positive().describe("골격근량(kg)"),
            bodyFatKg: z.number().nonnegative().describe("체지방량(kg)"),
            bodyFatPercent: z.number().nonnegative().describe("체지방률(%)"),
            muscleUpperLeftKg: z.number().nonnegative().describe("상체 좌 근육량(kg)"),
            muscleUpperRightKg: z.number().nonnegative().describe("상체 우 근육량(kg)"),
            muscleCoreKg: z.number().nonnegative().describe("코어 근육량(kg)"),
            muscleLowerLeftKg: z.number().nonnegative().describe("하체 좌 근육량(kg)"),
            muscleLowerRightKg: z.number().nonnegative().describe("하체 우 근육량(kg)"),
            heightCm: z
              .number()
              .min(100)
              .max(230)
              .describe("결과지 상단 신장(cm). C-I-D·워너비 kcal에 필수."),
            sex: z
              .enum(sexes)
              .describe("결과지 상단 성별 male|female. C-I-D·워너비 kcal에 필수."),
            ecwRatio: z
              .number()
              .min(0.3)
              .max(0.5)
              .describe(
                "세포외수분비 ECW/TBW(예: 0.380). >0.390이면 고강도 운동 유예. 결과지에서 반드시 읽는다.",
              ),
            visceralFatLevel: z
              .number()
              .int()
              .min(1)
              .max(30)
              .describe(
                "내장지방레벨 VFL. C자형이고 ≥10이면 첫날 HIIT 지양. 결과지에서 반드시 읽는다.",
              ),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save InBody",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving InBody…",
            "openai/toolInvocation/invoked": "InBody saved.",
          },
        },
        async (reading, extra) => {
          const userId = await accountId(extra, reading.accountKey);
          const existing = await listInbodyReadings(
            userId,
            "0000-01-01",
            "9999-12-31",
          );
          const last = existing.at(-1);
          if (
            last &&
            last.measuredOn !== reading.measuredOn &&
            daysBetween(last.measuredOn, reading.measuredOn) <
              INBODY_MIN_INTERVAL_DAYS
          ) {
            const wait =
              INBODY_MIN_INTERVAL_DAYS -
              daysBetween(last.measuredOn, reading.measuredOn);
            return {
              content: [
                shown(
                  withHomeTip(
                    `인바디는 최소 ${INBODY_MIN_INTERVAL_DAYS}일(약 1달) 간격으로 등록해요. 마지막 ${last.measuredOn} 기준 약 ${wait}일 뒤에 새 결과지를 올려 주세요. 같은 날 수정도 가능합니다.`,
                  ),
                ),
                modelOnly(
                  "인바디 간격이 짧아 저장하지 않았습니다. 사용자에게 1달 간격을 안내하세요. 같은 measuredOn 수정은 허용됩니다.",
                ),
              ],
              structuredContent: {
                saved: false,
                measuredOn: reading.measuredOn,
                lastMeasuredOn: last.measuredOn,
                minIntervalDays: INBODY_MIN_INTERVAL_DAYS,
              },
              isError: true,
            };
          }
          const saved = await saveInbody(userId, {
            inbodyMeasuredOn: reading.measuredOn,
            weightKg: reading.weightKg,
            skeletalMuscleKg: reading.skeletalMuscleKg,
            bodyFatKg: reading.bodyFatKg,
            bodyFatPercent: reading.bodyFatPercent,
            muscleUpperLeftKg: reading.muscleUpperLeftKg,
            muscleUpperRightKg: reading.muscleUpperRightKg,
            muscleCoreKg: reading.muscleCoreKg,
            muscleLowerLeftKg: reading.muscleLowerLeftKg,
            muscleLowerRightKg: reading.muscleLowerRightKg,
            heightCm: reading.heightCm,
            sex: reading.sex,
            ecwRatio: reading.ecwRatio,
            visceralFatLevel: reading.visceralFatLevel,
          });
          const profile = await getUserProfile(userId);
          const refreshed = goalFieldsFromInbody({
            weightKg: profile?.weightKg ?? null,
            bodyFatKg: profile?.bodyFatKg ?? null,
            heightCm: profile?.heightCm ?? null,
            sex: profile?.sex ?? null,
            targetBodyType: profile?.targetBodyType ?? null,
            targetDays: profile?.targetDays ?? null,
            goalKcal: null,
            goalCarbG: null,
            goalProteinG: null,
            goalFatG: null,
            goalBurnKcal: null,
          });
          if (refreshed) {
            await saveGoals(userId, {
              goalKcal: refreshed.goalKcal,
              goalCarbG: refreshed.goalCarbG,
              goalProteinG: refreshed.goalProteinG,
              goalFatG: refreshed.goalFatG,
              goalBurnKcal: refreshed.goalBurnKcal,
            });
          }
          const next = guideNextStep("meal");
          const kcalLine = refreshed
            ? ` 1일 권장 ${refreshed.goalKcal}kcal(탄 ${refreshed.goalCarbG}g·단 ${refreshed.goalProteinG}g·지 ${refreshed.goalFatG}g, ${goalSourceLabel[refreshed.source]})로 맞춰 두었어요.`
            : "";
          return {
            content: [
              shown(
                withHomeTip(
                  `${saved.inbodyMeasuredOn} 인바디를 저장했습니다. 체중 ${saved.weightKg}kg, 골격근량 ${saved.skeletalMuscleKg}kg, 체지방량 ${saved.bodyFatKg}kg.${kcalLine} 이제 매일 식사 기록이 필수예요.`,
                ),
              ),
              modelOnly(
                `${next.model} 운동 카드(recommend-inbody-workout)는 저장된 ECW·VFL·부위 근육으로 코스를 짠다. ecwRatio·visceralFatLevel을 운동 도구에 다시 넘기지 마세요.`,
              ),
            ],
            structuredContent: {
              saved: true,
              measuredOn: saved.inbodyMeasuredOn,
              weightKg: saved.weightKg,
              skeletalMuscleKg: saved.skeletalMuscleKg,
              bodyFatKg: saved.bodyFatKg,
              bodyFatPercent: saved.bodyFatPercent,
              heightCm: saved.heightCm,
              sex: saved.sex,
              ecwRatio: saved.ecwRatio,
              visceralFatLevel: saved.visceralFatLevel,
              goalKcal: refreshed?.goalKcal ?? null,
              goalCarbG: refreshed?.goalCarbG ?? null,
              goalProteinG: refreshed?.goalProteinG ?? null,
              goalFatG: refreshed?.goalFatG ?? null,
              goalBurnKcal: refreshed?.goalBurnKcal ?? null,
              goalSource: refreshed?.source ?? null,
              nextStep: "meal",
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-body-profile",
          description:
            "신장과 성별을 users에 저장한다. C-I-D 체형 차트의 표준 체중·골격근량·체지방량이 이 둘로 정해진다. 인바디 카드의 입력칸에서 호출하거나, 사용자가 키·성별을 말했을 때 호출한다. 추측해서 넣지 않는다.",
          inputSchema: {
            heightCm: z.number().min(100).max(230).describe("신장(cm)"),
            sex: z.enum(sexes).describe("male 또는 female"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save height and sex",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving height and sex…",
            "openai/toolInvocation/invoked": "Height and sex saved.",
          },
        },
        async ({ heightCm, sex, accountKey }, extra) => {
          await saveBodyProfile(await accountId(extra, accountKey), { heightCm, sex });
          return {
            content: `신장 ${heightCm}cm, ${sex === "male" ? "남성" : "여성"}으로 저장했습니다.`,
            structuredContent: { saved: true, heightCm, sex },
          };
        },
      )
      .registerTool(
        {
          name: "save-goals",
          description:
            "하루 목표를 users에 저장한다. 사용자가 목표 칼로리·탄단지·활동 칼로리를 말했을 때만 호출하고, 말한 항목만 넣는다. 저장하지 않으면 인바디 제지방량으로 유지 칼로리를 추정해 쓴다. 목표를 대신 정해 주지 않는다.",
          inputSchema: {
            goalKcal: z.number().positive().optional().describe("하루 섭취 목표(kcal)"),
            goalCarbG: z.number().positive().optional().describe("하루 탄수화물 목표(g)"),
            goalProteinG: z.number().positive().optional().describe("하루 단백질 목표(g)"),
            goalFatG: z.number().positive().optional().describe("하루 지방 목표(g)"),
            goalBurnKcal: z
              .number()
              .positive()
              .optional()
              .describe("하루 운동 소모 목표(kcal)"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save daily goals",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving goals…",
            "openai/toolInvocation/invoked": "Goals saved.",
          },
        },
        async ({ accountKey, ...input }, extra) => {
          const userId = await accountId(extra, accountKey);
          await saveGoals(userId, input);
          const goals = resolveGoals(await getUserProfile(userId));
          return {
            content: `목표를 저장했습니다. 하루 ${goals.kcal}kcal, 탄 ${goals.carbG}g, 단 ${goals.proteinG}g, 지 ${goals.fatG}g, 활동 ${goals.burnKcal}kcal.`,
            structuredContent: { saved: true, ...goals },
          };
        },
      )
      .registerTool(
        {
          name: "choose-body-goal",
          description:
            "워너비 체형과 달성 기한을 고르는 카드를 연다. 이미 저장돼 있으면 현재 체형·시작일·종료일을 보여 주고 운동기록 취소(clear-body-goal) 또는 수정으로 이어진다. 저장 시 시작일·종료일을 D1에 넣으며, 성실도 스티커는 그 기간에만 붙는다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다.",
          inputSchema: {
            ...clientClockFields(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Choose want-to-be body",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening body goal choices…",
            "openai/toolInvocation/invoked": "Body goal choices ready.",
          },
          view: {
            component: "choose-body-goal",
            description: "Pick a want-to-be body type from body photos",
          },
        },
        async ({ accountKey, clientDate, clientTimeZone }, extra) => {
          const userId = await readyUserId(extra, accountKey);
          const user = userId ? await getUserProfile(userId) : null;
          const clock = resolveClientDay(clientDate, clientTimeZone);
          const goal = findBodyGoal(user?.targetBodyType);
          const targetDays = user?.targetDays ?? 0;
          const targetStartedOn =
            typeof user?.targetStartedOn === "string" ? user.targetStartedOn : "";
          const targetEndedOn =
            typeof user?.targetEndedOn === "string" && user.targetEndedOn
              ? user.targetEndedOn
              : targetStartedOn && targetDays > 0
                ? addDays(targetStartedOn, Math.max(0, targetDays - 1))
                : "";
          const bodyGoalSaved = Boolean(
            goal && targetDays > 0 && targetStartedOn && targetEndedOn,
          );
          return {
            content: [
              shown(
                bodyGoalSaved
                  ? `현재 워너비는 '${goal!.title}' · ${targetStartedOn}~${targetEndedOn}입니다. 카드에서 취소하거나 수정할 수 있습니다.`
                  : "워너비 체형을 골라 주세요. 닮고 싶은 사진을 누르면 됩니다.",
              ),
              modelOnly(
                bodyGoalSaved
                  ? "이미 워너비가 저장돼 있습니다. 사용자가 수정·취소하기 전에는 recommend-inbody-workout이 이 목표를 따릅니다."
                  : "목표 체형 카드를 열었습니다. 사용자가 사진과 기한을 고르고 저장하기 전에는 recommend-inbody-workout의 운동 코스·설득에 목표가 반영되지 않습니다.",
              ),
            ],
            structuredContent: {
              bodyGoalSaved,
              selected: goal?.id ?? "",
              selectedTitle: goal?.title ?? "",
              targetDays,
              targetStartedOn: targetStartedOn || null,
              targetEndedOn: targetEndedOn || null,
              presets: bodyGoalPresets.map((item) => ({
                id: item.id,
                title: item.title,
                detail: item.detail,
              })),
              sex: user?.sex ?? "male",
              heightCm: user?.heightCm ?? 0,
              bodyFatKg: user?.bodyFatKg ?? 0,
              bodyFatPercent: user?.bodyFatPercent ?? 0,
              today: clock.day,
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "save-body-goal",
          description:
            "워너비 체형·기한을 저장한다. 시작일=기기 오늘(clientDate), 종료일=시작+(targetDays-1)을 users.target_started_on·target_ended_on에 함께 넣는다. 성실도 스티커는 이 기간에만 붙는다.",
          inputSchema: {
            targetBodyType: z.enum(targetBodyTypes),
            targetDays: z
              .number()
              .int()
              .min(14)
              .max(365)
              .describe("목표 체형까지 잡은 기한. 14일에서 365일."),
            ...clientClockFields(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Save body goal",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Saving the body goal…",
            "openai/toolInvocation/invoked": "Body goal saved.",
          },
        },
        async (
          { targetBodyType, targetDays, accountKey, clientDate, clientTimeZone },
          extra,
        ) => {
          const userId = await accountId(extra, accountKey);
          const clock = resolveClientDay(clientDate, clientTimeZone);
          const startedOn = clock.day;
          // Inclusive window: start .. start+(targetDays-1)
          const endedOn = addDays(startedOn, Math.max(0, targetDays - 1));
          await saveTargetBodyType(
            userId,
            targetBodyType,
            targetDays,
            startedOn,
            endedOn,
          );
          const profile = await getUserProfile(userId);
          const refreshed = goalFieldsFromInbody({
            weightKg: profile?.weightKg ?? null,
            bodyFatKg: profile?.bodyFatKg ?? null,
            heightCm: profile?.heightCm ?? null,
            sex: profile?.sex ?? null,
            targetBodyType,
            targetDays,
            goalKcal: null,
            goalCarbG: null,
            goalProteinG: null,
            goalFatG: null,
            goalBurnKcal: null,
          });
          if (refreshed) {
            await saveGoals(userId, {
              goalKcal: refreshed.goalKcal,
              goalCarbG: refreshed.goalCarbG,
              goalProteinG: refreshed.goalProteinG,
              goalFatG: refreshed.goalFatG,
              goalBurnKcal: refreshed.goalBurnKcal,
            });
          }
          const label = bodyGoalLabel[targetBodyType as TargetBodyType];
          const kcalBit = refreshed
            ? ` 1일 권장 ${refreshed.goalKcal}kcal로 다시 맞췄습니다.`
            : "";
          const message = `'${label}' 목표를 ${startedOn}부터 ${targetDays}일(${endedOn}까지)로 저장했습니다.${kcalBit} 성실도 스티커와 성장 나무는 이 기간에만 붙습니다.`;
          return {
            content: message,
            structuredContent: {
              saved: true,
              bodyGoalSaved: true,
              targetBodyType,
              targetDays,
              targetStartedOn: startedOn,
              targetEndedOn: endedOn,
              until: endedOn,
              goalKcal: refreshed?.goalKcal ?? null,
              goalSource: refreshed?.source ?? null,
              message,
            },
          };
        },
      )
      .registerTool(
        {
          name: "clear-body-goal",
          description:
            "저장된 워너비 체형·기한·시작일·종료일을 지운다(운동기록 취소). 성실도 스티커·성장 나무가 더 이상 붙지 않는다. 식사·운동 로그는 지우지 않는다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Clear body goal",
            readOnlyHint: false,
            destructiveHint: true,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Clearing the body goal…",
            "openai/toolInvocation/invoked": "Body goal cleared.",
          },
        },
        async ({ accountKey }, extra) => {
          const userId = await accountId(extra, accountKey);
          await clearTargetBodyGoal(userId);
          const message =
            "워너비 체형과 기한을 취소했습니다. 성실도 스티커는 다시 목표를 정할 때까지 붙지 않습니다.";
          return {
            content: message,
            structuredContent: {
              cleared: true,
              bodyGoalSaved: false,
              message,
            },
          };
        },
      )
}
