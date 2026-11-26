import { FileRef } from "skybridge/server";
import type { McpServer } from "skybridge/server";
import { z } from "zod";
import { lookupBarcode } from "../barcode.js";
import {
  addDays,
  deleteMealLog,
  getDb,
  getEtagSecret,
  getHandProfile,
  getMealLog,
  getUserProfile,
  listMealLogs,
  seoulToday,
  updateMealLogGrams
} from "../db/client.js";
import {
  lookupFoods,
  nutrientSource
} from "../db/food-lookup.js";
import {
  mealLogs,
  mealSlots
} from "../db/schema.js";
import {
  checkEtag,
  issueEtag
} from "../etag.js";
import {
  proposeMissingFood,
  foodEnergySearchQuery,
  sameFoodLabel
} from "../missing-food.js";
import {
  findExactFood,
  searchFoodCandidatesMany
} from "../db/food-lookup.js";
import { mealCoachMode } from "../meal-coach.js";
import {
  bowlPer100Ready,
  coerceMealPortionRole,
  finalizePortionEnergy,
  isVesselBowlRequest,
  parseAmountNote,
  parseStoredPortions,
  portionNeedsSavedHand,
  resolvePortionGrams,
  type PortionRequest
} from "../meal-portions.js";
import {
  identify
} from "../identity.js";

import {
  shown,
  modelOnly,
  loosePositiveNumber,
  looseNonNegativeNumber,
  accountId,
  readyUserId,
  accountKeyField,
  guestKey,
  etagField,
  preconditionFailed,
  normalizeFood
} from "./helpers.js";

