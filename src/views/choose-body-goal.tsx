import "@/index.css";

import { useState } from "react";
import { useUser } from "skybridge/web";
import {
  bodyGoalPresets,
  findBodyGoal,
  targetBodyFatKg,
  targetBodyFatPercent,
  type TargetBodyType,
} from "@/body-goals.js";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { bumpProfile } from "../hooks/profile-sync.js";
import maleSlim from "@/widgets/1.남자슬림.png";
import femaleSlim from "@/widgets/1.여자슬림.png";
import maleHypertrophy from "@/widgets/2.남자근비대.png";
import femaleHypertrophy from "@/widgets/2.여자근비대형.png";
import malePower from "@/widgets/3.남자고밀도파워형.png";
import femalePower from "@/widgets/3.여자고밀도파워형.png";
import maleUpper from "@/widgets/4.남자상체집중형.png";
import femaleUpper from "@/widgets/4.여자상체집중형.png";
import maleLower from "@/widgets/5.남자하체집중형.png";
import femaleLower from "@/widgets/5.여자하체집중형.png";
import { deviceToday, deviceTimeZone } from "@/device-time.js";
import { ChatNextHint } from "./components/chat-next-hint.js";
import { useAccountKey } from "./use-account-key.js";

type PhotoSex = "male" | "female";

const sexLabel: Record<PhotoSex, string> = { male: "남자", female: "여자" };

const photos: Record<PhotoSex, Record<TargetBodyType, string>> = {
  male: {
    slim: maleSlim,
    hypertrophy: maleHypertrophy,
    power: malePower,
    upper: maleUpper,
    lower: maleLower,
  },
  female: {
    slim: femaleSlim,
    hypertrophy: femaleHypertrophy,
    power: femalePower,
    upper: femaleUpper,
    lower: femaleLower,
  },
};

/** Row 1 is the five male photos, row 2 the five female ones, by file number. */
const cells = (["male", "female"] as const).flatMap((sex) =>
  bodyGoalPresets.map((preset) => ({
    sex,
    id: preset.id,
    title: preset.title,
    src: photos[sex][preset.id],
  })),
);

type PhotoPick = { sex: PhotoSex; id: TargetBodyType };

