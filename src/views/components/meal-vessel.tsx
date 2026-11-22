/** Palm-scaled vessel controls for rice/soup/western plates. */

import { useEffect, useId, useState } from "react";
import { bowlContentMl } from "@/volume.js";

export type VesselState = {
  diameterCm: number;
  heightCm: number;
  fillRatio: number;
  servings: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Default bowl: diameter ≈ palm width (photo scale), height ≈ palm × 5/10. */
export function defaultVessel(
  handLengthCm: number,
  handWidthCm = 0,
): VesselState {
  const palm = handLengthCm > 0 ? handLengthCm : 18;
  const diameter =
    handWidthCm > 0 ? handWidthCm : handLengthCm > 0 ? handLengthCm : 12;
  return {
    diameterCm: round1(diameter),
    heightCm: round1(palm * 0.5),
    fillRatio: 0.85,
    servings: 1,
  };
}

/** Locked diameter from photo judgment, or palm width when photo is not required. */
export function lockedVesselDiameterCm(
  handLengthCm: number,
  handWidthCm: number,
  photoDiameterCm?: number,
  /** Photo meals: do not fall back to saved palm until the host sets photoDiameterCm. */
  requirePhotoDiameter = false,
): number {
  if (photoDiameterCm != null && photoDiameterCm > 0) {
    return round1(photoDiameterCm);
  }
  if (requirePhotoDiameter) return 0;
  if (handWidthCm > 0) return round1(handWidthCm);
  if (handLengthCm > 0) return round1(handLengthCm);
  return 12;
}

const BOWL_PX = 190;
const DIAMETER_PRESETS = [10.5, 12, 13.5, 18] as const;

export function MealVesselControls({
  handLengthCm,
  handWidthCm = 0,
  photoDiameterCm,
  requirePhotoDiameter = false,
  value,
  onChange,
  label,
  askSharedBowl,
}: {
  handLengthCm: number;
  handWidthCm?: number;
  /** Photo-judged bowl diameter (cm). Seeds the editable rim. */
  photoDiameterCm?: number;
  /** When true, diameter stays pending until photo or user sets a value. */
  requirePhotoDiameter?: boolean;
  value: VesselState;
  onChange: (next: VesselState) => void;
  label: string;
  askSharedBowl?: boolean;
}) {
  const palm = handLengthCm > 0 ? handLengthCm : 18;
  const photoSeed =
    photoDiameterCm != null && photoDiameterCm > 0
      ? round1(photoDiameterCm)
      : 0;
  const diameterCm =
    value.diameterCm > 0
      ? round1(value.diameterCm)
      : lockedVesselDiameterCm(
          handLengthCm,
          handWidthCm,
          photoSeed > 0 ? photoSeed : undefined,
          requirePhotoDiameter,
        );
  const diameterPending = requirePhotoDiameter && !(diameterCm > 0);
  const diameterUserEdited =
    photoSeed > 0 &&
    value.diameterCm > 0 &&
    Math.abs(value.diameterCm - photoSeed) > 0.05;

  useEffect(() => {
    if (photoSeed > 0 && !(value.diameterCm > 0)) {
      onChange({ ...value, diameterCm: photoSeed });
      return;
    }
    if (
      !requirePhotoDiameter &&
      !(value.diameterCm > 0) &&
      diameterCm > 0
    ) {
      onChange({ ...value, diameterCm });
    }
    // Seed once from photo or palm fallback; avoid looping on every onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional seed-only
  }, [photoSeed, requirePhotoDiameter]);

  const heightTenths = Math.max(
    1,
    Math.min(20, Math.round((value.heightCm / palm) * 10) || 5),
  );
  const heightFromTenths = round1((palm * heightTenths) / 10);

  const bowls = Math.max(1, Math.ceil(value.servings));
  const clipId = `bowl${useId().replace(/:/g, "")}`;
  const [servingsText, setServingsText] = useState(() =>
    value.servings > 0 ? String(value.servings) : "",
  );
  const [diameterText, setDiameterText] = useState(() =>
    diameterCm > 0 ? String(diameterCm) : "",
  );
  useEffect(() => {
    setServingsText((current) => {
      if (current.trim() === "" || current === ".") return current;
      const parsed = Number(current);
      if (Number.isFinite(parsed) && Math.abs(parsed - value.servings) < 0.001) {
        return current;
      }
      return String(value.servings);
    });
  }, [value.servings]);
  useEffect(() => {
    setDiameterText((current) => {
      if (current.trim() === "" || current === ".") return current;
      const parsed = Number(current);
      if (Number.isFinite(parsed) && Math.abs(parsed - diameterCm) < 0.05) {
        return current;
      }
      return diameterCm > 0 ? String(diameterCm) : "";
    });
  }, [diameterCm]);
  const contentMl = bowlContentMl({
    diameterCm: Math.max(diameterCm, 0.1),
    heightCm: value.heightCm,
    fillRatio: value.fillRatio,
    kind: "ceramic_bowl",
    dimensionsAreOuter: true,
    material: "ceramic",
  });

  // Height/diameter drives bowl silhouette: flat dish → deep cup.
  const depthRatio = Math.min(
    2,
    Math.max(0.05, value.heightCm / Math.max(diameterCm, 0.1)),
  );
  const svgSize = BOWL_PX;
  const rimY = 28;
  const maxDepthPx = svgSize - rimY - 36;
  // Map depthRatio 0.05→2 into ~18%→100% of available vertical space.
  const depthPx = Math.round(
    maxDepthPx * (0.18 + Math.min(1, depthRatio / 1.2) * 0.82),
  );
  const rimHalf = 68;
  // Deeper bowls taper more at the bottom; shallow ones stay wide.
  const bottomHalf = Math.round(rimHalf * (0.92 - Math.min(0.55, depthRatio * 0.35)));
  const bottomY = rimY + depthPx;
  const fillLevel = Math.max(0.08, Math.min(1, value.fillRatio));
  const fillTopY = bottomY - depthPx * fillLevel;
  // Side bulge: shallow = flatter curve, deep = rounder U.
  const curvePull = Math.round(8 + depthRatio * 18);

  const bowlOuterPath = [
    `M ${svgSize / 2 - rimHalf} ${rimY}`,
    `C ${svgSize / 2 - rimHalf - 4} ${rimY + curvePull * 0.35}, ${svgSize / 2 - bottomHalf - 2} ${bottomY - curvePull * 0.2}, ${svgSize / 2 - bottomHalf} ${bottomY}`,
    `Q ${svgSize / 2} ${bottomY + 6 + depthRatio * 4} ${svgSize / 2 + bottomHalf} ${bottomY}`,
    `C ${svgSize / 2 + bottomHalf + 2} ${bottomY - curvePull * 0.2}, ${svgSize / 2 + rimHalf + 4} ${rimY + curvePull * 0.35}, ${svgSize / 2 + rimHalf} ${rimY}`,
  ].join(" ");

  const surfaceHalf = Math.round(
    bottomHalf + (rimHalf - bottomHalf) * fillLevel,
  );
  const fillPath = [
    `M ${svgSize / 2 - surfaceHalf} ${fillTopY}`,
    `L ${svgSize / 2 + surfaceHalf} ${fillTopY}`,
    `C ${svgSize / 2 + surfaceHalf} ${fillTopY + (bottomY - fillTopY) * 0.45}, ${svgSize / 2 + bottomHalf} ${bottomY - curvePull * 0.15}, ${svgSize / 2 + bottomHalf} ${bottomY}`,
    `Q ${svgSize / 2} ${bottomY + 6 + depthRatio * 4} ${svgSize / 2 - bottomHalf} ${bottomY}`,
    `C ${svgSize / 2 - bottomHalf} ${bottomY - curvePull * 0.15}, ${svgSize / 2 - surfaceHalf} ${fillTopY + (bottomY - fillTopY) * 0.45}, ${svgSize / 2 - surfaceHalf} ${fillTopY}`,
    "Z",
  ].join(" ");

  const shapeHint =
    depthRatio < 0.25
      ? "얕은 접시형"
      : depthRatio < 0.55
        ? "일반 그릇형"
        : depthRatio < 1
          ? "깊은 그릇형"
          : "높은 컵형";

  function setDiameterCm(cm: number) {
    const capped = Math.max(4, Math.min(40, cm));
    onChange({
      ...value,
      diameterCm: round1(capped),
    });
  }

  function setHeightFromTenths(tenths: number) {
    const next = Math.max(1, Math.min(20, tenths));
    onChange({
      ...value,
      diameterCm: diameterCm > 0 ? diameterCm : value.diameterCm,
      heightCm: round1((palm * next) / 10),
    });
  }

  function setHeightCm(cm: number) {
    const capped = Math.max(0.3, Math.min(palm * 2, cm));
    onChange({
      ...value,
      diameterCm: diameterCm > 0 ? diameterCm : value.diameterCm,
      heightCm: round1(capped),
    });
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
      <p className="text-center text-sm font-bold">{label} 그릇</p>
      <p className="mt-0.5 text-center text-xs text-muted-foreground">
        {diameterPending
          ? "사진 손바닥으로 지름 판별 중 · 아래에서 직접 고를 수도 있습니다"
          : "지름은 사진 손바닥 비교값(수정 가능) · 높이는 손바닥 비율로 조절"}
      </p>

      <div className="mt-4 w-full overflow-x-auto">
        <div className="flex w-max items-end gap-3 pb-1">
          {Array.from({ length: bowls }, (_, index) => {
            const bowlClipId = `${clipId}-${index}`;
            return (
              <div
                key={bowlClipId}
                className="relative shrink-0"
                style={{ width: BOWL_PX, height: BOWL_PX }}
              >
                <svg
                  width={BOWL_PX}
                  height={BOWL_PX}
                  viewBox={`0 0 ${svgSize} ${svgSize}`}
                  className="overflow-visible"
                  aria-hidden
                >
                  <line
                    x1={14}
                    y1={rimY}
                    x2={14}
                    y2={bottomY}
                    stroke="currentColor"
                    className="text-sky-600 dark:text-sky-400"
                    strokeWidth={1.5}
                  />
                  <text
                    x={16}
                    y={(rimY + bottomY) / 2}
                    className="fill-sky-700 dark:fill-sky-300"
                    fontSize={11}
                    fontWeight={700}
                    dominantBaseline="middle"
                  >
                    {value.heightCm}cm
                  </text>
                  <defs>
                    <clipPath id={bowlClipId}>
                      <path d={`${bowlOuterPath} Z`} />
                    </clipPath>
                  </defs>
                  <g clipPath={`url(#${bowlClipId})`}>
                    <path
                      d={fillPath}
                      className="fill-sky-500/55 transition-all duration-150"
                    />
                  </g>
                  <path
                    d={bowlOuterPath}
                    fill="none"
                    className="stroke-foreground/80 transition-all duration-150"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <ellipse
                    cx={svgSize / 2}
                    cy={rimY}
                    rx={rimHalf}
                    ry={Math.max(3, 7 - depthRatio * 2)}
                    fill="none"
                    className="stroke-foreground/50"
                    strokeWidth={2}
                  />
                  <text
                    x={svgSize / 2}
                    y={fillTopY + (bottomY - fillTopY) * 0.45}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-foreground/80"
                    fontSize={12}
                    fontWeight={700}
                  >
                    {Math.round(value.fillRatio * 100)}% 찬
                  </text>
                  <line
                    x1={svgSize / 2 - rimHalf}
                    y1={bottomY + 18}
                    x2={svgSize / 2 + rimHalf}
                    y2={bottomY + 18}
                    className="stroke-amber-700/80 dark:stroke-amber-400/80"
                    strokeWidth={1.5}
                  />
                  <text
                    x={svgSize / 2}
                    y={bottomY + 32}
                    textAnchor="middle"
                    className="fill-amber-800 dark:fill-amber-300"
                    fontSize={11}
                    fontWeight={700}
                  >
                    {diameterPending ? "지름 판별 중" : `지름 ${diameterCm}cm`}
                  </text>
                </svg>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-center text-xs tabular-nums text-muted-foreground">
        {diameterPending ? (
          <>
            <span className="font-bold text-foreground">지름 판별 중</span>
            {" · 사진 속 손바닥과 그릇을 비교하는 중… · 높이 "}
            <span className="font-bold text-foreground">{value.heightCm}cm</span>
            {" = 손바닥의 "}
            <span className="font-bold text-foreground">{heightTenths}/10</span>
          </>
        ) : (
          <>
            <span className="font-bold text-foreground">{shapeHint}</span>
            {" · 지름 "}
            <span className="font-bold text-foreground">{diameterCm}cm</span>
            {diameterUserEdited
              ? " (직접 수정)"
              : photoSeed > 0
                ? " (사진 손바닥 비교 · 수정 가능)"
                : " (직접 선택 · 수정 가능)"}
            {" · 높이 "}
            <span className="font-bold text-foreground">{value.heightCm}cm</span>
            {" = 손바닥의 "}
            <span className="font-bold text-foreground">{heightTenths}/10</span>
            {Math.abs(value.heightCm - heightFromTenths) > 0.15
              ? " (직접 입력)"
              : ""}
            {" · 내용물 약 "}
            <span className="font-bold text-foreground">{contentMl}ml</span>
          </>
        )}
      </p>

      <label className="mt-4 block text-sm font-medium">
        지름 (cm)
        <input
          type="number"
          min={4}
          max={40}
          step={0.1}
          value={diameterText}
          placeholder={diameterPending ? "판별 중 · 직접 입력 가능" : "예: 12"}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
            setDiameterText(raw);
            const parsed = Number(raw);
            if (raw === "" || raw === "." || !Number.isFinite(parsed) || parsed <= 0) {
              return;
            }
            setDiameterCm(parsed);
          }}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 tabular-nums"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DIAMETER_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`rounded-lg border px-2.5 py-1 text-xs font-bold tabular-nums ${
              Math.abs(diameterCm - preset) < 0.05
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-border bg-background"
            }`}
            onClick={() => {
              setDiameterText(String(preset));
              setDiameterCm(preset);
            }}
          >
            {preset}cm
          </button>
        ))}
      </div>

      <label className="mt-4 block text-sm font-medium">
        높이 · 손바닥({palm}cm)의 {heightTenths}/10
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={heightTenths}
          onChange={(event) => setHeightFromTenths(Number(event.target.value))}
          className="mt-2 h-3 w-full accent-sky-600"
        />
        <span className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>1/10</span>
          <span>5/10</span>
          <span>10/10</span>
          <span>20/10</span>
        </span>
      </label>

      <label className="mt-3 block text-sm font-medium">
        높이 직접 입력 (cm)
        <input
          type="number"
          min={0.3}
          max={Math.max(1, palm * 2)}
          step={0.1}
          value={value.heightCm}
          onChange={(event) => setHeightCm(Number(event.target.value) || 0.3)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 tabular-nums"
        />
      </label>

      <label className="mt-3 block text-sm font-medium">
        내용물 {Math.round(value.fillRatio * 100)}%
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={value.fillRatio}
          onChange={(event) =>
            onChange({
              ...value,
              diameterCm: diameterCm > 0 ? diameterCm : value.diameterCm,
              fillRatio: Number(event.target.value),
            })
          }
          className="mt-2 h-3 w-full accent-sky-600"
        />
      </label>

      {askSharedBowl && diameterCm > 20 ? (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
          해당 {label}을 1인분으로 잡을까요? 아래에서 인분을 고르세요.
        </p>
      ) : null}

      <label className="mt-3 block text-sm font-medium">
        인분
        <input
          type="text"
          inputMode="decimal"
          value={servingsText}
          placeholder="인분"
          onChange={(event) => {
            const raw = event.target.value;
            if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
            setServingsText(raw);
            const parsed = Number(raw);
            if (raw === "" || raw === "." || !Number.isFinite(parsed) || parsed <= 0) {
              return;
            }
            onChange({
              ...value,
              diameterCm: diameterCm > 0 ? diameterCm : value.diameterCm,
              servings: Math.min(12, parsed),
            });
          }}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>
      {value.fillRatio >= 0.95 ? (
        <button
          type="button"
          className="mt-3 w-full rounded-lg border border-dashed border-border py-2 text-sm font-bold"
          onClick={() =>
            onChange({
              ...value,
              diameterCm: diameterCm > 0 ? diameterCm : value.diameterCm,
              servings: value.servings + 1,
              fillRatio: 0.85,
            })
          }
        >
          그릇 1개 더 (+1인분)
        </button>
      ) : null}
    </div>
  );
}