// Tool registration module (behavior preserved from server.ts).
export function registerDiet<S extends McpServer>(server: S) {
  return server
    .registerTool(
      {
        name: "estimate-unit-nutrition",
        description:
          "식품 DB에 없는 음식의 1단위 kcal·탄단지 초안을 서버 경량 텍스트 모델로 채운다. 이미지는 읽지 않는다. 위젯이 DB 미스·목록에 없음일 때 호출한다. 호스트가 채팅에 kcal를 넣지 않아도 된다. 실패 시에만 호스트가 kcalPerUnit·탄단지를 lookup-meal-portions에 넣는다.",
        inputSchema: {
          foodName: z.string().min(1).describe("사용자가 적은 음식 이름."),
          unit: z
            .string()
            .min(1)
            .describe(
              "1단위 표기. 예: 1줌, 1장, 1개. 밥·국 그릇은 100g(100g당 영양).",
            ),
          ...accountKeyField(),
        },
        annotations: {
          title: "Estimate unit nutrition draft",
          readOnlyHint: true,
          destructiveHint: false,
        },
        _meta: {
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Estimating unit nutrition…",
          "openai/toolInvocation/invoked": "Unit nutrition draft ready.",
        },
      },
      async ({ foodName, unit, accountKey }, extra) => {
        void accountKey;
        void extra;
        try {
          const env = (await import("cloudflare:workers")).env as {
            AI?: {
              run: (
                model: string,
                inputs: {
                  messages: { role: string; content: string }[];
                  max_tokens?: number;
                },
              ) => Promise<unknown>;
            };
          };
          if (!env.AI) {
            throw new Error("Workers AI 바인딩이 없습니다.");
          }
          const { estimateUnitNutritionWithWorkersAi } = await import("../food-unit-estimate.js");
          const draft = await estimateUnitNutritionWithWorkersAi(env.AI, {
            foodName,
            unit,
          });
          return {
            content: [
              modelOnly(
                `estimate-unit-nutrition 초안. foodName=${draft.foodName}, unit=${draft.unit}, kcalPerUnit=${draft.kcalPerUnit}, carb=${draft.carbPerUnit}, protein=${draft.proteinPerUnit}, fat=${draft.fatPerUnit}. 위젯이 사용자 확인 후 lookup-meal-portions에 넣는다. 채팅 입력창에 숫자를 쓰지 마라.`,
              ),
            ],
            structuredContent: draft,
          };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "단위 영양 초안을 만들지 못했습니다.";
          return {
            content: [
              modelOnly(
                `estimate-unit-nutrition 실패: ${message}. 위젯이 직접 입력을 받거나, 폴백으로 호스트가 kcalPerUnit·탄단지를 lookup-meal-portions에 넣는다. 입력창에 accountKey를 넣지 마라.`,
              ),
            ],
            structuredContent: {
              foodName,
              unit,
              kcalPerUnit: 0,
              carbPerUnit: 0,
              proteinPerUnit: 0,
              fatPerUnit: 0,
              gramsPerUnit: 0,
              estimatedBy: "workers-ai" as const,
              source: "",
              draft: true as const,
              error: message,
            },
            isError: true as const,
          };
        }
      },
    )
    .registerTool(
      {
        name: "show-meal-entry-guide",
        description:
          "식사 입력 형식 안내 카드다. 홈 식사 버튼·‘식사 기록할게’면 홈과 붙이지 말고 이 도구를 별도 카드로 연다. 채팅에 예시 형식을 풀어 쓰지 마라. 음식명·양이 아직 없으면 write-meal-foods를 열지 않는다. 글만·간식은 음식명·양 뒤에 write-meal-foods를 한 번 연다. 사진+밥·국이면 get-hand-size 후 containerDiameterCm을 밥·국 items에 넣은 뒤에만 write-meal-foods를 한 번 연다. 지름 없이 호출하면 카드가 안 열린다.",
        inputSchema: {
          ...accountKeyField(),
        },
        annotations: {
          title: "Meal entry format guide",
          readOnlyHint: true,
          destructiveHint: false,
        },
        _meta: {
          "openai/toolInvocation/invoking": "Opening meal entry guide…",
          "openai/toolInvocation/invoked": "Meal entry guide ready.",
        },
        view: {
          component: "meal-entry-guide",
          description: "Shows how to type a meal in chat",
        },
      },
      async ({ accountKey }, extra) => {
        const identity = await identify(extra, accountKey, { wait: true });
        const key =
          identity.state === "ready"
            ? identity.userId
            : accountKey?.trim() || "";
        return {
          content: [
            modelOnly(
              "식사 입력 안내 카드다. 채팅에 예시 형식을 풀어 쓰지 마라. 글만·간식은 끼니·음식명·양 뒤에 write-meal-foods를 note·items(role)·accountKey로 한 번 연다. 사진+밥·국이면 get-hand-size로 손 폭을 읽고, 열기 전에 밥·국 containerDiameterCm(손 폭 cm × 그릇픽셀÷손바닥픽셀, 손 폭 복사 금지)을 items에 넣은 뒤 write-meal-foods를 한 번만 연다. 지름 없이 호출하면 오류로 카드가 안 열린다. 예시 문장을 기록하지 마라. 입력창에 쓰지 마라.",
            ),
          ],
          structuredContent: {
            accountKey: key,
            waitingForUserMeal: true,
          },
        };
      },
    )
    .registerTool(
      {
        name: "write-meal-foods",
        description:
          "한 끼 그릇 높이 카드다. 사진은 0장 또는 1장이다. 홈 식사 직후·음식명과 양이 오기 전에는 열지 말고 show-meal-entry-guide를 연다. 글만·간식은 음식명·양이 오면 이 도구를 한 번 연다. 사진+밥·국이면 필수: 먼저 get-hand-size로 손 폭(cm)을 읽고, 사진에서 밥·국마다 containerDiameterCm = 손 폭(cm)×(그릇 픽셀 지름÷손바닥 폭 픽셀)을 계산한 뒤 items에 넣고 이 도구를 한 번만 연다. 지름 없이 호출하면 카드가 열리지 않고 오류가 난다. 손·그릇이 안 보이면 추정 지름(밥~11.5·국~13.2)을 넣되 사용자가 카드에서 고치게 한다. 손 폭 cm를 지름으로 복사 금지. lookup vesselHints만 넣으면 카드에 안 들어온다. note에 원문, items에 role·containerDiameterCm·densityGPerMl(나물~0.5·김치~0.95·밥~1.1·국~1.0. 반찬에 물 1.0 금지). 사진으로 섭취량(g)을 짐작하지 않는다. 반찬은 사용자 줌·개. 밥·국 kcal는 카드에서 높이 확정 후. DB 미스는 estimate-unit-nutrition. 저장은 record-meal-photos. 입력창에 쓰지 않는다.",
        inputSchema: {
          photoCount: z
            .number()
            .int()
            .min(0)
            .max(1)
            .describe(
              "이 끼니의 사진 장수. 0 또는 1. 0이면 글만 기록이다.",
            ),
          meal: z
            .enum(mealSlots)
            .optional()
            .describe(
              "끼니 힌트(breakfast|lunch|dinner|snack). note 앞의 아침/점심/저녁/간식이 우선. 생략 시 lunch. 카드에서 다시 고르지 않는다.",
            ),
          date: z
            .string()
            .optional()
            .describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
          photos: z
            .array(FileRef)
            .max(1)
            .optional()
            .describe(
              "호스트가 준 파일 참조가 있을 때만 넣는다. 최대 1장. 파일 참조가 없으면 비우고 photoCount만 넣는다. 값을 지어내지 않는다.",
            ),
          photo: FileRef.optional().describe(
            "photos를 쓰지 못할 때만 쓰는 사진 한 장",
          ),
          note: z
            .string()
            .optional()
            .describe(
              "사용자가 채팅에 적은 음식명과 양 원문. 예: 점심 / 잡곡밥 1공기, 된장국 1그릇, 계란말이 2개, 시금치나물 1줌. 카드가 이 문장으로 그릇 높이 입력을 연다.",
            ),
          items: z
            .array(
              z.object({
                name: z.string().min(1).describe("음식 이름."),
                role: z
                  .enum([
                    "rice",
                    "soup",
                    "side",
                    "main",
                    "meat",
                    "fried",
                    "snack",
                  ])
                  .describe(
                    "호스트가 판별. 밥 rice, 국·찌개·탕 soup, 나물·무침·볶음·절임 side, 고기 meat, 튀김 fried, 양식 한 접시 main, 간식 snack. 콩나물 무침=side, 콩나물국=soup.",
                  ),
                amountNote: z
                  .string()
                  .optional()
                  .describe("사용자가 적은 양. 예: 1줌, 2개, 1공기."),
                containerDiameterCm: z
                  .number()
                  .positive()
                  .optional()
                  .describe(
                    "밥·국만. 사진 손바닥 폭 픽셀 대비 그릇 윗면 지름 픽셀 × 저장된 손 폭(cm). 손 폭 복사 금지.",
                  ),
                thicknessCm: z
                  .number()
                  .positive()
                  .optional()
                  .describe("밥·국 음식 높이(cm). 손 길이 눈금으로 추정. 선택."),
                densityGPerMl: z
                  .number()
                  .positive()
                  .max(2)
                  .optional()
                  .describe(
                    "호스트가 음식 부피밀도(g/ml)를 판별. 줌·그릇→g에 쓴다. 예: 나물·무침 0.45~0.55, 볶음·조림 0.7~0.8, 김치 0.9~1.0, 밥 1.05~1.15, 국·찌개 1.0, 고기 0.9~1.0, 전·튀김 0.65~0.75. 물 1.0을 반찬에 넣지 마라.",
                  ),
              }),
            )
            .max(20)
            .optional()
            .describe(
              "note를 쪼갠 목록. role·densityGPerMl은 호스트 판별. 사진 있으면 밥·국에 containerDiameterCm. 밀도 생략 시에만 서버 폴백.",
            ),
          ...accountKeyField(),
        },
        annotations: {
          title: "Write what was eaten",
          readOnlyHint: true,
          destructiveHint: false,
        },
        _meta: {
          "openai/fileParams": ["photos", "photo"],
          "openai/toolInvocation/invoking": "Opening the meal note…",
          "openai/toolInvocation/invoked": "Meal note ready.",
        },
        view: {
          component: "write-meal-foods",
          description: "The user writes what they ate",
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
      async (
        { meal, date, photos, photo, photoCount, note, items, accountKey },
        extra,
      ) => {
        const day = date && date.length > 0 ? date : seoulToday();
        const defaultMeal = meal ?? "lunch";
        const files = (photos && photos.length > 0 ? photos : photo ? [photo] : [])
          .slice(0, 1)
          .map((file) => ({
            file_id: file.file_id,
            download_url: file.download_url,
            mime_type: file.mime_type ?? "",
            file_name: file.file_name ?? "",
          }));
        // Claude cannot hand chat images to a tool, so the photo count alone
        // must be enough to open the card. One meal is 0 or 1 photo.
        const count = files.length > 0 ? files.length : Math.min(photoCount, 1);
        const identity = await identify(extra, accountKey, { wait: true });
        let mealCoach: "reduce" | "bulk" | "maintain" | "" = "";
        let mealCoachDetail = "";
        let bodyShape = "";
        let handLengthCm = 0;
        let handWidthCm = 0;
        let handfulVolumeMl = 0;
        if (identity.state === "ready") {
          const user = await getUserProfile(identity.userId);
          if (user) {
            const coach = mealCoachMode({
              heightCm: user.heightCm ?? 0,
              sex: user.sex ?? "",
              weightKg: user.weightKg ?? 0,
              skeletalMuscleKg: user.skeletalMuscleKg ?? 0,
              bodyFatKg: user.bodyFatKg ?? 0,
            });
            mealCoach = coach.mode;
            mealCoachDetail = coach.detail;
            bodyShape = coach.shape;
            handLengthCm = user.handLengthCm ?? 0;
            handWidthCm = user.handWidthCm ?? 0;
            handfulVolumeMl = user.handfulVolumeMl ?? 0;
          }
        }
        const foodItems = (items ?? [])
          .map((item) => ({
            name: item.name.trim(),
            role: coerceMealPortionRole(item.role),
            amountNote: (item.amountNote ?? "").trim(),
            containerDiameterCm:
              typeof item.containerDiameterCm === "number" &&
              item.containerDiameterCm > 0
                ? item.containerDiameterCm
                : undefined,
            thicknessCm:
              typeof item.thicknessCm === "number" && item.thicknessCm > 0
                ? item.thicknessCm
                : undefined,
            densityGPerMl:
              typeof item.densityGPerMl === "number" && item.densityGPerMl > 0
                ? item.densityGPerMl
                : undefined,
          }))
          .filter((item) => item.name.length > 0);
        // Photo + rice/soup: diameter must be on this first call or the card stays
        // on 「지름 비교 중」 forever (re-open is forbidden). Refuse until filled.
        const bowlsMissingDiameter =
          count > 0 &&
          defaultMeal !== "snack" &&
          foodItems.some(
            (item) =>
              (item.role === "rice" || item.role === "soup") &&
              !(item.containerDiameterCm && item.containerDiameterCm > 0),
          );
        if (bowlsMissingDiameter) {
          const missingNames = foodItems
            .filter(
              (item) =>
                (item.role === "rice" || item.role === "soup") &&
                !(item.containerDiameterCm && item.containerDiameterCm > 0),
            )
            .map((item) => item.name)
            .join(", ");
          const widthHint =
            handWidthCm > 0
              ? `저장된 손바닥 폭 ${handWidthCm}cm`
              : "먼저 get-hand-size로 손 폭(cm)을 읽고";
          return {
            content: [
              modelOnly(
                `사진+밥·국인데 containerDiameterCm이 비어 카드가 열리지 않았다. 대상: ${missingNames || "밥·국"}. ${widthHint} × (그릇 픽셀 지름 ÷ 손바닥 폭 픽셀)로 지름(cm)을 계산해 밥·국 items.containerDiameterCm에 넣은 뒤 write-meal-foods를 한 번만 다시 호출하라. 손 폭 cm를 지름으로 복사 금지. lookup vesselHints만 넣지 마라. 손·그릇이 사진에 없으면 추정값(밥 11.5·국 13.2)을 넣고 사용자가 카드에서 고치게 하라. 입력창에 쓰지 마라.`,
              ),
            ],
            isError: true as const,
            structuredContent: {
              ok: false as const,
              reason: "bowl_diameter_required",
              missingBowlNames: missingNames
                ? missingNames.split(", ").filter(Boolean)
                : [],
              handWidthCm,
              message:
                "사진+밥·국은 containerDiameterCm을 넣은 뒤에만 카드를 연다.",
            },
          };
        }
        // Density only — total kcal waits for the bowl UI + “열량 계산”.
        const db = await getDb();
        const densityRows =
          foodItems.length > 0
            ? await lookupFoods(
                db,
                foodItems.map((item) => ({
                  foodName: item.name,
                  grams: 100,
                  // Same exact match as lookup-meal-portions, never a fuzzy neighbor.
                  exact: true,
                  nameMatch: "exact" as const,
                })),
              )
            : [];
        const itemsWithDensity = foodItems.map((item, index) => {
          const row = densityRows[index];
          const kcalPerBasis = row?.kcalPerBasis ?? 0;
          const basisG = Number.parseFloat(row?.basis ?? "100");
          const denom =
            Number.isFinite(basisG) && basisG > 0 ? basisG : 100;
          const kcalPer100g =
            row?.matched && kcalPerBasis > 0
              ? Math.round(((kcalPerBasis * 100) / denom) * 10) / 10
              : 0;
          return {
            ...item,
            ...(kcalPer100g > 0 ? { kcalPer100g } : {}),
          };
        });
        const missingDensity = itemsWithDensity.some(
          (item) => !(item.densityGPerMl && item.densityGPerMl > 0),
        );
        return {
          content: [
            modelOnly(
              `식사 등록 카드(한 끼, 사진 ${files.length}장). 손 길이 ${handLengthCm}cm, 폭 ${handWidthCm}cm, 1줌 ${handfulVolumeMl}ml. role은 items로 판별됨. 카드에는 먼저 100g당 kcal만 보인다. 밥·국 총 kcal는 사용자가 그릇을 맞추고 열량 계산을 누른 뒤에만.${
                missingDensity
                  ? " items에 densityGPerMl이 비었다. 음식별 부피밀도(g/ml)를 판별해 다음 첫 호출에 넣어라. write-meal-foods 재호출로 카드를 추가하지 마라. 반찬에 물 1.0 금지. 없으면 서버 폴백 밀도를 쓴다."
                  : ""
              } 사진으로 먹은 양을 짐작하지 마세요. kcal는 사용자 단위와, 밥·국은 카드에서 높이 확정 후. 줌은 손 1줌 ${handfulVolumeMl}ml × 밀도. DB 미스는 카드가 채웁니다. 저장 전 record-meal-photos 금지. 입력창에 쓰지 마세요.`,
            ),
          ],
          structuredContent: {
            date: day,
            meal: defaultMeal,
            note: note?.trim() ?? "",
            items: itemsWithDensity,
            photos: files,
            photoCount: count,
            awaitingPhoto: false,
            mealCoach,
            mealCoachDetail,
            bodyShape,
            handLengthCm,
            handWidthCm,
            handfulVolumeMl,
          },
          _meta: { photos: files },
        };
      },
    )
    .registerTool(
      {
        name: "review-unknown-meal-food",
        description:
          "사용자가 적은 음식 이름이 식품 DB와 정확히 같지 않을 때 호출한다. 포함·접두·동의어(alsoSearch)로 DB 후보를 받는다. 사진이 있으면 비슷한 순으로 candidatePicks에 넣어 lookup-meal-portions를 호출한다. 사용자가 카드에서 고르기 전에는 matchedFoodName·nameConfirmed를 넣지 않는다. 후보가 비면 호스트가 단위 1개 kcal·탄단지 g를 넣는다. 사용자에게 이름 변경을 묻지 않는다. 웹은 하지 않는다. 꼭이면 '{음식명} {단위} 열량'만.",
        inputSchema: {
          name: z.string().min(1).describe("사용자가 적은 음식 이름."),
          amountNote: z
            .string()
            .optional()
            .describe("사용자가 적은 양. 예: 1줌, 2장, 3개. 줌은 바꾸지 않는다."),
          seenInPhoto: z
            .string()
            .optional()
            .describe(
              "식사 사진에서 본 음식. 사용자가 적은 이름과 다를 때만. 그 이름으로 DB를 같이 찾는다.",
            ),
          alsoSearch: z
            .array(z.string().min(1))
            .max(6)
            .optional()
            .describe(
              "동의어·표기 변형. 예: 계란→달걀. 호스트가 판단해 넣는다. 서버 사전 없음.",
            ),
          note: z
            .string()
            .optional()
            .describe("식사 카드가 준 구성 키. 있으면 그대로 다시 쓴다."),
          ...accountKeyField(),
        },
        annotations: {
          title: "Review a food missing from the database",
          readOnlyHint: true,
          destructiveHint: false,
        },
        _meta: {
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Checking the photo against the food database…",
          "openai/toolInvocation/invoked": "Food database checked.",
        },
      },
      async (
        { name, amountNote, seenInPhoto, alsoSearch, note, accountKey },
        extra,
      ) => {
        const userId = await readyUserId(extra, accountKey);
        if (!userId) {
          return {
            content: [
              modelOnly("계정을 확인할 수 없습니다. accountKey로 다시 호출하세요."),
            ],
            isError: true as const,
          };
        }
        const db = await getDb();
        const profile = await getHandProfile(userId);
        const typed = name.trim();
        const noted = parseAmountNote(amountNote);
        const unit = noted.handfuls > 0 ? "줌" : noted.unit || "개";
        const unitEditable = unit !== "줌";
        const handfulVolumeMl = profile?.handfulVolumeMl ?? 0;
        const aliases = (alsoSearch ?? [])
          .map((item) => item.trim())
          .filter(Boolean);
        const photoName = seenInPhoto?.trim() ?? "";
        const typedHits = await searchFoodCandidatesMany(db, [
          typed,
          ...aliases,
        ]);
        const photoHits =
          photoName && photoName !== typed
            ? await searchFoodCandidatesMany(db, [photoName, ...aliases])
            : [];
        const mapHit = (food: (typeof typedHits)[number], query: string) => ({
          foodName: food.foodName,
          basis: food.basis,
          kcal: food.kcal ?? 0,
          servingWeight: food.servingWeight ?? "",
          sameName: sameFoodLabel(query, food.foodName),
        });
        const searchQuery = foodEnergySearchQuery(typed, unit);
        const exact = typedHits.some((food) => food.foodName === typed);
        const mergedNames = [
          ...new Set([
            ...typedHits.map((food) => food.foodName),
            ...photoHits.map((food) => food.foodName),
          ]),
        ];
        return {
          content: [
            modelOnly(
              exact
                ? `${typed}은 식품 DB에 같은 이름이 있다. lookup-meal-portions에 그 이름을 그대로 넣어라. 입력창에 글을 넣지 마라. accountKey를 사용자에게 묻지 마라.`
                : mergedNames.length > 0
                  ? `${typed}은 식품 DB에 같은 이름이 없다. typedHits·photoHits를 사진과 비교해 비슷한 순으로 food_name만 candidatePicks에 넣어 같은 note·accountKey로 lookup-meal-portions를 호출하라. 동의어가 있으면 alsoSearch에 넣어라(계란→달걀). 사용자가 카드에서 고르기 전에는 matchedFoodName·nameConfirmed를 넣지 마라. 사용자에게 이름 변경·바코드를 묻지 마라. 사진·손바닥을 다시 요구하지 마라. ${unitEditable ? `단위는 더 맞으면 amountNote만 고친다.` : `단위는 줌이다. 저장된 손 1줌 ${handfulVolumeMl}ml라 바꾸지 마라.`} 웹 검색은 하지 마라. note는 ${note?.trim() || "(카드 키)"} 그대로. 입력창에 글을 넣지 마라.`
                  : `${typed}은 식품 DB 후보가 없다. 동의어(alsoSearch)로 한 번 더 찾아도 없으면 1${unit}의 kcal·탄수화물g·단백질g·지방g를 kcalPerUnit·carbPerUnit·proteinPerUnit·fatPerUnit에 넣어 lookup-meal-portions를 호출한다. 사용자에게 묻지 마라. ${unitEditable ? `단위는 더 맞으면 amountNote만 고친다.` : `단위는 줌이다. 저장된 손 1줌 ${handfulVolumeMl}ml라 바꾸지 마라.`} 웹은 하지 말고 꼭이면 "${searchQuery}"만. nameConfirmed는 넣지 마라. note는 ${note?.trim() || "(카드 키)"} 그대로. 입력창에 글을 넣지 마라.`,
            ),
          ],
          structuredContent: {
            name: typed,
            amountNote: amountNote?.trim() || "",
            unit,
            unitEditable,
            handfulVolumeMl,
            note: note?.trim() || "",
            exact,
            alsoSearch: aliases,
            webSearchQuery: searchQuery,
            typedHits: typedHits.map((food) => mapHit(food, typed)),
            photoHits: photoHits.map((food) => mapHit(food, photoName)),
            suggestedPicks: mergedNames.slice(0, 8),
          },
        };
      },
    )
    .registerTool(
      {
        name: "lookup-meal-portions",
        description:
          "식사 분량·kcal를 계산한다. 섭취량은 사진으로 짐작하지 않는다. 반찬·개수는 사용자가 적은 줌·개·장만 쓴다. 밥·국은 카드가 그릇 크기·내용물 높이를 확정한 뒤 foods의 fillRatio·지름으로 호출한다. 그 전에 밥·국 그램을 넣지 않는다. DB 미스면 후보·또는 kcal·탄단지. note 그대로. 입력창에 쓰지 않는다.",
        inputSchema: {
          note: z
            .string()
            .describe("카드가 준 구성 키. peek와 저장 모두 이 문자열 그대로."),
          handInPhoto: z
            .boolean()
            .optional()
            .describe(
              "그릇 옆에 손바닥이 보이면 true. 손바닥이 없으면 false로 vesselHints와 함께 호출하고 지름을 넣지 않는다. 글만·간식 낱개에는 생략한다.",
            ),
          palmComparison: z
            .string()
            .optional()
            .describe(
              "사진 속 손바닥과 그릇 지름을 어떻게 비교했는지 한 줄. 저장된 손바닥 폭(cm)을 기준이라고 적는다. 손 폭을 지름으로 복사하지 말고 픽셀 비율로 추정했다고 적는다.",
            ),
          vesselHints: z
            .array(
              z.object({
                name: z
                  .string()
                  .min(1)
                  .describe(
                    "밥·국·찌개 이름만. 나물·무침·볶음 반찬은 vesselHints에 넣지 않는다.",
                  ),
                role: z
                  .enum(["rice", "soup"])
                  .describe(
                    "밥 rice, 국·찌개·탕 soup. 호스트가 판별. 나물·무침은 vesselHints에 넣지 않는다.",
                  ),
                sharedPot: z
                  .boolean()
                  .optional()
                  .describe(
                    "냄비·후라이팬·전골냄비·큰 뚝배기 등 같이 덜어 먹는 그릇이면 true. true면 개인 그릇 부피 대신 줌을 받게 한다.",
                  ),
                containerDiameterCm: z
                  .number()
                  .positive()
                  .optional()
                  .describe(
                    "개인 공기·국그릇 윗면 외경(cm). 사진 손·그릇 픽셀 비율×저장된 손 폭. 손 폭을 그대로 복사 금지. 참고: 스텐 밥 ~10.5, 도자기 밥 11.3~12.5, 국 12.5~13.8, 면기 17~21. sharedPot·손 없으면 생략.",
                  ),
                thicknessCm: z
                  .number()
                  .positive()
                  .optional()
                  .describe("개인 그릇 음식 높이(cm). 손 길이 눈금으로 추정. sharedPot·손 없으면 생략."),
              }),
            )
            .max(12)
            .optional()
            .describe(
              "밥·국 개인 그릇만. 나물·무침 반찬은 넣지 않는다. handInPhoto=false면 지름 없이 재촬영 안내만.",
            ),
          foods: z
            .array(
              z.object({
                slot: z.number().int().min(1).max(12).optional().default(1),
                meal: z.enum(mealSlots).optional().default("lunch"),
                name: z.string().min(1).describe("사용자가 적은 음식 이름."),
                role: z
                  .enum([
                    "rice",
                    "meat",
                    "fried",
                    "snack",
                    "main",
                    "side",
                    "soup",
                  ])
                  .optional()
                  .default("side")
                  .describe(
                    "호스트가 판별. 밥 rice, 국·찌개·탕 soup, 나물·무침·볶음 side, 고기 meat, 튀김 fried, 양식 main, 간식 snack. 콩나물 무침=side, 콩나물국=soup. 서버는 이름으로 추측하지 않는다.",
                  ),
                cuisine: z
                  .enum(["korean", "western", "snack", "text"])
                  .optional()
                  .describe(
                    "한식 korean, 양식 western, 간식 snack, 사진 없는 글만 text. 생략 시 korean.",
                  ),
                grams: z
                  .number()
                  .positive()
                  .optional()
                  .describe(
                    "이미 정한 섭취량(g). 그릇·줌 입력이 있으면 생략한다. 글만은 servingGrams를 쓴다.",
                  ),
                coverage: z.number().min(0).max(1).optional(),
                thicknessCm: z.number().min(0).optional(),
                densityGPerMl: z
                  .number()
                  .positive()
                  .optional()
                  .describe(
                    "부피→g 밀도(g/ml). 생략 시 서버가 음식명·role로 반찬 밀도(나물~0.5, 김치~0.95, 밥~1.1 등)를 쓴다. 물 1.0을 반찬에 넣지 마라.",
                  ),
                containerDiameterCm: z
                  .number()
                  .positive()
                  .optional()
                  .describe("밥·국·양식 그릇 윗면 지름(cm). 손 길이 눈금으로 맞춘 값."),
                curvature: z.number().min(0).max(1).optional(),
                fillRatio: z.number().min(0).max(1).optional(),
                servings: z
                  .number()
                  .positive()
                  .optional()
                  .describe("밥·국 그릇이 1인분을 넘을 때 인분 수. 기본 1."),
                handfuls: z
                  .number()
                  .positive()
                  .optional()
                  .describe("고기·튀김·반찬·간식 줌. 0.5 단위."),
                handfulVolumeMl: z
                  .number()
                  .nonnegative()
                  .optional()
                  .describe(
                    "저장된 손 1줌 부피(ml). 생략하면 프로필 값을 쓴다. 0은 생략과 같다.",
                  ),
                pieceCount: z
                  .number()
                  .positive()
                  .optional()
                  .describe("사용자가 적은 단위의 개수. 1장, 2개, 반 봉지처럼 줌이 아닐 때."),
                amountNote: z
                  .string()
                  .optional()
                  .describe(
                    "사용자가 적은 양 그대로. 예: 1줌, 2장, 3개. 줌은 반찬 부피(손 1줌)로 계산한다. 그 외 단위는 호스트가 1단위 g와 개수를 판단해 servingGrams·pieceCount에 넣는다.",
                  ),
                servingGrams: loosePositiveNumber.describe(
                  "DB 또는 포장 기준 1개·1회 제공량(g). 글만·간식 낱개에 쓴다.",
                ),
                servingKcal: z
                  .number()
                  .positive()
                  .optional()
                  .describe(
                    "1인분 kcal. 양식은 부피와 10% 비교. DB에 없을 때만 웹·라벨 값.",
                  ),
                kcalPer100g: z
                  .number()
                  .positive()
                  .optional()
                  .describe(
                    "양식 그릇 비교, 또는 DB에 없는 밥·국(그릇) 100g당 kcal. 그릇 부피×밀도로 g을 구한 뒤 이 값으로 곱한다. DB에 없는 반찬은 kcalPerUnit을 쓴다. 반찬 kcal를 100g당으로 넣지 않는다.",
                  ),
                carbPer100g: looseNonNegativeNumber.describe(
                  "DB에 없는 밥·국 100g당 탄수화물 g. kcalPer100g와 함께.",
                ),
                proteinPer100g: looseNonNegativeNumber.describe(
                  "DB에 없는 밥·국 100g당 단백질 g.",
                ),
                fatPer100g: looseNonNegativeNumber.describe(
                  "DB에 없는 밥·국 100g당 지방 g.",
                ),
                kcalPerUnit: loosePositiveNumber.describe(
                  "사용자가 적은 단위 1개의 kcal. 줌이면 저장된 손 1줌 한 줌의 kcal. 장·개·봉지 등은 그 1단위 kcal. g당 kcal가 아니다. 숫자 문자열도 받는다.",
                ),
                carbPerUnit: looseNonNegativeNumber.describe(
                  "같은 단위 1개의 탄수화물 g. DB에 없을 때 필수. 차트에 반영된다.",
                ),
                proteinPerUnit: looseNonNegativeNumber.describe(
                  "같은 단위 1개의 단백질 g. DB에 없을 때 필수. 차트에 반영된다.",
                ),
                fatPerUnit: looseNonNegativeNumber.describe(
                  "같은 단위 1개의 지방 g. DB에 없을 때 필수. 차트에 반영된다.",
                ),
                nameConfirmed: z
                  .boolean()
                  .optional()
                  .describe(
                    "사용자가 카드에서 이 음식과 1단위 열량·탄단지가 맞다고 확인했을 때만 true.",
                  ),
                candidateName: z
                  .string()
                  .optional()
                  .describe(
                    "사진과 DB를 보고 고른 표시 이름. DB 이름과 다를 때 확인용. 사용자가 맞다고 하기 전에는 끼니 kcal에 쓰지 않는다.",
                  ),
                matchedFoodName: z
                  .string()
                  .optional()
                  .describe(
                    "사용자가 카드 목록에서 고른 식품 DB food_name. 글자가 정확히 같아야 한다. nameConfirmed와 함께 넣는다.",
                  ),
                alsoSearch: z
                  .array(z.string().min(1))
                  .max(6)
                  .optional()
                  .describe(
                    "동의어·표기 변형 검색어. 예: 계란일 때 달걀. 호스트가 판단한다.",
                  ),
                candidatePicks: z
                  .array(z.string().min(1))
                  .max(12)
                  .optional()
                  .describe(
                    "사진과 비슷한 순의 DB food_name. 카드 목록 순서로 쓴다. 사용자가 고르기 전.",
                  ),
                noneOfCandidates: z
                  .boolean()
                  .optional()
                  .describe(
                    "사용자가 카드에서 ‘목록에 없음’을 골랐을 때만 true. 그때 호스트가 kcal·탄단지를 채운다.",
                  ),
              }),
            )
            .optional()
            .describe(
              "비우면 peek. 있으면 그릇·줌·기준 분량으로 DB 열량을 환산해 저장한다.",
            ),
          ...accountKeyField(),
        },
        annotations: {
          title: "Estimate meal portions",
          readOnlyHint: true,
          destructiveHint: false,
        },
        _meta: {
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Estimating meal portions…",
          "openai/toolInvocation/invoked": "Meal portions ready.",
        },
      },
      async (
        {
          note,
          handInPhoto,
          palmComparison,
          vesselHints,
          foods,
          accountKey,
        },
        extra,
      ) => {
        const userId = await readyUserId(extra, accountKey);
        const key = (note ?? "").trim();
        const empty = {
          ok: false,
          waiting: false,
          note: key,
          handWidthCm: 0,
          palmComparison: "",
          foods: [] as ReturnType<typeof parseStoredPortions>,
          kcal: 0,
          carbG: 0,
          proteinG: 0,
          fatG: 0,
          message: "",
        };
        if (!userId) {
          return {
            content: [
              modelOnly("계정을 확인할 수 없습니다. accountKey로 다시 호출하세요."),
            ],
            structuredContent: {
              ...empty,
              message: "로그인된 accountKey가 필요합니다.",
            },
            isError: true as const,
          };
        }
        const profile = await getHandProfile(userId);
        const handWidthCm = profile?.handWidthCm ?? 0;
        const handLengthCm = profile?.handLengthCm ?? 0;
        const hints = vesselHints ?? [];
        if (hints.length > 0) {
          if (!key) {
            return {
              content: [
                modelOnly(
                  "vesselHints에는 카드 note가 필요합니다. note를 그대로 넣어 다시 호출하세요.",
                ),
              ],
              structuredContent: {
                ...empty,
                message: "vesselHints에는 note가 필요합니다.",
              },
              isError: true as const,
            };
          }
          if (handInPhoto === false) {
            const rows = hints.map((hint) => {
              const name = hint.name.trim();
              const role = coerceMealPortionRole(hint.role);
              return {
              slot: 1,
              meal: "lunch",
              query: name,
              foodName: name,
              role,
              grams: 0,
              kcal: 0,
              carbG: 0,
              proteinG: 0,
              fatG: 0,
              basis: "그릇",
              kcalPerBasis: 0,
              matched: false,
              amountSource: "",
              needsConfirm: false,
              needsVesselHint: false,
              sharedPot: false,
              photoDiameterCm: 0,
              thicknessCm: 0,
              handMissing: true,
              needsHandRetry: true,
              handInPhoto: false,
            };
            });
            const names = rows.map((row) => row.query).filter(Boolean);
            return {
              content: [
                shown(
                  "사진에 손바닥이 보이지 않아 그릇 지름을 판별할 수 없습니다. 그릇 옆에 손바닥을 두고 다시 찍어 올려 주세요.",
                ),
                modelOnly(
                  `손바닥이 없어 지름 힌트를 쓰지 않았다. 사용자에게 재촬영을 안내하라. 지름·kcal를 추측하지 마라. 입력창에 글을 넣지 마라.${names.length > 0 ? ` 대상: ${names.join(", ")}.` : ""
                  }`,
                ),
              ],
              structuredContent: {
                ...empty,
                handMissing: true,
                needsHandRetry: true,
                handInPhoto: false,
                handWidthCm,
                palmComparison: (palmComparison ?? "")
                  .replace(/\s+/g, " ")
                  .trim(),
                foods: rows,
                message:
                  "사진에 손바닥이 보이지 않아 그릇 지름을 판별할 수 없습니다. 그릇 옆에 손바닥을 두고 다시 찍어 올려 주세요.",
              },
            };
          }
          const rows = hints.map((hint) => {
            const shared = hint.sharedPot === true;
            const name = hint.name.trim();
            const role = coerceMealPortionRole(hint.role);
            return {
              slot: 1,
              meal: "lunch",
              query: name,
              foodName: name,
              role,
              grams: 0,
              kcal: 0,
              carbG: 0,
              proteinG: 0,
              fatG: 0,
              basis: shared ? "줌" : "그릇",
              kcalPerBasis: 0,
              matched: false,
              amountSource: "",
              needsConfirm: false,
              needsVesselHint: true,
              sharedPot: shared,
              photoDiameterCm: shared
                ? 0
                : hint.containerDiameterCm ?? 0,
              thicknessCm: shared ? 0 : hint.thicknessCm ?? 0,
              handInPhoto: handInPhoto === true ? true : undefined,
            };
          });
          const sharedNames = rows
            .filter((row) => row.sharedPot)
            .map((row) => row.query);
          const bowlNames = rows
            .filter((row) => !row.sharedPot)
            .map((row) => row.query);
          return {
            content: [
              sharedNames.length > 0
                ? shown(
                  `${sharedNames.join(", ")}은(는) 냄비·팬처럼 같이 먹는 그릇으로 보여요. 먹은 양만 저장된 손 1줌(${profile?.handfulVolumeMl ?? "?"}ml) 기준으로 적어 주세요. 예: 1줌, 1.5줌.`,
                )
                : modelOnly(
                  "밥·국 개인 그릇 힌트를 카드에 전달했다. 끼니 kcal는 사용자가 분량을 확인한 뒤다.",
                ),
              modelOnly(
                [
                  bowlNames.length > 0
                    ? `개인 그릇(${bowlNames.join(", ")}): 사진 손바닥과 저장된 폭 ${handWidthCm}cm·길이 ${handLengthCm}cm로 지름·높이를 카드에 반영했다.`
                    : "",
                  sharedNames.length > 0
                    ? `공유 냄비·팬(${sharedNames.join(", ")}): 사용자에게 줌으로 적으라고 카드·채팅에 안내했다. 그릇 부피로 계산하지 마라.`
                    : "",
                  "입력창에 글을 넣지 마라.",
                ]
                  .filter(Boolean)
                  .join(" "),
              ),
            ],
            structuredContent: {
              ...empty,
              needsVesselHints: true,
              handWidthCm,
              palmComparison: (palmComparison ?? "").replace(/\s+/g, " ").trim(),
              foods: rows,
              message:
                sharedNames.length > 0
                  ? `${sharedNames.join(", ")} — 냄비·팬이면 줌으로 적어 주세요.`
                  : "사진 기준 그릇 크기를 카드에 반영했습니다.",
            },
          };
        }
        const listed = foods ?? [];
        if (listed.length === 0) {
          return {
            content: [
              modelOnly(
                "foods 또는 vesselHints를 넣어 lookup-meal-portions를 호출하세요. peek/pending은 없습니다. 입력창에 글을 넣지 마세요.",
              ),
            ],
            structuredContent: {
              ...empty,
              waiting: false,
              handWidthCm,
              message: "분량 계산을 위해 foods 또는 vesselHints가 필요합니다.",
            },
          };
        }

        const savedVolume = profile?.handfulVolumeMl ?? 0;
        const requests: PortionRequest[] = listed.map((food) => {
          const requestedVolume = food.handfulVolumeMl ?? 0;
          return {
            slot: food.slot,
            meal: food.meal,
            name: food.name,
            role: food.role,
            cuisine: food.cuisine,
            grams: food.grams,
            coverage: food.coverage,
            thicknessCm: food.thicknessCm,
            densityGPerMl: food.densityGPerMl,
            containerDiameterCm: food.containerDiameterCm,
            curvature: food.curvature,
            fillRatio: food.fillRatio,
            servings: food.servings,
            handfuls: food.handfuls,
            handfulVolumeMl:
              requestedVolume > 0
                ? requestedVolume
                : savedVolume > 0
                  ? savedVolume
                  : undefined,
            pieceCount: food.pieceCount,
            amountNote: food.amountNote,
            nameConfirmed: food.nameConfirmed,
            candidateName: food.candidateName,
            matchedFoodName: food.matchedFoodName,
            alsoSearch: food.alsoSearch,
            candidatePicks: food.candidatePicks,
            noneOfCandidates: food.noneOfCandidates,
            servingGrams: food.servingGrams,
            servingKcal: food.servingKcal,
            kcalPer100g: food.kcalPer100g,
            carbPer100g: food.carbPer100g,
            proteinPer100g: food.proteinPer100g,
            fatPer100g: food.fatPer100g,
            kcalPerUnit: food.kcalPerUnit,
            carbPerUnit: food.carbPerUnit,
            proteinPerUnit: food.proteinPerUnit,
            fatPerUnit: food.fatPerUnit,
          };
        });
        if (requests.some((food) => portionNeedsSavedHand(food)) && !profile) {
          return {
            content: [
              shown(
                "손 길이·폭·1줌이 없어 사진·줌·그릇은 계산하지 않았습니다.",
              ),
              modelOnly(
                "손 길이·폭·1줌이 저장되어 있지 않습니다. 사진·줌·그릇 열량은 말하지 말고 손 치수를 먼저 저장하세요. 글만(기준 분량)과 간식 낱개(줌 없이 기준 g가 있을 때)는 손 없이 계산할 수 있습니다.",
              ),
            ],
            structuredContent: {
              ...empty,
              message: "사진·줌·그릇은 손 길이·폭·1줌이 필요합니다.",
            },
            isError: true as const,
          };
        }
        const vesselNeedsPalm = requests.some(
          (food) =>
            portionNeedsSavedHand(food) &&
            (food.containerDiameterCm ?? 0) > 0 &&
            food.cuisine !== "text" &&
            food.cuisine !== "snack" &&
            food.role !== "snack",
        );
        if (vesselNeedsPalm && handInPhoto === false) {
          return {
            content: [
              shown("사진에 손바닥이 없어 그릇 양을 계산하지 않았습니다."),
              modelOnly(
                `저장된 손 길이 ${profile?.handLengthCm ?? 0}cm, 폭 ${handWidthCm}cm, 1줌 ${savedVolume}ml. 그릇 옆에 손바닥이 보이게 다시 찍어 달라고 하세요. 글만 기록은 cuisine=text로 손 없이 계산할 수 있습니다.`,
              ),
            ],
            structuredContent: {
              ...empty,
              handWidthCm,
              message: "그릇 분량은 사진 속 손바닥이 있어야 합니다.",
            },
            isError: true as const,
          };
        }

        const db = await getDb();
        for (const request of requests) {
          const noted = parseAmountNote(request.amountNote);
          if (!(request.handfuls && request.handfuls > 0) && noted.handfuls > 0) {
            request.handfuls = noted.handfuls;
          }
          if (!(request.pieceCount && request.pieceCount > 0) && noted.count > 0 && noted.handfuls <= 0) {
            request.pieceCount = noted.count;
          }
          const cuisine = request.cuisine ?? "korean";
          const usesHandful = (request.handfuls ?? 0) > 0;
          const textOnly = cuisine === "text";
          const counted =
            !usesHandful && ((request.pieceCount ?? 0) > 0 || noted.count > 0);
          const hasAmount =
            (request.servingGrams ?? 0) > 0 || (request.grams ?? 0) > 0;
          if ((counted || textOnly) && !hasAmount) {
            const [probe] = await lookupFoods(db, [
              {
                foodName: request.name,
                grams: 0,
                exact: true,
                nameMatch: "exact",
              },
            ]);
            const serving = Number.parseFloat(probe?.servingWeight ?? "");
            if (Number.isFinite(serving) && serving > 0) {
              request.servingGrams = serving;
            }
          }
        }

        const nameRows = await lookupFoods(
          db,
          requests.map((request) => ({
            foodName:
              request.matchedFoodName?.trim() || request.name,
            grams: 0,
            exact: true,
            nameMatch: "exact" as const,
          })),
        );
        const pendingConfirm = (
          await Promise.all(
            requests.map(async (request, index) => {
              const macroSum =
                (request.carbPerUnit ?? 0) +
                (request.proteinPerUnit ?? 0) +
                (request.fatPerUnit ?? 0);
              const pickedDb =
                request.nameConfirmed === true &&
                (request.matchedFoodName?.trim() ?? "").length > 0;
              const bowl = isVesselBowlRequest(request);
              const confirmedNutrition =
                request.nameConfirmed === true &&
                (bowl
                  ? bowlPer100Ready(request)
                  : (request.kcalPerUnit ?? 0) > 0 && macroSum > 0);
              if (nameRows[index]?.matched || pickedDb || confirmedNutrition) {
                return null;
              }
              const noted = parseAmountNote(request.amountNote);
              // Rice/soup: kcal per 100 g, then bowl volume × density → g. Not per 1공기.
              const unit = bowl
                ? "100g"
                : noted.handfuls > 0
                  ? "줌"
                  : noted.unit || "개";
              const skipPick = request.noneOfCandidates === true;
              const aliases = (request.alsoSearch ?? [])
                .map((item) => item.trim())
                .filter(Boolean);
              let candidates = skipPick
                ? []
                : await searchFoodCandidatesMany(db, [
                  request.name,
                  ...aliases,
                ]);
              const picks = (request.candidatePicks ?? [])
                .map((item) => item.trim())
                .filter(Boolean);
              if (!skipPick && picks.length > 0) {
                const byName = new Map(
                  candidates.map((food) => [food.foodName, food]),
                );
                const ordered = [];
                for (const name of picks) {
                  const hit =
                    byName.get(name) ?? (await findExactFood(db, name));
                  if (hit) ordered.push(hit);
                }
                for (const food of candidates) {
                  if (!ordered.some((item) => item.foodName === food.foodName)) {
                    ordered.push(food);
                  }
                }
                candidates = ordered.slice(0, 8);
              } else if (!skipPick) {
                candidates = candidates.slice(0, 8);
              }
              if (!skipPick && candidates.length > 0) {
                return {
                  kind: "pick" as const,
                  query: request.name,
                  foodName: request.name,
                  unit,
                  per100g: bowl,
                  candidates: candidates.map((food) => ({
                    foodName: food.foodName,
                    kcal: food.kcal ?? 0,
                    servingWeight: food.servingWeight ?? "",
                  })),
                };
              }
              const proposal = await proposeMissingFood(db, {
                name: request.name,
                unit,
                handfulVolumeMl: request.handfulVolumeMl,
                density: request.densityGPerMl,
                kcalPerUnit: bowl ? request.kcalPer100g : request.kcalPerUnit,
                candidateName: request.candidateName,
                matchedFoodName: request.matchedFoodName,
                servingGrams: bowl ? 100 : request.servingGrams,
                carbPerUnit: bowl ? request.carbPer100g : request.carbPerUnit,
                proteinPerUnit: bowl
                  ? request.proteinPer100g
                  : request.proteinPerUnit,
                fatPerUnit: bowl ? request.fatPer100g : request.fatPerUnit,
              });
              return {
                kind: "nutrition" as const,
                query: request.name,
                foodName: proposal.candidateName,
                grams: 0,
                unit,
                per100g: bowl,
                kcalPerUnit: proposal.kcalPerUnit,
                carbPerUnit: proposal.carbPerUnit,
                proteinPerUnit: proposal.proteinPerUnit,
                fatPerUnit: proposal.fatPerUnit,
                servingGrams: proposal.gramsPerUnit,
                webMiss: proposal.webMiss,
              };
            }),
          )
        ).filter((item) => item !== null);
        if (pendingConfirm.length > 0) {
          const names = pendingConfirm.map((item) => item.query).join(", ");
          const picking = pendingConfirm.some((item) => item.kind === "pick");
          const prompts = pendingConfirm.map((item) => {
            if (item.kind === "pick") {
              return {
                slot: 1,
                meal: "lunch",
                query: item.query,
                foodName: item.foodName,
                role: "side" as const,
                grams: 0,
                kcal: 0,
                carbG: 0,
                proteinG: 0,
                fatG: 0,
                basis: item.per100g
                  ? "100g"
                  : item.unit
                    ? `1${item.unit}`
                    : "1단위",
                kcalPerBasis: 0,
                matched: false,
                amountSource: "",
                needsConfirm: true,
                needsCandidatePick: true,
                candidates: item.candidates,
                webMiss: false,
                kcalPerUnit: 0,
                carbPerUnit: 0,
                proteinPerUnit: 0,
                fatPerUnit: 0,
                unit: item.unit,
                per100g: item.per100g,
                servingGrams: 0,
              };
            }
            return {
              slot: 1,
              meal: "lunch",
              query: item.query,
              foodName: item.foodName,
              role: "side" as const,
              grams: 0,
              kcal: 0,
              carbG: 0,
              proteinG: 0,
              fatG: 0,
              basis: item.per100g
                ? "100g"
                : item.unit
                  ? `1${item.unit}`
                  : "1단위",
              kcalPerBasis: item.kcalPerUnit,
              matched: false,
              amountSource: "",
              needsConfirm: true,
              needsCandidatePick: false,
              candidates: [] as {
                foodName: string;
                kcal: number;
                servingWeight: string;
              }[],
              webMiss: item.webMiss,
              kcalPerUnit: item.kcalPerUnit,
              carbPerUnit: item.carbPerUnit,
              proteinPerUnit: item.proteinPerUnit,
              fatPerUnit: item.fatPerUnit,
              unit: item.unit,
              per100g: item.per100g,
              servingGrams: item.servingGrams,
            };
          });
          return {
            content: [
              modelOnly(
                picking
                  ? `${names}은 식품 DB에 같은 이름이 없습니다. 후보가 카드에 있습니다. 동의어가 있으면 alsoSearch·candidatePicks(사진 비슷한 순)로 같은 note·accountKey lookup-meal-portions를 다시 호출하세요. 사용자가 고르기 전에는 matchedFoodName·nameConfirmed를 넣지 마세요. 사용자에게 이름 변경·바코드를 묻지 마세요. 입력창에 글을 넣지 마세요.`
                  : `${names}은 식품 DB에 같은 이름이 없습니다. 사용자에게 이름 변경·일부만 저장·바코드를 묻지 마세요. 일반 지식으로라도 그 단위 1개당 kcal·탄수화물g·단백질g·지방g를 kcalPerUnit·carbPerUnit·proteinPerUnit·fatPerUnit에 넣어 같은 note·accountKey로 lookup-meal-portions를 지금 다시 호출하세요. 탄단지가 0이면 홈·기간 차트에 안 잡힙니다. 줌은 저장된 손 1줌이라 단위를 바꾸지 마세요. 밥·국(그릇)은 1공기 단위가 아니라 100g당 kcalPer100g·carbPer100g·proteinPer100g·fatPer100g로 넣으세요. 웹은 하지 말고 꼭이면 "{음식명} {단위} 열량"만. nameConfirmed는 넣지 마세요. 입력창에 글을 넣지 마세요.`,
              ),
            ],
            structuredContent: {
              ...empty,
              needsWebConfirm: true,
              needsCandidatePick: picking,
              handWidthCm,
              foods: prompts,
              message: picking
                ? `${names} — DB 후보 중 맞는 것을 고르거나 ‘목록에 없음’을 눌러 주세요.`
                : `${names}은 식품 DB에 같은 이름이 없습니다. 1단위 열량·탄단지가 카드에 표시되면 확인해 주세요.`,
            },
          };
        }

        const resolved: { request: PortionRequest; grams: number; amountSource: string }[] =
          [];
        for (const request of requests) {
          const portion = resolvePortionGrams(request);
          if (!portion.ok) {
            return {
              content: [modelOnly(portion.message)],
              structuredContent: {
                ...empty,
                handWidthCm,
                message: portion.message,
              },
              isError: true as const,
            };
          }
          resolved.push({
            request,
            grams: portion.grams,
            amountSource: portion.amountSource,
          });
        }

        const found = await lookupFoods(
          db,
          resolved.map((item) => ({
            foodName:
              item.request.matchedFoodName?.trim() || item.request.name,
            grams: item.grams,
            exact: true,
            nameMatch: "exact" as const,
          })),
        );
        // Misses were already gated above; re-check only for safety.
        const unconfirmed = found.flatMap((item, index) => {
          const request = resolved[index]?.request;
          const macroSum =
            (request?.carbPerUnit ?? 0) +
            (request?.proteinPerUnit ?? 0) +
            (request?.fatPerUnit ?? 0);
          const pickedDb =
            request?.nameConfirmed === true &&
            (request.matchedFoodName?.trim() ?? "").length > 0;
          const bowl = request ? isVesselBowlRequest(request) : false;
          const confirmed =
            request?.nameConfirmed === true &&
            (bowl
              ? bowlPer100Ready(request!)
              : (request.kcalPerUnit ?? 0) > 0 && macroSum > 0);
          if (item.matched || pickedDb || confirmed) return [];
          const noted = parseAmountNote(request?.amountNote);
          return [
            {
              query: request?.name || item.query,
              foodName: request?.candidateName?.trim() || request?.name || item.query,
              unit: bowl ? "100g" : noted.handfuls > 0 ? "줌" : noted.unit || "개",
              per100g: bowl,
              kcalPerUnit: bowl
                ? (request?.kcalPer100g ?? 0)
                : (request?.kcalPerUnit ?? 0),
              carbPerUnit: bowl
                ? (request?.carbPer100g ?? 0)
                : (request?.carbPerUnit ?? 0),
              proteinPerUnit: bowl
                ? (request?.proteinPer100g ?? 0)
                : (request?.proteinPerUnit ?? 0),
              fatPerUnit: bowl
                ? (request?.fatPer100g ?? 0)
                : (request?.fatPerUnit ?? 0),
              servingGrams: bowl ? 100 : (request?.servingGrams ?? 0),
            },
          ];
        });
        if (unconfirmed.length > 0) {
          const names = unconfirmed.map((item) => item.query).join(", ");
          const prompts = unconfirmed.map((item) => ({
            slot: 1,
            meal: "lunch",
            query: item.query,
            foodName: item.foodName,
            role: "side" as const,
            grams: 0,
            kcal: 0,
            carbG: 0,
            proteinG: 0,
            fatG: 0,
            basis: item.per100g
              ? "100g"
              : item.unit
                ? `1${item.unit}`
                : "1단위",
            kcalPerBasis: item.kcalPerUnit,
            matched: false,
            amountSource: "",
            needsConfirm: true,
            needsCandidatePick: false,
            candidates: [] as {
              foodName: string;
              kcal: number;
              servingWeight: string;
            }[],
            webMiss: !(
              item.kcalPerUnit > 0 &&
              item.carbPerUnit + item.proteinPerUnit + item.fatPerUnit > 0
            ),
            kcalPerUnit: item.kcalPerUnit,
            carbPerUnit: item.carbPerUnit,
            proteinPerUnit: item.proteinPerUnit,
            fatPerUnit: item.fatPerUnit,
            unit: item.unit,
            per100g: item.per100g,
            servingGrams: item.servingGrams,
          }));
          return {
            content: [
              modelOnly(
                `${names}은 식품 DB에 같은 이름이 없습니다. 사용자에게 이름 변경·일부만 저장·바코드를 묻지 마세요. 일반 지식으로라도 그 단위 1개당 kcal·탄수화물g·단백질g·지방g를 kcalPerUnit·carbPerUnit·proteinPerUnit·fatPerUnit에 넣어 같은 note·accountKey로 lookup-meal-portions를 지금 다시 호출하세요. 탄단지가 0이면 홈·기간 차트에 안 잡힙니다. 줌은 저장된 손 1줌이라 단위를 바꾸지 마세요. 밥·국(그릇)은 1공기 단위가 아니라 100g당 kcalPer100g·carbPer100g·proteinPer100g·fatPer100g로 넣으세요. 웹은 하지 말고 꼭이면 "{음식명} {단위} 열량"만. nameConfirmed는 넣지 마세요. 입력창에 글을 넣지 마세요.`,
              ),
            ],
            structuredContent: {
              ...empty,
              needsWebConfirm: true,
              handWidthCm,
              foods: prompts,
              message: `${names}은 식품 DB에 같은 이름이 없습니다. 1단위 열량·탄단지가 카드에 표시되면 확인해 주세요.`,
            },
          };
        }
        const stored = found.map((item, index) => {
          const request = resolved[index]?.request;
          const volumeGrams = resolved[index]?.grams ?? item.grams;
          const energy = finalizePortionEnergy({
            cuisine: request?.cuisine,
            role: request?.role ?? "main",
            volumeGrams,
            servingKcal: request?.servingKcal,
            kcalPer100g: request?.kcalPer100g,
            carbPer100g: request?.carbPer100g,
            proteinPer100g: request?.proteinPer100g,
            fatPer100g: request?.fatPer100g,
            kcalPerUnit: request?.kcalPerUnit,
            carbPerUnit: request?.carbPerUnit,
            proteinPerUnit: request?.proteinPerUnit,
            fatPerUnit: request?.fatPerUnit,
            unitCount: (() => {
              const noted = parseAmountNote(request?.amountNote);
              if ((request?.handfuls ?? 0) > 0 || noted.handfuls > 0) {
                return (request?.handfuls ?? 0) > 0
                  ? request?.handfuls
                  : noted.handfuls;
              }
              return (request?.pieceCount ?? 0) > 0
                ? request?.pieceCount
                : noted.count;
            })(),
            unitLabel: parseAmountNote(request?.amountNote).label,
            lookup: {
              matched: item.matched,
              grams: item.grams,
              kcal: item.kcal,
              carbG: item.carbG,
              proteinG: item.proteinG,
              fatG: item.fatG,
              basis: item.basis,
              kcalPerBasis: item.kcalPerBasis,
              servingWeight: item.servingWeight,
            },
          });
          return {
            slot: request?.slot ?? 1,
            meal: request?.meal ?? "lunch",
            query: request?.name ?? item.query,
            foodName:
              item.matched
                ? item.foodName
                : request?.candidateName?.trim() ||
                request?.matchedFoodName?.trim() ||
                item.foodName,
            role: request?.role ?? "main",
            grams: energy.grams,
            kcal: energy.kcal,
            carbG: energy.carbG,
            proteinG: energy.proteinG,
            fatG: energy.fatG,
            basis: item.basis,
            kcalPerBasis: item.kcalPerBasis,
            matched: item.matched,
            amountSource:
              energy.amountSource ?? resolved[index]?.amountSource ?? "",
          };
        });
        const comparison = (palmComparison ?? "").replace(/\s+/g, " ").trim();
        const kcal = stored.reduce((sum, item) => sum + item.kcal, 0);
        const lines = stored
          .map(
            (item) =>
              `${item.foodName} ${item.grams}g ${item.kcal}kcal (${item.amountSource}, ${item.basis}당 ${item.kcalPerBasis}kcal)`,
          )
          .join("; ");
        return {
          content: [
            shown(
              `그릇·줌·기준 분량으로 ${stored.length}개 · ${Math.round(kcal)}kcal. 출처: ${nutrientSource.ko}`,
            ),
            modelOnly(
              `${comparison || `손바닥 폭 ${handWidthCm}cm`}. ${lines}. 사용자가 저장을 누르기 전에는 record-meal-photos를 호출하지 마세요.`,
            ),
          ],
          structuredContent: {
            ok: true,
            waiting: false,
            note: key,
            handWidthCm,
            palmComparison: comparison,
            foods: stored,
            kcal: Math.round(kcal),
            carbG:
              Math.round(
                stored.reduce((sum, item) => sum + item.carbG, 0) * 10,
              ) / 10,
            proteinG:
              Math.round(
                stored.reduce((sum, item) => sum + item.proteinG, 0) * 10,
              ) / 10,
            fatG:
              Math.round(
                stored.reduce((sum, item) => sum + item.fatG, 0) * 10,
              ) / 10,
            message: lines,
          },
        };
      },
    )
    .registerTool(
      {
        name: "record-meal-photos",
        description:
          "식사 카드에서 그릇·줌·기준 분량으로 열량을 확인한 뒤 사용자가 저장을 눌렀을 때만 호출한다. 각 entry.foods의 grams는 lookup-meal-portions가 확정한 값이다. 1회 섭취참고량으로 양을 채우지 않는다. 사진은 저장하지 않는다. 호스트 LLM이 직접 호출하지 않는다. 호스트 입력창에 글을 넣지 않는다.",
        inputSchema: {
          meal: z
            .enum(mealSlots)
            .optional()
            .describe("entry.meal이 없을 때 쓰는 기본 끼니."),
          date: z.string().describe("YYYY-MM-DD"),
          keepRatio: z
            .number()
            .min(0.4)
            .max(1)
            .optional()
            .describe(
              "덜어내기 비율. 1은 그대로, 0.4는 40%만 남김. C자형 슬라이더 값.",
            ),
          entries: z
            .array(
              z.object({
                meal: z
                  .enum(mealSlots)
                  .optional()
                  .describe("그 사진의 끼니. 없으면 상위 meal."),
                note: z
                  .string()
                  .min(1)
                  .describe(
                    "그 사진의 식사 구성. 예: 공기밥, 된장국, 김치. 쉼표·줄바꿈으로 여러 개.",
                  ),
                photo: FileRef.optional().describe(
                  "그 사진 파일. 있으면 R2에 함께 저장한다.",
                ),
                imageJpeg: z
                  .string()
                  .optional()
                  .describe(
                    "카드에서 고른 사진의 jpeg base64. 길면 식단 저장은 하고 사진만 건너뛴다.",
                  ),
                foods: z
                  .array(
                    z.object({
                      foodName: z.string().min(1),
                      grams: z
                        .number()
                        .positive()
                        .describe(
                          "lookup-meal-portions가 확정한 섭취량(g). 그릇·줌·기준 분량.",
                        ),
                      kcal: z
                        .number()
                        .nonnegative()
                        .optional()
                        .describe(
                          "카드에서 확인한 kcal. 있으면 이 이름·칼로리로 저장하고, DB의 다른 음식(김→김밥, 김치→김치전)으로 바꾸지 않는다.",
                        ),
                      carbG: z.number().nonnegative().optional(),
                      proteinG: z.number().nonnegative().optional(),
                      fatG: z.number().nonnegative().optional(),
                    }),
                  )
                  .min(1)
                  .describe(
                    "lookup-meal-portions가 확정한 음식과 그램. 이 그램으로 DB 열량을 환산한다.",
                  ),
              }),
            )
            .min(1)
            .describe("사진마다 끼니·구성. 한 번에 모두 저장한다."),
          ...accountKeyField(),
        },
        annotations: {
          title: "Record all meal photos",
          readOnlyHint: false,
          destructiveHint: false,
        },
        _meta: {
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Recording all meal photos…",
          "openai/toolInvocation/invoked": "All meal photos recorded.",
        },
      },
      async ({ meal, date, entries, accountKey, keepRatio }, extra) => {
        const day = date.length > 0 ? date : seoulToday();
        const fallbackMeal = meal ?? "lunch";
        const keep =
          typeof keepRatio === "number" && keepRatio > 0 && keepRatio < 1
            ? keepRatio
            : 1;
        const userId = await accountId(extra, accountKey);
        const db = await getDb();
        const createdAt = new Date().toISOString();
        const saved: {
          meal: (typeof mealSlots)[number];
          note: string;
          foods: ReturnType<typeof normalizeFood>[];
        }[] = [];
        const byMealMap = new Map<
          (typeof mealSlots)[number],
          { foodCount: number; kcal: number }
        >();
        let totalKcal = 0;
        let totalCarb = 0;
        let totalProtein = 0;
        let totalFat = 0;
        let foodCount = 0;

        for (const entry of entries) {
          const slot = entry.meal ?? fallbackMeal;
          const namedFoods = entry.foods ?? [];
          if (namedFoods.length === 0) continue;
          const found = await lookupFoods(
            db,
            namedFoods.map((food) => ({
              foodName: food.foodName,
              grams: food.grams,
              exact: true,
              nameMatch: "exact" as const,
            })),
          );
          const items = namedFoods.map((food, index) => {
            const row = found[index];
            const grams = Math.max(1, Math.round(food.grams * keep));
            const confirmed = typeof food.kcal === "number";
            const sameName =
              row?.matched === true && row.foodName === food.foodName;
            if (confirmed || !sameName) {
              return normalizeFood({
                foodName: food.foodName,
                grams,
                kcal: Math.round((food.kcal ?? 0) * keep),
                carbG: Math.round((food.carbG ?? 0) * keep * 10) / 10,
                proteinG: Math.round((food.proteinG ?? 0) * keep * 10) / 10,
                fatG: Math.round((food.fatG ?? 0) * keep * 10) / 10,
              });
            }
            return normalizeFood({
              foodName: row?.foodName ?? food.foodName,
              grams,
              kcal: Math.round((row?.kcal ?? 0) * keep),
              carbG: Math.round((row?.carbG ?? 0) * keep * 10) / 10,
              proteinG: Math.round((row?.proteinG ?? 0) * keep * 10) / 10,
              fatG: Math.round((row?.fatG ?? 0) * keep * 10) / 10,
            });
          });
          let entryKcal = 0;
          for (const item of items) {
            await db.insert(mealLogs).values({
              date: day,
              meal: slot,
              foodName: item.foodName,
              grams: item.grams,
              kcal: item.kcal,
              carbG: item.carbG,
              proteinG: item.proteinG,
              fatG: item.fatG,
              photoKey: null,
              userId,
              createdAt,
            });
            totalKcal += item.kcal;
            totalCarb += item.carbG;
            totalProtein += item.proteinG;
            totalFat += item.fatG;
            entryKcal += item.kcal;
            foodCount += 1;
          }
          const bucket = byMealMap.get(slot) ?? { foodCount: 0, kcal: 0 };
          bucket.foodCount += items.length;
          bucket.kcal += entryKcal;
          byMealMap.set(slot, bucket);
          saved.push({ meal: slot, note: entry.note, foods: items });
        }

        if (foodCount === 0) {
          return {
            content: [
              shown("확정된 분량이 없어 저장하지 못했습니다."),
              modelOnly(
                "record-meal-photos에 foods 그램이 없습니다. lookup-meal-portions로 그릇·줌·기준 분량을 먼저 계산하세요. 1회 섭취참고량으로 저장하지 마세요.",
              ),
            ],
            structuredContent: {
              ok: false,
              date: day,
              meal: fallbackMeal,
              foodCount: 0,
              kcal: 0,
              carbG: 0,
              proteinG: 0,
              fatG: 0,
              foods: [],
              byMeal: [],
              entries: [],
            },
            isError: true as const,
          };
        }

        const byMeal = [...byMealMap.entries()].map(([slot, row]) => ({
          meal: slot,
          foodCount: row.foodCount,
          kcal: Math.round(row.kcal),
        }));
        const mealSummary = byMeal
          .map((row) => `${row.meal} ${row.foodCount}개·${row.kcal}kcal`)
          .join(", ");

        return {
          content: [
            shown(
              `${day} 음식 ${foodCount}개 · ${Math.round(totalKcal)}kcal · 탄 ${Math.round(totalCarb)}g · 단 ${Math.round(totalProtein)}g · 지 ${Math.round(totalFat)}g (${mealSummary}). 그릇·줌·기준 분량으로 저장. 사진은 저장하지 않는다.`,
            ),
            modelOnly(
              `record-meal-photos 완료. 다음으로 get-daily-summary-chart 또는 show-diet-chart를 제안하세요. 홈화면 안내는 붙이지 마세요.`,
            ),
          ],
          structuredContent: {
            ok: true,
            date: day,
            meal: fallbackMeal,
            foodCount,
            kcal: Math.round(totalKcal),
            carbG: Math.round(totalCarb * 10) / 10,
            proteinG: Math.round(totalProtein * 10) / 10,
            fatG: Math.round(totalFat * 10) / 10,
            foods: saved.flatMap((entry) =>
              entry.foods.map((food) => ({
                meal: entry.meal,
                foodName: food.foodName,
                grams: food.grams,
                kcal: food.kcal,
                carbG: food.carbG,
                proteinG: food.proteinG,
                fatG: food.fatG,
              })),
            ),
            byMeal,
            entries: saved,
            source: nutrientSource,
          },
        };
      },
    )
    .registerTool(
      {
        name: "get-diet-period",
        description:
          "시작일과 종료일 사이에 저장된 음식을 한 줄씩 표로 보여 준다. 사용자가 기록을 고치거나 지우려 할 때 먼저 호출한다. 각 줄에 id와 15분짜리 etag가 붙고, 카드에서 중량을 고치거나 한 줄을 지울 수 있다. update-meal-log와 delete-meal-log는 이 etag 없이는 동작하지 않는다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다.",
        inputSchema: {
          startDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 6일 전."),
          endDate: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘."),
          ...accountKeyField(),
        },
        annotations: {
          title: "Diet period chart",
          readOnlyHint: true,
          destructiveHint: false,
        },
        _meta: {
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Loading the diet period…",
          "openai/toolInvocation/invoked": "Diet period ready.",
        },
        view: { component: "diet-period" },
      },
      async ({ startDate, endDate, accountKey }, extra) => {
        const today = seoulToday();
        const rawStart =
          startDate && startDate.length > 0 ? startDate : addDays(today, -6);
        const rawEnd = endDate && endDate.length > 0 ? endDate : today;
        const start = rawStart <= rawEnd ? rawStart : rawEnd;
        const end = rawStart <= rawEnd ? rawEnd : rawStart;
        const userId = await accountId(extra, accountKey);
        const [rows, secret] = await Promise.all([
          listMealLogs(userId, start, end),
          getEtagSecret(userId),
        ]);
        const byDate = new Map<
          string,
          { kcal: number; carbG: number; proteinG: number; fatG: number }
        >();
        for (const row of rows) {
          const day = byDate.get(row.date) ?? {
            kcal: 0,
            carbG: 0,
            proteinG: 0,
            fatG: 0,
          };
          day.kcal += row.kcal;
          day.carbG += row.carbG;
          day.proteinG += row.proteinG;
          day.fatG += row.fatG;
          byDate.set(row.date, day);
        }
        const days = [...byDate.entries()].map(([date, totals]) => ({
          date,
          kcal: Math.round(totals.kcal),
          carbG: Math.round(totals.carbG),
          proteinG: Math.round(totals.proteinG),
          fatG: Math.round(totals.fatG),
        }));
        const issuedAt = Date.now();
        const foods = await Promise.all(
          rows.map(async (row) => ({
            id: row.id,
            etag: await issueEtag(
              secret,
              "meal_log",
              row.id,
              row.updatedAt ?? row.createdAt,
              issuedAt,
            ),
            date: row.date,
            meal: row.meal,
            foodName: row.foodName,
            grams: Math.round(row.grams),
            kcal: Math.round(row.kcal),
            carbG: Math.round(row.carbG),
            proteinG: Math.round(row.proteinG),
            fatG: Math.round(row.fatG),
          })),
        );
        return {
          content: [
            shown(
              foods.length > 0
                ? `${start}~${end}: ${days.length}일, ${foods.length}개 음식. 출처: ${nutrientSource.ko}`
                : `${start}~${end}: 저장된 음식이 없습니다.`,
            ),
            modelOnly(
              "각 음식의 id와 etag는 15분 동안만 update-meal-log·delete-meal-log에 쓸 수 있습니다. 사용자가 고치거나 지우자고 한 기록 하나만 다룹니다.",
            ),
          ],
          structuredContent: {
            startDate: start,
            endDate: end,
            days,
            foods,
            source: foods.length > 0 ? nutrientSource : null,
            accountKey: guestKey(userId),
          },
        };
      },
    )
    .registerTool(
      {
        name: "update-meal-log",
        description:
          "저장된 음식 기록 한 줄의 중량(g)을 고친다. 칼로리와 탄단지는 서버가 중량 비율로 다시 계산한다. get-diet-period가 최근 15분 안에 그 줄에 발급한 etag가 있어야 한다. etag가 없거나 오래됐거나 그 사이 기록이 바뀌었으면 precondition_failed로 거절한다. 한 번에 한 줄만 고친다.",
        inputSchema: {
          id: z.number().int().describe("get-diet-period가 돌려준 음식 기록 id"),
          etag: etagField,
          grams: z.number().positive().describe("고친 섭취 중량(g)"),
          ...accountKeyField(),
        },
        annotations: {
          title: "Update one meal log",
          readOnlyHint: false,
          destructiveHint: true,
        },
        _meta: {
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Updating the meal log…",
          "openai/toolInvocation/invoked": "Meal log updated.",
        },
      },
      async ({ id, etag, grams, accountKey }, extra) => {
        const userId = await accountId(extra, accountKey);
        const row = await getMealLog(userId, id);
        if (!row) return preconditionFailed("not_found");
        const secret = await getEtagSecret(userId);
        const check = await checkEtag(
          secret,
          "meal_log",
          id,
          row.updatedAt ?? row.createdAt,
          etag,
        );
        if (check !== "ok") return preconditionFailed(check);
        const updated = await updateMealLogGrams(userId, id, grams);
        if (!updated) return preconditionFailed("not_found");
        const message = `${updated.date} ${updated.foodName}을(를) ${Math.round(updated.grams)}g, ${Math.round(updated.kcal)}kcal로 고쳤습니다.`;
        return {
          content: message,
          structuredContent: {
            ok: true,
            error: "",
            reason: "",
            message,
            food: {
              id,
              etag: await issueEtag(secret, "meal_log", id, updated.updatedAt),
              date: updated.date,
              meal: updated.meal,
              foodName: updated.foodName,
              grams: Math.round(updated.grams),
              kcal: Math.round(updated.kcal),
              carbG: Math.round(updated.carbG),
              proteinG: Math.round(updated.proteinG),
              fatG: Math.round(updated.fatG),
            },
          },
        };
      },
    )
    .registerTool(
      {
        name: "delete-meal-log",
        description:
          "저장된 음식 기록 한 줄을 지운다. 사용자가 그 기록을 지우자고 했을 때만 호출한다. get-diet-period가 최근 15분 안에 그 줄에 발급한 etag가 있어야 하고, 아니면 precondition_failed로 거절한다. 한 번에 한 줄만 지운다. 하루치나 기간 전체를 지우는 도구는 없다.",
        inputSchema: {
          id: z.number().int().describe("get-diet-period가 돌려준 음식 기록 id"),
          etag: etagField,
          ...accountKeyField(),
        },
        annotations: {
          title: "Delete one meal log",
          readOnlyHint: false,
          destructiveHint: true,
        },
        _meta: {
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Deleting the meal log…",
          "openai/toolInvocation/invoked": "Meal log deleted.",
        },
      },
      async ({ id, etag, accountKey }, extra) => {
        const userId = await accountId(extra, accountKey);
        const row = await getMealLog(userId, id);
        if (!row) return preconditionFailed("not_found");
        const check = await checkEtag(
          await getEtagSecret(userId),
          "meal_log",
          id,
          row.updatedAt ?? row.createdAt,
          etag,
        );
        if (check !== "ok") return preconditionFailed(check);
        await deleteMealLog(userId, id);
        const message = `${row.date} ${row.foodName} 기록을 지웠습니다.`;
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
        name: "scan-food-barcode",
        description:
          "포장 식품의 바코드를 찍는 카드를 연다. 사용자가 바코드·포장지로 기록하겠다고 할 때 호출한다. 카드가 카메라나 바코드 사진으로 숫자를 읽고, lookup-barcode로 제품 영양 성분을 찾아 섭취량을 고친 뒤 저장한다. 바코드 숫자를 사진에서 직접 읽어 넣지 않는다. accountKey가 없으면 open-home으로 키만 확보한 뒤 이 도구를 직접 호출한다.",
        inputSchema: {
          meal: z
            .enum(mealSlots)
            .optional()
            .describe("breakfast, lunch, dinner, or snack. 생략하면 간식."),
          date: z.string().optional().describe("YYYY-MM-DD. 생략하면 오늘(서울)."),
          ...accountKeyField(),
        },
        annotations: {
          title: "Scan a food barcode",
          readOnlyHint: true,
          destructiveHint: false,
        },
        _meta: {
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Opening the barcode scanner…",
          "openai/toolInvocation/invoked": "Barcode scanner ready.",
        },
        view: {
          component: "scan-food-barcode",
          description: "Scan a packaged food barcode and log it",
        },
      },
      async ({ meal, date, accountKey }, extra) => ({
        content: [
          modelOnly(
            "바코드 카드를 열었습니다. 사용자가 스캔하고 저장할 때까지 기다리세요. 카메라가 막힌 화면에서는 카드가 바코드 사진이나 숫자 입력을 받습니다.",
          ),
        ],
        structuredContent: {
          meal: meal ?? ("snack" as const),
          date: date && date.length > 0 ? date : seoulToday(),
          accountKey: guestKey(await readyUserId(extra, accountKey)),
        },
      }),
    )
    .registerTool(
      {
        name: "lookup-barcode",
        description:
          "바코드 숫자로 포장 식품의 100g당 칼로리와 탄단지를 찾는다. 바코드 카드가 호출하거나, 사용자가 바코드 숫자를 직접 적었을 때 호출한다. 제품은 Open Food Facts에서 찾고, 거기에 열량이 없으면 제품 이름으로 식품영양성분 데이터베이스를 찾는다. 결과의 source를 사용자에게 함께 밝힌다. 찾지 못하면 수치를 지어내지 않는다.",
        inputSchema: {
          barcode: z.string().describe("바코드 숫자 8~14자리"),
        },
        annotations: {
          title: "Look up a barcode",
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
        _meta: {
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Looking up the barcode…",
          "openai/toolInvocation/invoked": "Barcode lookup done.",
        },
      },
      async ({ barcode }) => {
        const product = await lookupBarcode(await getDb(), barcode);
        return {
          content: product.found
            ? `${product.productName} 100g당 ${product.kcalPer100}kcal, 탄 ${product.carbPer100}g, 단 ${product.proteinPer100}g, 지 ${product.fatPer100}g. 출처: ${product.source.ko}`
            : product.message,
          structuredContent: product,
        };
      },
    )
}
