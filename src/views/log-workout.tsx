import "@/index.css";

import { useState } from "react";
import { useUser } from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { type WorkoutKind, workoutVolume } from "@/workout.js";
import { useAccountKey } from "./use-account-key.js";

const NOTE_PLACEHOLDER = "달리기 60분동안 3km를 뛰었어";

export type WorkoutEntry = {
  exercise: string;
  kind: WorkoutKind;
  weightKg: number;
  reps: number;
  sets: number;
  durationMin: number;
};

type RowState = {
  note: string;
  exercise: string;
  kind: WorkoutKind;
  weightKg: number;
  reps: number;
  sets: number;
  durationMin: number;
  distanceKm: number;
  burnedKcal: number;
  searched: boolean;
  waiting: boolean;
  searchNote: string;
  matchedName: string;
};

function blankRow(entry?: WorkoutEntry): RowState {
  return {
    note: entry?.exercise ?? "",
    exercise: entry?.exercise ?? "",
    kind: entry?.kind ?? "cardio",
    weightKg: entry?.weightKg ?? 0,
    reps: entry?.reps ?? 0,
    sets: entry?.sets ?? 0,
    durationMin: entry?.durationMin ?? 0,
    distanceKm: 0,
    burnedKcal: 0,
    searched: false,
    waiting: false,
    searchNote: "",
    matchedName: "",
  };
}

export const blankWorkoutEntry: WorkoutEntry = {
  exercise: "",
  kind: "cardio",
  weightKg: 0,
  reps: 0,
  sets: 0,
  durationMin: 0,
};