const dayPresets = [
  { days: 28, label: "4주" },
  { days: 56, label: "8주" },
  { days: 84, label: "12주" },
  { days: 180, label: "6개월" },
] as const;

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDay(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

export type BodyGoalData = Extract<
  ReturnType<typeof useToolInfo<"choose-body-goal">>,
  { isSuccess: true }
>["output"];

type SavedGoal = {
  selected: string;
  selectedTitle: string;
  targetDays: number;
  targetStartedOn: string;
  targetEndedOn: string;
};

function readSaved(data: BodyGoalData): SavedGoal | null {
  if (!data.bodyGoalSaved) return null;
  const started =
    typeof data.targetStartedOn === "string" ? data.targetStartedOn : "";
  const ended =
    typeof data.targetEndedOn === "string" ? data.targetEndedOn : "";
  if (!data.selected || !started || !ended || !(data.targetDays > 0)) {
    return null;
  }
  return {
    selected: data.selected,
    selectedTitle: data.selectedTitle || findBodyGoal(data.selected)?.title || "",
    targetDays: data.targetDays,
    targetStartedOn: started,
    targetEndedOn: ended,
  };
}

export function ChooseBodyGoalPanel({
  data,
  theme,
  accountKey,
}: {
  data: BodyGoalData;
  theme: string;
  accountKey: string;
}) {
  const { callToolAsync: saveGoal, isPending: saving } =
    useCallTool("save-body-goal");
  const { callToolAsync: clearGoal, isPending: clearing } =
    useCallTool("clear-body-goal");

  const initialSaved = readSaved(data);
  const [saved, setSaved] = useState<SavedGoal | null>(initialSaved);
  const [mode, setMode] = useState<"summary" | "edit">(
    initialSaved ? "summary" : "edit",
  );

  const stored = findBodyGoal(saved?.selected ?? data.selected)?.id ?? null;
  const [pick, setPick] = useState<PhotoPick | null>(
    stored
      ? { sex: data.sex === "female" ? "female" : "male", id: stored }
      : null,
  );
  const [days, setDays] = useState(
    saved?.targetDays && saved.targetDays >= 14 && saved.targetDays <= 365
      ? saved.targetDays
      : data.targetDays >= 14 && data.targetDays <= 365
        ? data.targetDays
        : 84,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const goal = findBodyGoal(pick?.id);
  const startDay = data.today || deviceToday();
  const until = addDays(startDay, Math.max(0, days - 1));
  const pickedFat =
    pick && data.heightCm > 0
      ? targetBodyFatKg(pick.id, pick.sex, data.heightCm)
      : null;
  const pending = busy || saving || clearing;

  async function save() {
    if (!pick || pending) return;
    if (days < 14 || days > 365) {
      setNotice("기한은 14일에서 365일 사이로 정해 주세요.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const result = await saveGoal({
        targetBodyType: pick.id,
        targetDays: days,
        clientDate: deviceToday(),
        clientTimeZone: deviceTimeZone(),
        accountKey,
      });
      const next: SavedGoal = {
        selected: pick.id,
        selectedTitle: findBodyGoal(pick.id)?.title ?? pick.id,
        targetDays: days,
        targetStartedOn:
          result.structuredContent?.targetStartedOn ?? deviceToday(),
        targetEndedOn:
          result.structuredContent?.targetEndedOn ??
          result.structuredContent?.until ??
          until,
      };
      setSaved(next);
      setMode("summary");
      bumpProfile();
      setNotice(
        result.structuredContent?.message ??
          "목표 체형과 기한을 저장했습니다. 성실도 스티커는 이 기간에만 붙습니다.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error && error.message
          ? error.message
          : "저장하지 못했습니다. 다시 눌러 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelGoal() {
    if (pending) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await clearGoal({ accountKey });
      setSaved(null);
      setPick(null);
      setDays(84);
      setMode("edit");
      bumpProfile();
      setNotice(
        result.structuredContent?.message ??
          "워너비 체형과 기한을 취소했습니다.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error && error.message
          ? error.message
          : "취소하지 못했습니다. 다시 눌러 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    if (saved) {
      const id = findBodyGoal(saved.selected)?.id;
      if (id) {
        setPick({
          sex: data.sex === "female" ? "female" : "male",
          id,
        });
      }
      setDays(saved.targetDays);
    }
    setNotice("");
    setMode("edit");
  }

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} space-y-3 rounded-xl border border-border bg-background p-4 text-foreground`}
    >
      <div>
        <h2 className="text-lg font-bold">워너비 체형</h2>
        {mode === "summary" && saved ? (
          <p className="text-sm text-muted-foreground">
            저장된 목표입니다. 취소하면 성실도 스티커가 더 이상 붙지 않습니다.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            닮고 싶은 사진을 고르고, 며칠 안에 갈지 정한 뒤 저장하세요. 저장한
            시작일~종료일에만 성실도 스티커가 붙습니다.
          </p>
        )}
        {data.bodyFatKg > 0 ? (
          <p className="mt-1 text-sm">
            지금 체지방{" "}
            <span className="font-bold">{data.bodyFatKg}kg</span>
            {data.bodyFatPercent > 0 ? ` (${data.bodyFatPercent}%)` : ""}
          </p>
        ) : null}
      </div>

      {mode === "summary" && saved ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">
              현재 세팅된 체형
            </p>
            <p className="mt-0.5 text-base font-bold">{saved.selectedTitle}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">기간</p>
            <p className="mt-0.5 text-sm font-bold tabular-nums">
              {saved.targetStartedOn} ~ {saved.targetEndedOn}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDay(saved.targetStartedOn)}부터{" "}
              {formatDay(saved.targetEndedOn)}까지 · {saved.targetDays}일
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => void cancelGoal()}
              className="rounded-lg border border-red-500/50 px-3 py-2 text-sm font-bold text-red-600 disabled:opacity-50 dark:text-red-400"
            >
              {clearing || busy ? "취소 중…" : "운동기록 취소"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={startEdit}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              워너비 체형 수정
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-1.5">
            {cells.map((cell) => {
              const active = pick?.sex === cell.sex && pick.id === cell.id;
              const percent = targetBodyFatPercent[cell.id][cell.sex];
              const kg = targetBodyFatKg(cell.id, cell.sex, data.heightCm);
              return (
                <button
                  key={`${cell.sex}-${cell.id}`}
                  type="button"
                  disabled={pending}
                  aria-pressed={active}
                  aria-label={`${sexLabel[cell.sex]} ${cell.title}, 체지방 ${percent}%`}
                  onClick={() => setPick({ sex: cell.sex, id: cell.id })}
                  className={`overflow-hidden rounded-lg border-2 text-center transition disabled:opacity-70 ${
                    active
                      ? "border-blue-600 bg-blue-600/10"
                      : "border-transparent hover:border-blue-600/40"
                  }`}
                >
                  <img
                    src={cell.src}
                    alt={`${sexLabel[cell.sex]} ${cell.title}`}
                    className="block w-full"
                  />
                  <span className="block px-0.5 pt-1 text-[10px] leading-tight font-bold break-keep">
                    {cell.title}
                  </span>
                  <span className="block px-0.5 pb-1 text-[10px] leading-tight text-muted-foreground break-keep">
                    {kg != null ? `체지방 약 ${kg}kg` : `체지방 ${percent}%`}
                    <br />
                    {kg != null ? `${percent}%` : sexLabel[cell.sex]}
                  </span>
                </button>
              );
            })}
          </div>
          {goal && pick ? (
            <p className="text-sm">
              <span className="font-bold">
                {sexLabel[pick.sex]} {goal.title}
              </span>
              {" · "}
              {pickedFat != null
                ? `이 체형의 목표 체지방은 약 ${pickedFat}kg (${targetBodyFatPercent[pick.id][pick.sex]}%)입니다.`
                : `이 체형의 목표 체지방률은 ${targetBodyFatPercent[pick.id][pick.sex]}%입니다. 키를 저장하면 kg로도 보여 드립니다.`}
              {data.bodyFatKg > 0 && pickedFat != null
                ? ` 지금은 ${data.bodyFatKg}kg입니다.`
                : ""}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">사진을 먼저 고르세요.</p>
          )}
          <div>
            <p className="text-sm font-bold">달성 기한</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {dayPresets.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  disabled={pending}
                  onClick={() => setDays(preset.days)}
                  className={`rounded-full border px-2 py-1 text-xs disabled:opacity-50 ${
                    days === preset.days
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-border"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="number"
                  min={14}
                  max={365}
                  value={days}
                  disabled={pending}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) setDays(Math.round(next));
                  }}
                  className="w-16 rounded-md border border-border bg-background px-2 py-1 text-foreground"
                />
                일
              </label>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {days >= 14 && days <= 365
                ? `${startDay} ~ ${until} (${formatDay(until)}까지 · ${days}일)`
                : "14일에서 365일 사이로 정해 주세요."}
            </p>
          </div>
          <div className="flex gap-2">
            {saved ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setMode("summary");
                  setNotice("");
                }}
                className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
              >
                뒤로
              </button>
            ) : null}
            <button
              type="button"
              disabled={!pick || pending || days < 14 || days > 365}
              onClick={() => void save()}
              className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving || busy ? "저장 중…" : "체형과 기한 저장"}
            </button>
          </div>
        </>
      )}

      {notice ? <p className="text-sm">{notice}</p> : null}
      {saved || mode === "summary" ? (
        <ChatNextHint example="오늘 맞춤 운동 짜줘" />
      ) : null}
      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "choose-body-goal",
          mode,
          bodyGoalSaved: Boolean(saved),
          selected: saved?.selected ?? pick?.id ?? "",
          selectedLabel: saved?.selectedTitle ?? goal?.title ?? "",
          photoSex: pick?.sex ?? "",
          targetDays: saved?.targetDays ?? days,
          targetStartedOn: saved?.targetStartedOn ?? null,
          targetEndedOn: saved?.targetEndedOn ?? null,
          until: mode === "edit" ? until : saved?.targetEndedOn ?? null,
        })}
      />
    </div>
  );
}

export default function ChooseBodyGoal() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"choose-body-goal">();
  if (!toolInfo.isSuccess) {
    return (
      <div className="flex min-h-48 items-center bg-background p-4 text-sm text-foreground">
        워너비 체형을 불러오는 중…
      </div>
    );
  }
  return <ChooseBodyGoalLoaded data={toolInfo.output} theme={theme} />;
}

function ChooseBodyGoalLoaded({
  data,
  theme,
}: {
  data: BodyGoalData;
  theme: string;
}) {
  const accountKey = useAccountKey(data.accountKey || undefined);
  return (
    <ChooseBodyGoalPanel data={data} theme={theme} accountKey={accountKey} />
  );
}
