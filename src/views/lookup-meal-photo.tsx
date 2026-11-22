import "@/index.css";

import { useState } from "react";
import { useUser } from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { HostFileImage } from "./components/host-file-image.js";
import { SourceFooter } from "./components/source-footer.js";
import { bumpProfile } from "./profile-sync.js";
import { useAccountKey } from "./use-account-key.js";
import { useAssistantContext } from "./use-assistant-context.js";
import { estimateVolumes, vesselDepthCm } from "@/volume.js";
import ContainerFill from "./container-fill.js";

const mealLabel = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
} as const;

const SIDE_PORTIONS = [0.5, 1, 2] as const;

const round1 = (value: number) => Math.round(value * 10) / 10;

function basisAmount(basis: string): number {
  const amount = Number.parseFloat(basis);
  return Number.isFinite(amount) && amount > 0 ? amount : 100;
}

/** 100ml 기준은 ml, 100g 기준은 g으로 환산한다. */
function basisQuantity(basis: string, ml: number, grams: number): number {
  return basis.toLowerCase().includes("ml") ? ml : grams;
}

export default function LookupMealPhoto() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"lookup-meal-photo">();
  const { callToolAsync, isPending: isSaving } = useCallTool("save-meal-foods");
  const accountKey = useAccountKey();
  const [curvatureOverride, setCurvatureOverride] = useState<number | null>(
    null,
  );
  const [fillOverride, setFillOverride] = useState<number | null>(null);
  const [gramsByIndex, setGramsByIndex] = useState<Record<number, number>>({});
  const [portionsByIndex, setPortionsByIndex] = useState<
    Record<number, number>
  >({});
  const [plateKeep, setPlateKeep] = useState(1);
  const [extraRice, setExtraRice] = useState(0);
  const [mainRefill, setMainRefill] = useState(0);

  useAssistantContext(
    toolInfo.isSuccess
      ? JSON.stringify({
          userNote: toolInfo.output.userNote,
          dishName: toolInfo.output.dishName,
          handInPhoto: toolInfo.output.handInPhoto,
          curvature: curvatureOverride ?? toolInfo.output.curvature,
          fillRatio: fillOverride ?? toolInfo.output.fillRatio,
          mealCoach: toolInfo.output.mealCoach,
          plateKeep,
          extraRice,
          mainRefill,
          portionsByIndex,
          gramsByIndex,
          accountKey,
        })
      : "",
  );

  if (!toolInfo.isSuccess) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} min-h-[200px] p-4 bg-background text-foreground`}
      >
        식단 보정 카드를 불러오는 중…
      </div>
    );
  }

  const meal = toolInfo.output;
  if (meal.userNote.trim().length === 0) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} p-4 bg-background text-foreground rounded-xl border border-border`}
      >
        <h2 className="text-lg font-bold">먹은 음식을 적어 주세요</h2>
        <p className="mt-2 text-sm">
          사진만으로 이름을 맞히지 않습니다. 먹은 음식을 적은 뒤 그 이름으로
          찾습니다.
        </p>
      </div>
    );
  }
  if (!meal.handInPhoto) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} p-4 bg-background text-foreground rounded-xl border border-border`}
      >
        <h2 className="text-lg font-bold">손바닥이 필요합니다</h2>
        <p className="mt-2 text-sm">
          그릇 옆에 손바닥을 두고 다시 찍어 주세요. 손 치수는 한 번만 저장하고,
          식사 사진은 매번 손바닥과 함께 찍습니다.
        </p>
        {meal.handSaved ? (
          <p className="mt-3 text-sm text-muted-foreground">
            저장된 손바닥 폭 {meal.handWidthCm}cm을 이 사진의 손바닥과
            비교합니다.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            손 치수도 아직 없습니다. 신용카드와 손을 나란히 찍어 한 번
            저장해 주세요.
          </p>
        )}
      </div>
    );
  }

  const curvature = curvatureOverride ?? meal.curvature;
  const fill = fillOverride ?? meal.fillRatio;
  const depthCm = vesselDepthCm(meal.containerDiameterCm, curvature);
  const depthToDiameter =
    meal.containerDiameterCm > 0
      ? Math.round((depthCm / meal.containerDiameterCm) * 100)
      : 0;
  const volumes = estimateVolumes({
    curvature,
    diameterCm: meal.containerDiameterCm,
    fillRatio: fill,
    ingredients: meal.ingredients.map((item) => ({
      coverage: item.isSideDish ? 0 : item.coverage,
      thicknessCm: item.isSideDish ? 0 : item.thicknessCm,
      density: item.density,
    })),
  });

  const coach = meal.mealCoach ?? "maintain";
  const reduceScale = coach === "reduce" ? plateKeep : 1;

  const rows = meal.ingredients.map((item, index) => {
    const side =
      Boolean(item.isSideDish) ||
      (typeof item.coverage === "number" && item.coverage === 0);
    const portions = portionsByIndex[index] ?? item.portions ?? 1;
    const servingG = side
      ? item.servingGrams > 0
        ? item.servingGrams
        : 0
      : item.servingGrams > 0
        ? item.servingGrams
        : item.grams > 0
          ? item.grams
          : 0;
    const volume = volumes[index] ?? { ml: 0, grams: 0 };
    const overridden = gramsByIndex[index];
    let baseGrams: number;
    let ml: number;
    if (side) {
      baseGrams = Math.round(
        overridden !== undefined ? overridden : servingG * portions,
      );
      ml = baseGrams / (item.density || 1);
    } else {
      baseGrams = Math.round(overridden ?? volume.grams);
      ml =
        overridden !== undefined
          ? overridden / (item.density || 1)
          : volume.ml;
    }
    const grams =
      baseGrams <= 0 ? 0 : Math.max(1, Math.round(baseGrams * reduceScale));
    const scaledMl = ml * reduceScale;
    const ratio =
      basisQuantity(item.basis, scaledMl, grams) / basisAmount(item.basis);
    return {
      name: item.query,
      foodName: item.foodName,
      matched: item.matched,
      basis: item.basis,
      isSideDish: side,
      portions,
      servingG,
      grams,
      ml: Math.round(scaledMl),
      kcal: Math.round(item.kcalPerBasis * ratio),
      carbG: round1(item.carbPerBasis * ratio),
      proteinG: round1(item.proteinPerBasis * ratio),
      fatG: round1(item.fatPerBasis * ratio),
    };
  });

  const riceExtra =
    coach === "bulk" && extraRice > 0
      ? {
          foodName: "흰쌀밥",
          grams: Math.round(210 * extraRice),
          kcal: Math.round(310 * extraRice),
          carbG: round1(70 * extraRice),
          proteinG: round1(5.5 * extraRice),
          fatG: round1(0.5 * extraRice),
        }
      : null;

  const mainIndex = rows.findIndex((row) => !row.isSideDish && row.matched);
  const refillBoost =
    coach === "bulk" && mainRefill > 0 && mainIndex >= 0
      ? {
          foodName: `${rows[mainIndex]!.foodName} 리필`,
          grams: Math.round(rows[mainIndex]!.grams * 0.5 * mainRefill),
          kcal: Math.round(rows[mainIndex]!.kcal * 0.5 * mainRefill),
          carbG: round1(rows[mainIndex]!.carbG * 0.5 * mainRefill),
          proteinG: round1(rows[mainIndex]!.proteinG * 0.5 * mainRefill),
          fatG: round1(rows[mainIndex]!.fatG * 0.5 * mainRefill),
        }
      : null;

  const totalGrams =
    rows.reduce((sum, row) => sum + row.grams, 0) +
    (riceExtra?.grams ?? 0) +
    (refillBoost?.grams ?? 0);
  const sumKcal =
    rows.reduce((sum, row) => sum + row.kcal, 0) +
    (riceExtra?.kcal ?? 0) +
    (refillBoost?.kcal ?? 0);
  const sumCarb = round1(
    rows.reduce((sum, row) => sum + row.carbG, 0) +
      (riceExtra?.carbG ?? 0) +
      (refillBoost?.carbG ?? 0),
  );
  const sumProtein = round1(
    rows.reduce((sum, row) => sum + row.proteinG, 0) +
      (riceExtra?.proteinG ?? 0) +
      (refillBoost?.proteinG ?? 0),
  );
  const sumFat = round1(
    rows.reduce((sum, row) => sum + row.fatG, 0) +
      (riceExtra?.fatG ?? 0) +
      (refillBoost?.fatG ?? 0),
  );
  const missing = rows.filter((row) => !row.matched);

  const dish = meal.dish;
  const totalMl = rows.reduce((sum, row) => sum + row.ml, 0);
  const dishRatio = dish
    ? basisQuantity(dish.basis, totalMl, totalGrams) / basisAmount(dish.basis)
    : 0;
  const dishKcal =
    dish && dish.matched ? Math.round(dish.kcalPerBasis * dishRatio) : null;

  const matchedRows = rows.filter((row) => row.matched);
  const saveFoods = [
    ...(matchedRows.length > 0
      ? matchedRows.map((row) => ({
          foodName: row.foodName,
          grams: row.grams,
          kcal: row.kcal,
          carbG: row.carbG,
          proteinG: row.proteinG,
          fatG: row.fatG,
        }))
      : dish && dish.matched
        ? [
            {
              foodName: dish.foodName,
              grams: totalGrams,
              kcal: dishKcal ?? 0,
              carbG: round1(dish.carbPerBasis * dishRatio),
              proteinG: round1(dish.proteinPerBasis * dishRatio),
              fatG: round1(dish.fatPerBasis * dishRatio),
            },
          ]
        : []),
    ...(riceExtra
      ? [
          {
            foodName: riceExtra.foodName,
            grams: riceExtra.grams,
            kcal: riceExtra.kcal,
            carbG: riceExtra.carbG,
            proteinG: riceExtra.proteinG,
            fatG: riceExtra.fatG,
          },
        ]
      : []),
    ...(refillBoost
      ? [
          {
            foodName: refillBoost.foodName,
            grams: refillBoost.grams,
            kcal: refillBoost.kcal,
            carbG: refillBoost.carbG,
            proteinG: refillBoost.proteinG,
            fatG: refillBoost.fatG,
          },
        ]
      : []),
  ];

  const goalKcal = meal.goalKcal ?? 0;
  const underGoal = coach === "bulk" && goalKcal > 0 && sumKcal < goalKcal * 0.35;

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} p-4 bg-background text-foreground rounded-xl border border-border`}
    >
      <h2 className="text-lg font-bold">
        {meal.date} {mealLabel[meal.meal]} · {meal.dishName}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        적은 음식: {meal.userNote}
      </p>
      <p className="mb-3 text-sm text-muted-foreground">
        손바닥 비교: {meal.palmComparison}
      </p>

      {meal.mealCoachDetail ? (
        <p
          className={`mb-3 rounded-md px-3 py-2 text-sm ${
            coach === "reduce"
              ? "bg-amber-100 text-amber-950"
              : coach === "bulk"
                ? "bg-sky-100 text-sky-950"
                : "bg-emerald-100 text-emerald-950"
          }`}
        >
          {meal.mealCoachDetail}
          {meal.bodyShape ? ` (${meal.bodyShape}자형)` : ""}
        </p>
      ) : null}

      {meal.handSaved ? (
        <p className="mb-3 rounded-md bg-emerald-100 px-3 py-2 text-sm text-emerald-900">
          저장된 손바닥 폭 {meal.handWidthCm}cm과 이 사진의 손바닥을 비교해
          그릇 크기를 추정했습니다.
        </p>
      ) : (
        <p className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
          사진 속 손바닥으로 비교했습니다. 신용카드와 손을 한 번 저장하면 다음
          사진부터는 이 폭을 cm로 환산합니다.
        </p>
      )}
      <HostFileImage
        fileId={meal.photo?.file_id}
        downloadUrl={meal.photoUrl || meal.photo?.download_url}
        alt={meal.dishName}
        className="mb-3 max-h-48 w-full rounded-lg object-cover"
      />

      {coach === "reduce" ? (
        <div className="mb-3 rounded-lg border border-amber-500/40 p-3">
          <div className="flex items-center justify-between text-sm font-bold">
            <span>덜어내기 (1접시)</span>
            <span>{Math.round(plateKeep * 100)}% 남김</span>
          </div>
          <input
            type="range"
            min={40}
            max={100}
            step={5}
            value={Math.round(plateKeep * 100)}
            aria-label="덜어내기"
            onChange={(event) =>
              setPlateKeep(Number(event.target.value) / 100)
            }
            className="mt-2 w-full cursor-pointer accent-amber-600"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            한 접시에 덜어 담은 양만 남깁니다. 슬라이더를 내리면 전체가
            줄어듭니다.
          </p>
        </div>
      ) : null}

      {coach === "bulk" ? (
        <div className="mb-3 space-y-2 rounded-lg border border-sky-500/40 p-3">
          <p className="text-sm font-bold">한상차림 증량</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setExtraRice((n) => n + 1)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-bold"
            >
              공기밥 추가(+210g){extraRice > 0 ? ` ×${extraRice}` : ""}
            </button>
            <button
              type="button"
              onClick={() => setMainRefill((n) => n + 1)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-bold"
            >
              메인 리필(+50%){mainRefill > 0 ? ` ×${mainRefill}` : ""}
            </button>
            {extraRice > 0 || mainRefill > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setExtraRice(0);
                  setMainRefill(0);
                }}
                className="rounded-lg border border-border px-3 py-2 text-xs"
              >
                리필 초기화
              </button>
            ) : null}
          </div>
          {underGoal ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              이 끼니만으로는 하루 목표({goalKcal}kcal)에 많이 모자랍니다.
              공기밥·메인 리필로 채우세요.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <ContainerFill curvature={curvature} fill={fill} />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(curvature * 100)}
            aria-label="그릇 곡률"
            onChange={(event) => {
              setCurvatureOverride(Number(event.target.value) / 100);
              setGramsByIndex({});
            }}
            className="mt-1 w-full cursor-pointer accent-amber-600"
          />
          <p className="text-sm text-muted-foreground">
            그릇 깊이 {round1(depthCm)}cm · 윗면 지름 {meal.containerDiameterCm}
            cm의 {depthToDiameter}%
          </p>
          <p className="text-xs text-muted-foreground">
            주식/메인만 곡률·담김으로 부피를 잡습니다. 밑반찬은 인분 버튼입니다.
          </p>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(fill * 100)}
          aria-label="담긴 깊이"
          onChange={(event) => {
            setFillOverride(Number(event.target.value) / 100);
            setGramsByIndex({});
          }}
          className="h-36 w-8 cursor-pointer accent-amber-500"
          style={{ writingMode: "vertical-lr", direction: "rtl" }}
        />
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        담긴 깊이 {Math.round(fill * 100)}%. 곡률은 그릇 모양을, 세로
        슬라이더는 음식이 찬 정도를 바꿉니다.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">
            평균적인 {meal.dishName}
          </div>
          {dishKcal !== null && dish ? (
            <>
              <div className="text-xl font-bold">{dishKcal}kcal</div>
              <div className="text-xs">
                {dish.basis}당 {dish.kcalPerBasis}kcal · 탄{" "}
                {dish.carbPerBasis}g · 단 {dish.proteinPerBasis}g · 지{" "}
                {dish.fatPerBasis}g
              </div>
            </>
          ) : (
            <div className="text-xs">데이터베이스에서 찾지 못했습니다.</div>
          )}
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">재료 합산</div>
          <div className="text-xl font-bold">{sumKcal}kcal</div>
          <div className="text-xs">
            {totalGrams}g · 탄 {sumCarb}g · 단 {sumProtein}g · 지 {sumFat}g
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={`${row.name}-${index}`} className="block">
            <span className="font-medium">{row.name}</span>
            {row.isSideDish ? (
              <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                밑반찬
              </span>
            ) : (
              <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                메인
              </span>
            )}
            {row.matched && row.foodName !== row.name ? (
              <span className="text-xs text-muted-foreground">
                {" "}
                → {row.foodName}
              </span>
            ) : null}
            <span className="block text-sm mt-1">
              {row.isSideDish && row.grams <= 0
                ? "1인 1끼 소비량이 없어 열량을 계산하지 않았습니다."
                : row.matched
                  ? `${row.grams}g · ${row.kcal}kcal · 탄 ${row.carbG}g · 단 ${row.proteinG}g · 지 ${row.fatG}g`
                  : "데이터베이스에서 찾지 못해 합산에서 0kcal로 계산했습니다."}
            </span>
            {row.isSideDish ? (
              <div className="mt-1 space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  {SIDE_PORTIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setPortionsByIndex((current) => ({
                          ...current,
                          [index]: p,
                        }));
                        setGramsByIndex((current) => {
                          const next = { ...current };
                          delete next[index];
                          return next;
                        });
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${
                        gramsByIndex[index] === undefined && row.portions === p
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-border"
                      }`}
                    >
                      {p}인분
                      <span className="opacity-70">
                        {" "}
                        ({Math.round(row.servingG * p)}g)
                      </span>
                    </button>
                  ))}
                </div>
                <label className="block text-xs text-muted-foreground">
                  또는 중량(g)
                  <input
                    type="number"
                    min={1}
                    value={row.grams}
                    onChange={(event) =>
                      setGramsByIndex((current) => ({
                        ...current,
                        [index]: Number(event.target.value),
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                  />
                </label>
              </div>
            ) : (
              <input
                type="number"
                min={1}
                value={row.grams}
                onChange={(event) =>
                  setGramsByIndex((current) => ({
                    ...current,
                    [index]: Number(event.target.value),
                  }))
                }
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
              />
            )}
          </div>
        ))}
      </div>
      {missing.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          찾지 못한 재료: {missing.map((row) => row.name).join(", ")}
        </p>
      ) : null}

      <button
        type="button"
        disabled={isSaving || saveFoods.length === 0}
        onClick={() => {
          void callToolAsync({
            date: meal.date,
            meal: meal.meal,
            foods: saveFoods,
            accountKey,
            ...(meal.photo.file_id
              ? {
                  photo: {
                    file_id: meal.photo.file_id,
                    download_url: meal.photo.download_url,
                    mime_type: meal.photo.mime_type,
                    file_name: meal.photo.file_name,
                  },
                }
              : {}),
          })
            .then(() => {
              bumpProfile();
            })
            .catch(() => undefined);
        }}
        className="mt-4 w-full rounded-lg bg-blue-600 py-3 font-bold text-white"
      >
        {isSaving ? "저장 중..." : "재료 합산으로 저장"}
      </button>
      <SourceFooter
        data={meal.source}
        note={`그릇 지름 ${meal.containerDiameterCm}cm 기준. 밑반찬은 1회 섭취참고량.`}
      />
      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "meal-correction",
          date: meal.date,
          meal: meal.meal,
          mealCoach: coach,
          plateKeep,
          extraRice,
          mainRefill,
          curvature,
          fillRatio: fill,
          totalGrams,
          kcal: sumKcal,
          carbG: sumCarb,
          proteinG: sumProtein,
          fatG: sumFat,
          foods: [
            ...rows.map((row) => ({
              name: row.name,
              grams: row.grams,
              kcal: row.kcal,
              isSideDish: row.isSideDish,
              portions: row.portions,
            })),
            ...(riceExtra
              ? [
                  {
                    name: riceExtra.foodName,
                    grams: riceExtra.grams,
                    kcal: riceExtra.kcal,
                  },
                ]
              : []),
            ...(refillBoost
              ? [
                  {
                    name: refillBoost.foodName,
                    grams: refillBoost.grams,
                    kcal: refillBoost.kcal,
                  },
                ]
              : []),
          ],
        })}
      />
    </div>
  );
}