export function LogWorkoutPanel({
  date,
  entries,
  bodyWeightKg,
  accountKey,
}: {
  date: string;
  entries: WorkoutEntry[];
  bodyWeightKg: number;
  accountKey: string;
}) {
  const { callToolAsync: saveLogs, isPending: saving } =
    useCallTool("save-workout-logs");
  const { callToolAsync: lookupBurn } = useCallTool("lookup-workout-burn");
  const [rows, setRows] = useState<RowState[]>(
    entries.length > 0 ? entries.map((entry) => blankRow(entry)) : [blankRow()],
  );
  const [day, setDay] = useState(date);
  const [saved, setSaved] = useState("");
  const [failed, setFailed] = useState("");

  const readyRows = rows.filter((row) => row.note.trim().length > 0);
  const totalBurned = rows.reduce((sum, row) => sum + row.burnedKcal, 0);
  const totalVolume = rows.reduce(
    (sum, row) =>
      sum + Math.round(workoutVolume(row.weightKg, row.reps, row.sets)),
    0,
  );
  const readyToSave =
    readyRows.length > 0 &&
    readyRows.every((row) => row.searched && row.burnedKcal > 0);
  const anyWaiting = rows.some((row) => row.waiting);

  function patch(index: number, change: Partial<RowState>, reset = false) {
    setSaved("");
    setRows((current) =>
      current.map((row, at) => {
        if (at !== index) return row;
        const next = { ...row, ...change };
        if (reset) {
          next.searched = false;
          next.waiting = false;
          next.burnedKcal = 0;
          next.searchNote = "";
          next.matchedName = "";
          next.distanceKm = 0;
        }
        return next;
      }),
    );
  }

  async function searchRow(index: number) {
    const row = rows[index];
    if (!row || saving) return;
    const note = row.note.trim();
    if (note.length === 0) {
      setFailed("운동을 문장으로 적은 뒤 검색하세요.");
      return;
    }
    setFailed("");
    patch(index, {
      waiting: true,
      searched: false,
      burnedKcal: 0,
      searchNote: "문장을 읽고 kcal를 계산하는 중…",
      matchedName: "",
    });
    try {
      // 채팅 입력창에 글을 넣지 않는다. 서버가 note만으로 kcal를 낸다.
      const result = await lookupBurn({ note, accountKey });
      const out = result.structuredContent;
      if (out?.ok && Number(out.burnedKcal) > 0) {
        patch(index, {
          exercise: String(out.exercise || out.matchedName || note),
          kind: (out.kind as WorkoutKind) || "cardio",
          weightKg: Number(out.weightKg) || 0,
          reps: Number(out.reps) || 0,
          sets: Number(out.sets) || 0,
          durationMin: Number(out.durationMin) || 0,
          distanceKm: Number(out.distanceKm) || 0,
          burnedKcal: Number(out.burnedKcal),
          searched: true,
          waiting: false,
          searchNote: String(out.message ?? ""),
          matchedName: String(out.matchedName || out.exercise || note),
        });
        return;
      }
      patch(index, {
        waiting: false,
        searchNote: String(
          out?.message ||
            "kcal를 계산하지 못했습니다. 시간·세트·거리를 문장에 넣어 주세요.",
        ),
      });
      setFailed(
        String(
          out?.message ||
            "kcal를 계산하지 못했습니다. 예시를 참고해 다시 적어 주세요.",
        ),
      );
    } catch (error) {
      patch(index, {
        waiting: false,
        searchNote: "검색에 실패했습니다. 다시 눌러 주세요.",
      });
      setFailed(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "검색에 실패했습니다. 다시 눌러 주세요.",
      );
    }
  }

  async function save() {
    if (!readyToSave || saving || anyWaiting) return;
    setFailed("");
    try {
      const result = await saveLogs({
        date: day,
        entries: readyRows.map((row) => ({
          exercise: row.matchedName || row.exercise || row.note,
          kind: row.kind,
          weightKg: row.weightKg,
          reps: row.reps,
          sets: row.sets,
          durationMin: row.durationMin,
          burnedKcal: row.burnedKcal,
        })),
        accountKey,
      });
      const body = result.structuredContent;
      if (body?.saved) {
        setSaved(
          `${body.date} 운동 ${body.count}줄을 저장했습니다. 소모 약 ${body.burnedKcal}kcal.`,
        );
      } else {
        setFailed("저장하지 못했습니다. 문장을 확인해 주세요.");
      }
    } catch (error) {
      setFailed(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "저장하지 못했습니다. 한 번 더 눌러 주세요.",
      );
    }
  }

  return (
    <div className="p-4 bg-background text-foreground rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">운동 기록</h2>
        <input
          type="date"
          value={day}
          onChange={(event) => {
            setSaved("");
            setDay(event.target.value || date);
          }}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
        />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        문장으로 적고 검색하면 바로 kcal가 나옵니다. 채팅창에는 글이 안
        들어갑니다.
        {bodyWeightKg > 0 ? ` 체중 ${bodyWeightKg}kg 기준.` : " 인바디 체중이 필요합니다."}
      </p>

      <div className="mt-3 space-y-3">
        {rows.map((row, index) => (
          <div
            key={index}
            className="rounded-lg border border-border bg-card p-3 space-y-2"
          >
            <label className="block text-sm font-medium">
              운동 문장
              <textarea
                value={row.note}
                rows={2}
                placeholder={NOTE_PLACEHOLDER}
                disabled={saving || row.waiting}
                onChange={(event) =>
                  patch(index, { note: event.target.value }, true)
                }
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving || row.waiting || row.note.trim().length === 0}
                onClick={() => {
                  void searchRow(index);
                }}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {row.waiting ? "계산 중…" : "검색"}
              </button>
              {rows.length > 1 ? (
                <button
                  type="button"
                  disabled={saving || row.waiting}
                  onClick={() => {
                    setSaved("");
                    setRows((current) =>
                      current.filter((_, at) => at !== index),
                    );
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                >
                  줄 삭제
                </button>
              ) : null}
            </div>
            {row.searched && row.burnedKcal > 0 ? (
              <p className="text-sm">
                <span className="font-bold">
                  {row.matchedName || row.exercise}
                </span>
                {` · ${row.burnedKcal}kcal`}
                {row.kind === "cardio" ? " · 유산소" : " · 근력"}
                {row.durationMin > 0 ? ` · ${row.durationMin}분` : ""}
                {row.distanceKm > 0 ? ` · ${row.distanceKm}km` : ""}
                {row.sets > 0
                  ? ` · ${row.weightKg > 0 ? `${row.weightKg}kg ` : ""}${row.reps}회 × ${row.sets}세트`
                  : ""}
              </p>
            ) : row.searchNote ? (
              <p className="text-sm text-muted-foreground">{row.searchNote}</p>
            ) : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={saving || anyWaiting || rows.length >= 8}
        onClick={() => {
          setSaved("");
          setRows((current) => [...current, blankRow()]);
        }}
        className="mt-3 w-full rounded-lg border border-dashed border-border py-2 text-sm font-bold disabled:opacity-60"
      >
        줄 추가
      </button>

      {(totalBurned > 0 || totalVolume > 0) && (
        <p className="mt-3 text-sm text-muted-foreground">
          합계 약 {totalBurned}kcal
          {totalVolume > 0 ? ` · 볼륨 ${totalVolume}` : ""}
        </p>
      )}

      {failed ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {failed}
        </p>
      ) : null}
      {saved ? (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
          {saved}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!readyToSave || saving || anyWaiting}
        onClick={() => {
          void save();
        }}
        className="mt-3 w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white disabled:opacity-60"
      >
        {saving ? "저장 중…" : saved ? "저장했습니다" : "운동 저장"}
      </button>
    </div>
  );
}

export default function LogWorkout() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"log-workout">();
  const accountKey = useAccountKey();

  if (!toolInfo.isSuccess) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} min-h-[200px] p-4 bg-background text-foreground`}
      >
        운동 기록 카드를 불러오는 중…
      </div>
    );
  }

  const entries = Array.isArray(toolInfo.output.entries)
    ? (toolInfo.output.entries as WorkoutEntry[])
    : [];

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <LogWorkoutPanel
        date={toolInfo.output.date}
        entries={entries}
        bodyWeightKg={Number(toolInfo.output.bodyWeightKg) || 0}
        accountKey={accountKey}
      />
    </div>
  );
}
