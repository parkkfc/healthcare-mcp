import "@/index.css";

import { useEffect } from "react";
import { useUser } from "skybridge/web";
import { useToolInfo } from "@/helpers.js";
import { bumpProfile } from "./profile-sync.js";

export default function SaveInbody() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"save-inbody">();

  useEffect(() => {
    if (toolInfo.isSuccess && toolInfo.output.saved) {
      bumpProfile();
    }
  }, [toolInfo]);

  if (!toolInfo.isSuccess) return null;

  const reading = toolInfo.output;
  if (!reading.saved) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} rounded-xl border border-border bg-background p-4 text-foreground`}
      >
        <h2 className="text-lg font-bold">인바디를 저장하지 못했습니다</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {reading.lastMeasuredOn
            ? `마지막 측정 ${reading.lastMeasuredOn}. 약 1달 간격으로 새 결과지를 올려 주세요. 같은 날 수정은 가능합니다.`
            : "결과지를 다시 올려 주세요."}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} rounded-xl border border-border bg-background p-4 text-foreground`}
    >
      <div
        className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm"
        role="status"
      >
        <p className="font-bold text-emerald-700 dark:text-emerald-300">
          인바디 저장 완료
        </p>
        <p className="mt-1 text-muted-foreground">
          {reading.measuredOn} · 체중 {reading.weightKg}kg · 골격근{" "}
          {reading.skeletalMuscleKg}kg · 체지방 {reading.bodyFatKg}kg
        </p>
        <p className="mt-1 text-muted-foreground">
          홈 상태가 바로 갱신됩니다. 이제 매일 식사를 기록하세요.
        </p>
      </div>
    </div>
  );
}
