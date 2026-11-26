import "@/index.css";

import { useMemo, useState } from "react";
import { useUser } from "skybridge/web";
import { resolveHandfulVolumeMl } from "@/handful.js";
import { useCallTool, useToolInfo } from "@/helpers.js";
import handExample from "@/widgets/손사진.png";
import { HostFileImage } from "./components/host-file-image.js";
import { bumpProfile } from "../hooks/profile-sync.js";
import { useAccountKey } from "./use-account-key.js";
import { useAssistantContext } from "../hooks/use-assistant-context.js";

export default function PreviewHandSize() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"preview-hand-size">();
  const accountKey = useAccountKey();
  const [lengthCm, setLengthCm] = useState<number | null>(null);
  const [widthCm, setWidthCm] = useState<number | null>(null);
  const [riceGrams, setRiceGrams] = useState(0);
  const [cupDiameterCm, setCupDiameterCm] = useState(0);
  const [riceHeightCm, setRiceHeightCm] = useState(0);
  const [saved, setSaved] = useState(false);
  const { callTool, isPending } = useCallTool("save-hand-size");

  const reading = toolInfo.isSuccess ? toolInfo.output : null;
  const handLengthCm = lengthCm ?? reading?.handLengthCm ?? 0;
  const handWidthCm = widthCm ?? reading?.handWidthCm ?? 0;
  const handful = useMemo(
    () =>
      resolveHandfulVolumeMl({
        riceGrams,
        cupDiameterCm,
        riceHeightCm,
      }),
    [riceGrams, cupDiameterCm, riceHeightCm],
  );
  const handfulVolumeMl =
    reading?.handfulVolumeMl && reading.handfulVolumeMl > 0 && handful.volumeMl <= 0
      ? reading.handfulVolumeMl
      : handful.volumeMl;

  useAssistantContext(
    toolInfo.isSuccess
      ? JSON.stringify({
          handLengthCm,
          handWidthCm,
          handfulVolumeMl,
          saved,
          accountKey,
        })
      : "",
  );

  if (!toolInfo.isSuccess || !reading) {
    return (
      <div className="min-h-[16rem] rounded-xl border border-border bg-background p-4 text-foreground">
        <p className="text-sm text-muted-foreground">손 치수를 불러오는 중…</p>
      </div>
    );
  }

  const canSave =
    handLengthCm > 0 && handWidthCm > 0 && handfulVolumeMl > 0 && !saved;

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} p-4 bg-background text-foreground rounded-xl border border-border`}
    >
      <h2 className="text-lg font-bold">손 치수 · 1줌 확인</h2>
      <p className="mb-2 text-sm text-muted-foreground">
        아래 사진은 <strong>참고용</strong>입니다. 카드로 손 크기를 재고, 생쌀
        1줌 부피(무게 또는 컵·그릇 지름·높이)를 알려 주세요. 이 값은{" "}
        <strong>한식 반찬 kcal</strong> 줌 계산에 쓰입니다. 한 번만 저장합니다.
      </p>
      <img
        src={handExample}
        alt="카드로 손 크기 재기 + 생쌀 1줌 손모양 참고"
        className="mb-2 max-h-48 w-full rounded-lg bg-white object-contain"
        draggable={false}
      />
      <p className="mb-3 text-xs text-muted-foreground">
        손모양: <strong>네 손가락이 손바닥을 덮는 형태</strong>로 생쌀을 1줌
        쥐면 됩니다.
      </p>
      <HostFileImage
        fileId={reading.photo?.file_id}
        downloadUrl={reading.photoUrl || reading.photo?.download_url}
        alt="올린 손과 카드"
        className="mb-3 max-h-40 w-full rounded-lg object-cover"
      />

      <h3 className="mb-1 text-sm font-semibold">1. 카드로 손 크기</h3>
      <label className="mb-2 block text-sm">
        손 길이 (cm)
        <input
          type="number"
          min={1}
          step={0.1}
          value={handLengthCm || ""}
          onChange={(event) => setLengthCm(Number(event.target.value))}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
        />
      </label>
      <label className="mb-3 block text-sm">
        손바닥 폭 (cm)
        <input
          type="number"
          min={1}
          step={0.1}
          value={handWidthCm || ""}
          onChange={(event) => setWidthCm(Number(event.target.value))}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
        />
      </label>

      <h3 className="mb-1 text-sm font-semibold">2. 생쌀 1줌 부피</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        사진과 같이 생쌀을 손에 쥐고(네 손가락이 손바닥을 덮는 형태), 그 쌀의
        무게(g)를 알려 주세요. 또는 컵·그릇에 넣고 <strong>용기 지름</strong>과{" "}
        <strong>쌀이 쌓인 높이</strong>를 알려 주세요. 둘 중 하나면 됩니다.
      </p>
      <label className="mb-2 block text-sm">
        생쌀 무게 (g)
        <input
          type="number"
          min={0}
          step={1}
          value={riceGrams || ""}
          onChange={(event) => setRiceGrams(Number(event.target.value) || 0)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
        />
      </label>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="block text-sm">
          컵/그릇 지름 (cm)
          <input
            type="number"
            min={0}
            step={0.1}
            value={cupDiameterCm || ""}
            onChange={(event) =>
              setCupDiameterCm(Number(event.target.value) || 0)
            }
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          쌀이 쌓인 높이 (cm)
          <input
            type="number"
            min={0}
            step={0.1}
            value={riceHeightCm || ""}
            onChange={(event) =>
              setRiceHeightCm(Number(event.target.value) || 0)
            }
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
          />
        </label>
      </div>
      <p className="mb-3 text-sm tabular-nums">
        1줌 부피:{" "}
        <span className="font-bold">
          {handfulVolumeMl > 0 ? `${handfulVolumeMl} ml` : "—"}
        </span>
      </p>

      <button
        type="button"
        disabled={isPending || !canSave}
        onClick={() => {
          callTool(
            {
              handLengthCm,
              handWidthCm,
              handfulVolumeMl,
              accountKey,
            },
            {
              onSuccess: () => {
                setSaved(true);
                bumpProfile();
              },
            },
          );
        }}
        className="w-full rounded-lg bg-blue-600 py-3 font-bold text-white disabled:opacity-50"
      >
        {saved
          ? "저장했습니다"
          : isPending
            ? "저장 중..."
            : "손 치수 · 1줌 저장"}
      </button>
    </div>
  );
}
