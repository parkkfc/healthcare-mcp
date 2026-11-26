import "@/index.css";

import { useEffect } from "react";
import { useModelContext, useUser } from "skybridge/web";
import { useToolInfo } from "@/helpers.js";
import { useAccountKey } from "./use-account-key.js";
import { useAssistantContext } from "../hooks/use-assistant-context.js";

const examples = [
  {
    title: "사진 + 한식",
    tip: "그릇 옆에 손바닥이 보이게 찍고, 채팅에 아래처럼 적어요.",
    line: "점심 / 잡곡밥 1공기, 된장국 1그릇, 계란말이 2개, 시금치나물 1줌",
  },
  {
    title: "글만",
    tip: "사진 없이 이름과 양만 적어도 됩니다.",
    line: "아침 / 바나나 1개, 삶은달걀 2개, 커피 1잔, 김치 1줌",
  },
  {
    title: "간식",
    tip: "포장지 영양성분표 사진, 또는 개수로 적어요.",
    line: "간식 / 초코파이 1개",
  },
] as const;

/** Shared UI — home embeds this; show-meal-entry-guide also mounts it. */
export function MealEntryGuidePanel({
  accountKey,
  onClose,
}: {
  accountKey: string;
  onClose?: () => void;
}) {
  const { update } = useModelContext();

  useAssistantContext(
    JSON.stringify({
      view: "meal-entry-guide",
      waitingForUserMeal: true,
      accountKey,
      next:
        "글만·간식은 음식명·양이 오면 write-meal-foods를 note·items(role)·accountKey로 한 번 연다. 사진+밥·국이면 get-hand-size 후 열기 전에 밥·국마다 containerDiameterCm(손 폭 cm × 그릇픽셀÷손바닥픽셀, 손 폭 복사 금지)을 items에 넣고 그 호출 한 번만 한다. 지름 없이 호출하면 카드가 안 열린다. 예시를 기록하지 마라. 입력창에 쓰지 마라.",
    }),
  );

  useEffect(() => {
    void update({
      content: [
        {
          type: "text",
          text: `[식사 입력 안내] 형식을 채팅에 풀어 쓰지 마라. 글만·간식은 음식명·양이 오면 write-meal-foods를 한 번 연다. 사진+밥·국이면 먼저 get-hand-size로 손 폭을 읽고, 카드를 열기 전에 밥·국마다 containerDiameterCm = 손 폭(cm) × (그릇 픽셀 지름 ÷ 손바닥 폭 픽셀)을 items에 넣은 뒤 write-meal-foods를 한 번만 연다. 손 폭 cm를 지름으로 복사 금지. 지름 없이 호출하면 오류로 카드가 안 열린다. 손·그릇이 없으면 밥 11.5·국 13.2 추정값을 넣어라. note=원문, items에 role(밥 rice, 국·찌개 soup, 나물·무침 side 등), accountKey=${accountKey || "(카드 accountKey)"}. 예시 문장을 저장하지 마라. 입력창에 쓰지 마라.`,
          annotations: { audience: ["assistant"] },
        },
      ],
    }).catch(() => undefined);
  }, [accountKey, update]);

  return (
    <div className="min-h-[220px] space-y-4 bg-background p-4 text-foreground">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">식사 이렇게 적어요</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            채팅에{" "}
            <span className="font-semibold text-foreground">
              끼니 / 음식명 양
            </span>
            형식으로 보내 주세요. 반찬 부피는 등록한{" "}
            <span className="font-semibold text-foreground">줌</span>으로 적어요.
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs"
          >
            닫기
          </button>
        ) : null}
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
        <li>한식은 가능하면 그릇 옆 손바닥 사진 1장</li>
        <li>채팅에 음식명과 양(공기·그릇·줌·개·장)</li>
        <li>보내면 밥·국 그릇 높이 카드가 이어서 열립니다</li>
      </ol>

      <div className="space-y-3">
        {examples.map((example) => (
          <div
            key={example.title}
            className="rounded-xl border border-border bg-card p-3 shadow-sm"
          >
            <p className="text-sm font-bold">{example.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{example.tip}</p>
            <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 font-mono text-sm leading-relaxed text-foreground">
              {example.line}
            </p>
          </div>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        예시 문장은 그대로 보내지 말고, 오늘 먹은 음식으로 바꿔 적어요. 밥·국
        열량은 다음 카드에서 그릇·내용물 높이를 맞춘 뒤에 나옵니다.
      </p>
    </div>
  );
}

export default function MealEntryGuide() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"show-meal-entry-guide">();
  const preferred =
    toolInfo.isSuccess && toolInfo.output.accountKey
      ? toolInfo.output.accountKey
      : undefined;
  const accountKey = useAccountKey(preferred);

  if (!toolInfo.isSuccess) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} min-h-[220px] bg-background p-4 text-foreground`}
      >
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <MealEntryGuidePanel accountKey={accountKey} />
    </div>
  );
}
