import { useEffect, useState } from "react";
import {
  TREE_STAGE_COUNT,
  TREE_STAGE_META,
  growthStageFromGoodDays,
} from "@/habit-stickers.js";

const STAGE_MOTION: Record<number, string> = {
  1: "habit-tree-seed",
  2: "habit-tree-sprout",
  3: "habit-tree-sapling",
  4: "habit-tree-young",
  5: "habit-tree-lush",
  6: "habit-tree-bloom",
};

/** Load only the current stage asset (avoids shipping all 6 trees on first paint). */
const TREE_LOADERS = [
  () => import("@/widgets/나무1단계.png"),
  () => import("@/widgets/나무2단계.png"),
  () => import("@/widgets/나무3단계.png"),
  () => import("@/widgets/나무4단계.png"),
  () => import("@/widgets/나무5단계.png"),
  () => import("@/widgets/나무6단계.png"),
] as const;

export type HabitGrowthData = {
  targetDays: number;
  periodStart: string;
  periodEnd: string;
  goodDays: number;
  stage: number;
  bodyGoalSaved: boolean;
};

export function resolveHabitGrowth(input: {
  targetDays: number;
  periodStart: string;
  periodEnd: string;
  goodDays: number;
  bodyGoalSaved: boolean;
}): HabitGrowthData {
  const stage = input.bodyGoalSaved
    ? growthStageFromGoodDays(input.goodDays, input.targetDays)
    : 1;
  return {
    targetDays: input.targetDays,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    goodDays: input.goodDays,
    stage,
    bodyGoalSaved: input.bodyGoalSaved,
  };
}

export function HabitGrowthTree({ growth }: { growth: HabitGrowthData }) {
  const stage = Math.min(
    TREE_STAGE_COUNT,
    Math.max(1, growth.stage || 1),
  );
  const meta = TREE_STAGE_META[stage - 1]!;
  const [src, setSrc] = useState<string>("");
  const [flash, setFlash] = useState(false);
  const [prevStage, setPrevStage] = useState(stage);

  useEffect(() => {
    let cancelled = false;
    const loader = TREE_LOADERS[stage - 1];
    if (!loader) return;
    void loader().then((mod) => {
      if (!cancelled) setSrc(mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  useEffect(() => {
    if (stage !== prevStage) {
      setFlash(true);
      setPrevStage(stage);
      const id = window.setTimeout(() => setFlash(false), 700);
      return () => window.clearTimeout(id);
    }
  }, [stage, prevStage]);

  const perStage =
    growth.targetDays > 0
      ? Math.max(1, Math.ceil(growth.targetDays / TREE_STAGE_COUNT))
      : 0;
  const nextAt =
    growth.bodyGoalSaved && stage < TREE_STAGE_COUNT
      ? stage * perStage
      : null;

  return (
    <section className="mt-4 rounded-xl border border-border bg-background px-3 py-3">
      <h3 className="text-base font-bold tabular-nums">
        성장단계:{stage}단계
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {meta.emoji} {meta.label}
        {growth.bodyGoalSaved
          ? ` · 참잘 ${growth.goodDays}/${growth.targetDays}일 (${growth.periodStart}~${growth.periodEnd})`
          : " · 워너비 체형 기한을 정하면 참잘한 날만큼 자랍니다"}
      </p>
      <div className="relative mx-auto mt-2 flex h-44 w-full max-w-[16rem] items-end justify-center overflow-hidden rounded-xl bg-white">
        {src ? (
          <img
            src={src}
            alt={`${stage}단계 ${meta.label}`}
            draggable={false}
            className={`habit-tree-img max-h-40 w-auto max-w-full object-contain ${STAGE_MOTION[stage]} ${
              flash ? "habit-tree-level-up" : ""
            }`}
          />
        ) : (
          <p className="pb-8 text-xs text-muted-foreground">불러오는 중…</p>
        )}
        {stage >= 6 ? (
          <span
            className="habit-tree-sparkle pointer-events-none absolute inset-0"
            aria-hidden
          />
        ) : null}
      </div>
      {growth.bodyGoalSaved && nextAt != null ? (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          다음 단계까지 참잘 {Math.max(0, nextAt - growth.goodDays)}일
        </p>
      ) : null}
    </section>
  );
}
