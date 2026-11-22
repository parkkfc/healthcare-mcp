import "@/index.css";

import { useState } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useUser } from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { SourceFooter } from "./components/source-footer.js";
import { useAccountKey } from "./use-account-key.js";

const mealLabel = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
} as const;

export type DietPeriodData = Extract<
  ReturnType<typeof useToolInfo<"get-diet-period">>,
  { isSuccess: true }
>["output"];
type Food = DietPeriodData["foods"][number];

function errorText(error: unknown) {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "처리하지 못했습니다. 다시 조회한 뒤 시도해 주세요.";
}

export function DietPeriodPanel({
  data,
  theme,
  accountKey,
}: {
  data: DietPeriodData;
  theme: string;
  accountKey: string;
}) {
  const { callToolAsync: reload, isPending: reloading } =
    useCallTool("get-diet-period");
  const { callToolAsync: updateLog, isPending: updating } =
    useCallTool("update-meal-log");
  const { callToolAsync: deleteLog, isPending: deleting } =
    useCallTool("delete-meal-log");
  const [foods, setFoods] = useState<Food[]>(data.foods);
  const [editId, setEditId] = useState<number | null>(null);
  const [gramsDraft, setGramsDraft] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const busy = reloading || updating || deleting;
  const axis = theme === "dark" ? "#e4e4e7" : "#3f3f46";

  const byDate = new Map<string, number>();
  for (const food of foods) {
    byDate.set(food.date, (byDate.get(food.date) ?? 0) + food.kcal);
  }
  const days = [...byDate.entries()].map(([date, kcal]) => ({ date, kcal }));

  async function refresh() {
    try {
      const result = await reload({
        startDate: data.startDate,
        endDate: data.endDate,
        accountKey,
      });
      if (result.structuredContent) {
        setFoods(result.structuredContent.foods);
        setStale(false);
        setNotice("다시 조회했습니다. 15분 안에 고치거나 지울 수 있어요.");
      }
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function rejected(message: string) {
    setStale(true);
    setNotice(message);
  }

  async function saveGrams(food: Food) {
    const grams = Number(gramsDraft);
    if (!(grams > 0)) return;
    try {
      const result = await updateLog({
        id: food.id,
        etag: food.etag,
        grams,
        accountKey,
      });
      const body = result.structuredContent;
      if (body?.ok && "food" in body) {
        const next = body.food;
        setFoods((current) =>
          current.map((item) => (item.id === next.id ? next : item)),
        );
        setEditId(null);
        setNotice(body.message);
      } else {
        rejected(body?.message ?? "고치지 못했습니다. 다시 조회해 주세요.");
      }
    } catch (error) {
      rejected(errorText(error));
    }
  }

  async function remove(food: Food) {
    try {
      const result = await deleteLog({
        id: food.id,
        etag: food.etag,
        accountKey,
      });
      const body = result.structuredContent;
      if (body?.ok) {
        setFoods((current) => current.filter((item) => item.id !== food.id));
        setDeleteId(null);
        setNotice(body.message);
      } else {
        rejected(body?.message ?? "지우지 못했습니다. 다시 조회해 주세요.");
      }
    } catch (error) {
      rejected(errorText(error));
    }
  }

  return (
    <div className="p-4 bg-background text-foreground rounded-xl border border-border">
      <h2 className="text-lg font-bold">
        {data.startDate} ~ {data.endDate}
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        기록은 한 줄씩만 고치거나 지울 수 있고, 조회한 지 15분이 지나면 다시
        조회해야 합니다.
      </p>
      {foods.length === 0 ? (
        <p className="text-sm">이 기간에 저장된 음식이 없습니다.</p>
      ) : (
        <>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days}>
                <XAxis dataKey="date" tick={{ fill: axis, fontSize: 11 }} />
                <YAxis tick={{ fill: axis, fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="kcal" fill="#2563eb" name="kcal" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
            {foods.map((food) => (
              <li key={food.id} className="rounded-lg border border-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{food.foodName}</div>
                    <div className="text-xs text-muted-foreground">
                      {food.date} {mealLabel[food.meal]} · {food.grams}g ·{" "}
                      {food.kcal}kcal · 탄 {food.carbG}g · 단 {food.proteinG}g
                      · 지 {food.fatG}g
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setDeleteId(null);
                        setEditId(editId === food.id ? null : food.id);
                        setGramsDraft(String(food.grams));
                      }}
                      className="rounded-full border border-border px-2 py-0.5 text-xs disabled:opacity-60"
                    >
                      고치기
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditId(null);
                        setDeleteId(deleteId === food.id ? null : food.id);
                      }}
                      className="rounded-full border border-red-600/50 px-2 py-0.5 text-xs text-red-600 disabled:opacity-60"
                    >
                      지우기
                    </button>
                  </div>
                </div>
                {editId === food.id ? (
                  <form
                    className="mt-2 flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveGrams(food);
                    }}
                  >
                    <input
                      type="number"
                      min={1}
                      value={gramsDraft}
                      onChange={(event) => setGramsDraft(event.target.value)}
                      className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-sm"
                    />
                    <span className="text-xs">g</span>
                    <button
                      type="submit"
                      disabled={busy || !(Number(gramsDraft) > 0)}
                      className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-60"
                    >
                      {updating ? "저장 중…" : "중량 저장"}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      칼로리와 탄단지는 중량 비율로 다시 계산됩니다.
                    </span>
                  </form>
                ) : null}
                {deleteId === food.id ? (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span>이 한 줄을 지울까요? 되돌릴 수 없습니다.</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(food)}
                      className="rounded-lg bg-red-600 px-3 py-1 font-bold text-white disabled:opacity-60"
                    >
                      {deleting ? "지우는 중…" : "지우기"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(null)}
                      className="rounded-lg border border-border px-3 py-1"
                    >
                      취소
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {notice ? <p className="mt-3 text-sm">{notice}</p> : null}
      {stale ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
        >
          {reloading ? "조회 중…" : "다시 조회"}
        </button>
      ) : null}
      <SourceFooter
        data={foods.length > 0 ? data.source : null}
        libs={["recharts"]}
      />
      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "meal-logs",
          startDate: data.startDate,
          endDate: data.endDate,
          rows: foods.length,
          totalKcal: foods.reduce((sum, food) => sum + food.kcal, 0),
        })}
      />
    </div>
  );
}

function DietPeriodLoaded({
  data,
  theme,
}: {
  data: DietPeriodData;
  theme: string;
}) {
  const accountKey = useAccountKey(data.accountKey || undefined);
  return <DietPeriodPanel data={data} theme={theme} accountKey={accountKey} />;
}

export default function DietPeriod() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"get-diet-period">();
  if (!toolInfo.isSuccess) return null;
  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <DietPeriodLoaded data={toolInfo.output} theme={theme} />
    </div>
  );
}
