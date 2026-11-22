import "@/index.css";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { useFiles, useModelContext, useSendFollowUpMessage, useUser } from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { mealPortionKey, parseAmountNote, type MealCuisine, type MealPortionRole } from "@/meal-portions.js";
import {
  defaultVessel,
  lockedVesselDiameterCm,
  MealVesselControls,
  type VesselState,
} from "./components/meal-vessel.js";
import { HostFileImage } from "./components/host-file-image.js";
import { SourceFooter } from "./components/source-footer.js";
import { bumpProfile } from "./profile-sync.js";
import { useAccountKey } from "./use-account-key.js";
import { useAssistantContext } from "./use-assistant-context.js";

const mealSlots = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealSlot = (typeof mealSlots)[number];

const mealLabel: Record<MealSlot, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

type MealPhoto = {
  file_id: string;
  download_url: string;
  mime_type?: string;
  file_name?: string;
};

const emptyPhoto = (): MealPhoto => ({
  file_id: "",
  download_url: "",
  mime_type: "",
  file_name: "",
});

type FoodDraft = {
  name: string;
  role: MealPortionRole;
  cuisine: MealCuisine;
  handfuls: number;
  pieceCount: number;
  amountNote: string;
  nameConfirmed: boolean;
  candidateName: string;
  matchedFoodName: string;
  /** User tapped “목록에 없음”. */
  noneOfCandidates: boolean;
  /** Host: 냄비·팬 등 공유 그릇 → 줌 입력. */
  sharedPot: boolean;
  /** Host photo-estimated rim diameter (cm). 0 = use saved palm width. */
  photoDiameterCm: number;
  vessel: VesselState;
  servingGrams: number;
  servingKcal: number;
  kcalPer100g: number;
  /** kcal of one typed unit (1줌, 1장). Not per gram. */
  kcalPerUnit: number;
  carbPerUnit: number;
  proteinPerUnit: number;
  fatPerUnit: number;
  amountMode: "vessel" | "handful" | "piece" | "text";
};

type SavedNutrition = {
  kcal: number;
  carbG: number;
  proteinG: number;
  fatG: number;
  foods: {
    foodName: string;
    kcal: number;
    carbG: number;
    proteinG: number;
    fatG: number;
    grams?: number;
    role?: string;
    amountSource?: string;
    basis?: string;
    kcalPerBasis?: number;
    slot?: number;
  }[];
};

const roleLabel: Record<string, string> = {
  main: "주식",
  side: "반찬",
  soup: "국",
  rice: "밥",
  meat: "고기",
  fried: "튀김",
  snack: "간식",
};

function fileFromUnknown(item: unknown): MealPhoto | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const file_id =
    (typeof row.file_id === "string" && row.file_id) ||
    (typeof row.fileId === "string" && row.fileId) ||
    "";
  const download_url =
    (typeof row.download_url === "string" && row.download_url) ||
    (typeof row.downloadUrl === "string" && row.downloadUrl) ||
    (typeof row.url === "string" && row.url) ||
    "";
  if (!file_id && !download_url) return null;
  return {
    file_id,
    download_url,
    mime_type:
      (typeof row.mime_type === "string" && row.mime_type) ||
      (typeof row.mimeType === "string" && row.mimeType) ||
      "",
    file_name:
      (typeof row.file_name === "string" && row.file_name) ||
      (typeof row.fileName === "string" && row.fileName) ||
      "",
  };
}

function PhotoCanvas({ file, alt }: { file: File; alt: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    void createImageBitmap(file)
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        const max = 960;
        const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);
  if (failed) {
    return (
      <div className="mb-3 flex h-36 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        {alt}
      </div>
    );
  }
  return (
    <canvas
      ref={ref}
      aria-label={alt}
      className="mb-3 max-h-52 w-full rounded-lg bg-muted object-contain"
    />
  );
}

/** Poll for the host's answer for up to this long (the host only answers on its next turn). */
const MISSING_POLL_MS = 3000;
const MISSING_POLL_MAX_MS = 30 * 60_000;

/** True when 1-unit kcal and at least one macro gram are filled (for charts). */
function unitNutritionReady(prompt: {
  kcalPerUnit: string;
  carbPerUnit: string;
  proteinPerUnit: string;
  fatPerUnit: string;
}) {
  return (
    Number(prompt.kcalPerUnit) > 0 &&
    Number(prompt.carbPerUnit) +
    Number(prompt.proteinPerUnit) +
    Number(prompt.fatPerUnit) >
    0
  );
}

/** Model context + follow-up both carry note/accountKey; follow-up turns often drop modelContext. */
function missingFoodGuide(
  lines: string,
  key: string,
  accountKey: string,
  handfulVolumeMl: number,
) {
  const zoomLine =
    handfulVolumeMl > 0
      ? `줌이면 1줌은 저장된 손 1줌 ${handfulVolumeMl}ml다. 줌을 장·개로 바꾸지 말고 그 1줌 기준이다.`
      : `줌이면 단위를 바꾸지 말고 1줌 기준이다.`;
  return `[먼저 처리·필수] ${lines}은 식품 DB에 같은 이름이 없다. 사용자에게 선택지·이름 변경·잡곡밥만 저장·바코드를 제안하지 마라. 일반 지식으로라도 단위 1개당 kcal·탄수화물g·단백질g·지방g를 정해 즉시 lookup-meal-portions에 kcalPerUnit·carbPerUnit·proteinPerUnit·fatPerUnit을 넣어라(2장이면 1장당). 탄단지가 0이면 홈·기간 차트에 안 잡힌다. DB가 아니라고 멈추지 마라. note·accountKey는 아래 값을 한 글자도 바꾸지 마라. 키를 묻거나 지어내지 마라. ${zoomLine} 사진·손바닥을 다시 요구하지 마라. 채팅에 숫자만 답하지 마라. name은 사용자가 적은 그대로, nameConfirmed는 넣지 마라.\nnote:\n${key}\naccountKey=${accountKey}`;
}

/**
 * Follow-up must include note (+ accountKey). Without note the host invents a key
 * or stops; modelContext alone often does not reach the next turn.
 */
function missingFoodChat(
  lines: string,
  key: string,
  accountKey: string,
  handfulVolumeMl: number,
) {
  const zoom =
    handfulVolumeMl > 0
      ? `줌이면 손 1줌 ${handfulVolumeMl}ml 기준.`
      : `줌이면 손 1줌 기준.`;
  return `${lines}은 식품 DB에 없습니다. 사용자에게 묻지 말고, 이름 바꾸기·일부만 저장·바코드를 제안하지 마세요. 일반 지식으로 단위 1개당 kcal와 탄수화물g·단백질g·지방g를 정해 지금 lookup-meal-portions에 kcalPerUnit·carbPerUnit·proteinPerUnit·fatPerUnit으로 넣으세요. 탄단지가 빠지면 차트에 안 반영됩니다. 채팅에 숫자만 답하지 마세요. note·accountKey는 아래 그대로(지어내지 마세요). 사진·손바닥 재요청 금지. ${zoom}
note:
${key}
accountKey=${accountKey}`;
}

type CandidateOption = {
  foodName: string;
  kcal: number;
  servingWeight: string;
};

type WebPrompt = {
  query: string;
  candidateName: string;
  unit: string;
  kcalPerUnit: string;
  carbPerUnit: string;
  proteinPerUnit: string;
  fatPerUnit: string;
  webMiss: boolean;
  servingGrams: string;
  needsCandidatePick: boolean;
  candidates: CandidateOption[];
  /** Chosen DB name, or "__none__" for 목록에 없음. */
  selectedPick: string;
};

function failureText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.replace(/accountKey=\S+/gi, "").trim();
  if (text.includes("로그인")) {
    return "로그인된 계정에만 저장됩니다. 홈에서 로그인한 뒤 다시 등록해 주세요.";
  }
  return "저장하지 못했습니다. 다시 눌러 주세요.";
}

function draftsFromNote(
  note: string,
  meal: MealSlot,
  handLengthCm: number,
  handWidthCm = 0,
): FoodDraft[] {
  const parts = note
    .split(/[,，、/\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((name) => {
    const lower = name;
    let role: MealPortionRole = "side";
    if (meal === "snack") role = "snack";
    else if (
      /밥|공기밥|흰밥|현미|잡곡|흑미|보리밥|오곡|죽|덮밥|비빔밥|볶음밥/.test(
        lower,
      )
    )
      role = "rice";
    else if (
      /국|찌개|탕|전골|육개장|순두부|청국장|부대|김치찌개|된장|미역|콩나물|설렁|곰탕|해장|라면|우동|국수|칼국수|수제비|짬뽕/.test(
        lower,
      )
    )
      role = "soup";
    else if (/고기|불고기|삼겹|치킨|닭|돼지|소고기|갈비/.test(lower))
      role = "meat";
    else if (/튀김|전|까스|너겟/.test(lower)) role = "fried";
    else if (/면|파스타|피자|스테이크|리조토|샐러드/.test(lower)) role = "main";

    const cuisine: MealCuisine =
      meal === "snack"
        ? "snack"
        : role === "main" && /면|파스타|피자|스테이크|리조토|샐러드/.test(lower)
          ? "western"
          : "korean";

    // Bowl UI only for rice/soup. Pizza·pasta etc. use typed amount (조각·판).
    const amountMode: FoodDraft["amountMode"] =
      meal === "snack"
        ? "piece"
        : role === "rice" || role === "soup"
          ? "vessel"
          : role === "meat" || role === "fried" || role === "side"
            ? "handful"
            : "text";

    return {
      name,
      role,
      cuisine: meal === "snack" ? "snack" : cuisine,
      handfuls: 0,
      pieceCount: 0,
      amountNote: "",
      nameConfirmed: false,
      candidateName: "",
      matchedFoodName: "",
      noneOfCandidates: false,
      sharedPot: false,
      photoDiameterCm: 0,
      vessel: {
        ...defaultVessel(handLengthCm, handWidthCm),
        // Photo meals fill diameter from host/user; keep 0 until then for rice/soup.
        diameterCm:
          role === "rice" || role === "soup"
            ? 0
            : defaultVessel(handLengthCm, handWidthCm).diameterCm,
      },
      servingGrams: 0,
      servingKcal: 0,
      kcalPer100g: 0,
      kcalPerUnit: 0,
      carbPerUnit: 0,
      proteinPerUnit: 0,
      fatPerUnit: 0,
      amountMode,
    };
  });
}

export function MealRecordPanel({
  accountKey,
  date,
  handWidthCm = 0,
  handLengthCm = 0,
  handfulVolumeMl = 0,
}: {
  accountKey: string;
  date: string;
  handWidthCm?: number;
  handLengthCm?: number;
  handfulVolumeMl?: number;
}) {
  return (
    <WriteMealFoods
      embedded
      date={date}
      accountKey={accountKey}
      handWidthCm={handWidthCm}
      handLengthCm={handLengthCm}
      handfulVolumeMl={handfulVolumeMl}
    />
  );
}

export default function WriteMealFoods({
  embedded = false,
  date: dateProp,
  accountKey: accountKeyProp,
  handWidthCm: handWidthProp = 0,
  handLengthCm: handLengthProp = 0,
  handfulVolumeMl: handfulProp = 0,
}: {
  embedded?: boolean;
  date?: string;
  accountKey?: string;
  handWidthCm?: number;
  handLengthCm?: number;
  handfulVolumeMl?: number;
} = {}) {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"write-meal-foods">();
  const { callToolAsync, isPending } = useCallTool("record-meal-photos");
  const { callToolAsync: lookupPortions } = useCallTool("lookup-meal-portions");
  const { getDownloadUrl } = useFiles();
  const { update: updateModelContext } = useModelContext();
  const sendMessage = useSendFollowUpMessage();
  const storedKey = useAccountKey();
  const accountKey = accountKeyProp || storedKey;

  const [note, setNote] = useState("");
  const [meal, setMeal] = useState<MealSlot>("lunch");
  const [saved, setSaved] = useState(false);
  const [nutrition, setNutrition] = useState<SavedNutrition | null>(null);
  const [failed, setFailed] = useState("");
  const [summary, setSummary] = useState("");
  const [picked, setPicked] = useState<File | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [webPrompts, setWebPrompts] = useState<WebPrompt[]>([]);
  const [foodsAccepted, setFoodsAccepted] = useState(false);
  const [portionKey, setPortionKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [cuisine, setCuisine] = useState<MealCuisine>("korean");
  const [drafts, setDrafts] = useState<FoodDraft[]>([]);
  /** Host confirmed palm in photo via vesselHints (handInPhoto true). */
  const [hostSawPalm, setHostSawPalm] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const askedHostRef = useRef({ stamp: "", at: 0 });
  /** True only after kcal 계산 found a DB miss; keeps empty peeks from reopening the panel. */
  const expectMissingRef = useRef(false);
  const webPromptsRef = useRef(webPrompts);
  webPromptsRef.current = webPrompts;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  /** User closed the miss panel for this portion key. */
  const dismissedMissRef = useRef("");

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // A text cursor must not scroll the meal card. The browser scrolls a
  // focused field into view after pointerdown, so keep the position from
  // before that focus and focus the field without scrolling.
  useEffect(() => {
    const root = document.scrollingElement;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflowAnchor;
    const prevBody = body.style.overflowAnchor;
    html.style.overflowAnchor = "none";
    body.style.overflowAnchor = "none";
    let top = root?.scrollTop ?? 0;
    let holdUntil = 0;
    const isTextField = (
      target: EventTarget | null,
    ): target is HTMLInputElement | HTMLTextAreaElement => {
      if (target instanceof HTMLTextAreaElement) return true;
      if (!(target instanceof HTMLInputElement)) return false;
      return (
        target.type === "text" ||
        target.type === "search" ||
        target.type === "number" ||
        target.type === ""
      );
    };
    const hold = () => {
      if (!root) return;
      top = root.scrollTop;
      holdUntil = performance.now() + 700;
    };
    const placeCaret = (target: HTMLElement, x: number, y: number) => {
      const doc = document as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number,
        ) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const position = doc.caretPositionFromPoint?.(x, y);
      const selection = window.getSelection();
      if (!selection) return;
      if (position) {
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      const range = doc.caretRangeFromPoint?.(x, y);
      if (!range || !target.contains(range.startContainer)) return;
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const onPointerDown = (event: Event) => {
      if (!(event instanceof PointerEvent)) return;
      const target = event.target;
      if (!isTextField(target) || target.disabled || target.readOnly) return;
      if (document.activeElement === target) return;
      hold();
      event.preventDefault();
      target.focus({ preventScroll: true });
      placeCaret(target, event.clientX, event.clientY);
    };
    const onKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const target = event.target;
      if (event.key === "Tab" || isTextField(target)) hold();
    };
    const onBeforeInput = (event: Event) => {
      if (isTextField(event.target)) hold();
    };
    const restore = () => {
      if (!root || performance.now() > holdUntil) return;
      if (root.scrollTop !== top) root.scrollTop = top;
    };
    const onInput = (event: Event) => {
      if (!isTextField(event.target)) return;
      restore();
      window.requestAnimationFrame(restore);
    };
    const onScroll = () => {
      restore();
      if (!root || performance.now() < holdUntil) return;
      top = root.scrollTop;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("input", onInput, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      html.style.overflowAnchor = prevHtml;
      body.style.overflowAnchor = prevBody;
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("beforeinput", onBeforeInput, true);
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  const hostPhoto = useMemo(() => {
    if (embedded || !toolInfo.isSuccess) return emptyPhoto();
    const buckets = [
      toolInfo.output.photos,
      toolInfo.input?.photos,
      toolInfo.input?.photo ? [toolInfo.input.photo] : [],
    ];
    for (const bucket of buckets) {
      if (!Array.isArray(bucket) || bucket.length === 0) continue;
      const parsed = fileFromUnknown(bucket[0]);
      if (parsed) return parsed;
    }
    return emptyPhoto();
  }, [embedded, toolInfo]);

  const day =
    embedded && dateProp
      ? dateProp
      : toolInfo.isSuccess
        ? toolInfo.output.date
        : "";

  const measuredWidth =
    handWidthProp > 0
      ? handWidthProp
      : toolInfo.isSuccess && typeof toolInfo.output.handWidthCm === "number"
        ? toolInfo.output.handWidthCm
        : 0;
  const measuredLength =
    handLengthProp > 0
      ? handLengthProp
      : toolInfo.isSuccess && typeof toolInfo.output.handLengthCm === "number"
        ? toolInfo.output.handLengthCm
        : 0;
  const handfulVolumeMl =
    handfulProp > 0
      ? handfulProp
      : toolInfo.isSuccess && typeof toolInfo.output.handfulVolumeMl === "number"
        ? toolInfo.output.handfulVolumeMl
        : 0;

  /** Chat-attached photo that the host vision can actually see. */
  const hasHostPhoto =
    Boolean(hostPhoto.file_id || hostPhoto.download_url) ||
    (!embedded &&
      toolInfo.isSuccess &&
      typeof toolInfo.output.photoCount === "number" &&
      toolInfo.output.photoCount > 0);
  /** Local preview or host photo — not enough alone for AI diameter. */
  const hasPhoto = Boolean(picked) || hasHostPhoto;

  const ready = note.replace(/\s+/g, " ").trim().length > 0;
  const textOnly = !hasPhoto && meal !== "snack";
  const needsHand = !textOnly && meal !== "snack";

  useAssistantContext(
    !embedded
      ? JSON.stringify({
        meal,
        note: note.trim(),
        ready,
        saved,
        hasPhoto,
        cuisine,
        accountKey,
        amounts: drafts
          .filter((draft) => draft.amountMode !== "vessel")
          .map((draft) => ({
            name: draft.name,
            amountNote: draft.amountNote.trim(),
          })),
        missingDbFoods: webPrompts.map((prompt) => ({
          query: prompt.query,
          candidateName: prompt.candidateName,
          unit: prompt.unit,
          kcalPerUnit: Number(prompt.kcalPerUnit) || 0,
          carbPerUnit: Number(prompt.carbPerUnit) || 0,
          proteinPerUnit: Number(prompt.proteinPerUnit) || 0,
          fatPerUnit: Number(prompt.fatPerUnit) || 0,
          servingGrams: Number(prompt.servingGrams) || 0,
        })),
        handfulVolumeMl,
        amountGuide:
          webPrompts.some((prompt) => !unitNutritionReady(prompt))
            ? missingFoodGuide(
              webPrompts
                .filter((prompt) => !unitNutritionReady(prompt))
                .map((prompt) => `${prompt.query} · ${prompt.unit || "개"}`)
                .join(", "),
              portionKey,
              accountKey,
              handfulVolumeMl,
            )
            : "줌은 반찬 부피(손 1줌)다. 장·개·봉지 등 다른 단위는 사용자가 적은 그대로 판단해 pieceCount와, 무게를 알면 1단위 servingGrams를 lookup-meal-portions에 넣어라. kcal·탄단지는 g당이 아니라 그 단위 1개 기준이다. 줌/갯수를 고르라고 하지 마라. 입력창에는 쓰지 마라.",
      })
      : "",
  );

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function forgetPortion() {
    stopPoll();
    expectMissingRef.current = false;
    setWaiting(false);
    setPortionKey("");
    setConfirmed(false);
    setWebPrompts([]);
    setFoodsAccepted(false);
    if (!saved) setNutrition(null);
  }

  function applyPortionFoods(foods: unknown): boolean {
    if (!Array.isArray(foods) || foods.length === 0) return false;
    const parsed = foods.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const foodName = String(row.foodName ?? row.query ?? "").trim();
      const grams = Number(row.grams);
      if (!foodName || !(grams > 0)) return [];
      return [
        {
          foodName,
          grams,
          kcal: Number(row.kcal) || 0,
          carbG: Number(row.carbG) || 0,
          proteinG: Number(row.proteinG) || 0,
          fatG: Number(row.fatG) || 0,
          role: typeof row.role === "string" ? row.role : "",
          amountSource:
            typeof row.amountSource === "string" ? row.amountSource : "",
          basis: typeof row.basis === "string" ? row.basis : "",
          kcalPerBasis: Number(row.kcalPerBasis) || 0,
          slot: Number(row.slot) || 1,
        },
      ];
    });
    if (parsed.length === 0) return false;
    setNutrition({
      kcal: parsed.reduce((sum, food) => sum + food.kcal, 0),
      carbG:
        Math.round(parsed.reduce((sum, food) => sum + food.carbG, 0) * 10) / 10,
      proteinG:
        Math.round(parsed.reduce((sum, food) => sum + food.proteinG, 0) * 10) /
        10,
      fatG:
        Math.round(parsed.reduce((sum, food) => sum + food.fatG, 0) * 10) / 10,
      foods: parsed,
    });
    setWaiting(false);
    setFailed("");
    return true;
  }

  function normalizeName(value: string) {
    return value.replace(/\s+/g, "").toLowerCase();
  }

  function applyVesselHints(foods: unknown): boolean {
    if (!Array.isArray(foods) || foods.length === 0) return false;
    if (
      foods.some((item) => {
        if (!item || typeof item !== "object") return false;
        const row = item as Record<string, unknown>;
        return row.handMissing === true || row.needsHandRetry === true;
      })
    ) {
      return false;
    }
    const base =
      drafts.length > 0
        ? drafts
        : draftsFromNote(note, meal, measuredLength, measuredWidth);
    const unused = new Set(
      foods.flatMap((item, index) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return row.needsVesselHint === true ? [index] : [];
      }),
    );
    let changed = false;
    let sawPalm = false;
    const next = base.map((draft) => {
      const findHit = (): Record<string, unknown> | undefined => {
        for (const index of unused) {
          const item = foods[index];
          if (!item || typeof item !== "object") continue;
          const row = item as Record<string, unknown>;
          const query = String(row.query ?? row.foodName ?? "").trim();
          if (normalizeName(query) === normalizeName(draft.name)) {
            unused.delete(index);
            return row;
          }
        }
        for (const index of unused) {
          const item = foods[index];
          if (!item || typeof item !== "object") continue;
          const row = item as Record<string, unknown>;
          const query = normalizeName(
            String(row.query ?? row.foodName ?? "").trim(),
          );
          const name = normalizeName(draft.name);
          if (query && name && (query.includes(name) || name.includes(query))) {
            unused.delete(index);
            return row;
          }
        }
        if (draft.role === "rice" || draft.role === "soup") {
          const roleHits = [...unused].flatMap((index) => {
            const item = foods[index];
            if (!item || typeof item !== "object") return [];
            const row = item as Record<string, unknown>;
            const role = String(row.role ?? "");
            return role === draft.role ? [{ index, row }] : [];
          });
          if (roleHits.length === 1) {
            unused.delete(roleHits[0].index);
            return roleHits[0].row;
          }
        }
        return undefined;
      };
      const hit = findHit();
      if (!hit || hit.needsVesselHint !== true) return draft;
      changed = true;
      const shared = hit.sharedPot === true;
      const photoD = Number(hit.photoDiameterCm) || 0;
      const thick = Number(hit.thicknessCm) || 0;
      if (hit.handInPhoto === true || (!shared && photoD > 0)) sawPalm = true;
      if (shared) {
        return {
          ...draft,
          sharedPot: true,
          photoDiameterCm: 0,
          amountMode: "text" as const,
          amountNote: draft.amountNote.trim() || "",
        };
      }
      const diameterCm =
        photoD > 0
          ? photoD
          : lockedVesselDiameterCm(measuredLength, measuredWidth);
      return {
        ...draft,
        sharedPot: false,
        photoDiameterCm: photoD > 0 ? photoD : draft.photoDiameterCm,
        amountMode: "vessel" as const,
        vessel: {
          ...draft.vessel,
          diameterCm,
          heightCm:
            thick > 0
              ? thick
              : draft.vessel.heightCm ||
              defaultVessel(measuredLength, measuredWidth).heightCm,
        },
      };
    });
    if (changed) {
      draftsRef.current = next;
      setDrafts(next);
      if (sawPalm) setHostSawPalm(true);
      setWaiting(false);
    }
    return changed;
  }

  /** True only when portion foods were applied. Still-waiting is not done. */
  async function peekPortion(key: string): Promise<boolean> {
    try {
      const result = await lookupPortions({ note: key, accountKey });
      const out = result.structuredContent as
        | (Record<string, unknown> & {
          foods?: unknown;
          needsVesselHints?: boolean;
          needsWebConfirm?: boolean;
          handMissing?: boolean;
          needsHandRetry?: boolean;
          handInPhoto?: boolean;
          ok?: boolean;
          message?: string;
        })
        | null
        | undefined;
      const foodsMissingHand =
        Array.isArray(out?.foods) &&
        out.foods.some((item) => {
          if (!item || typeof item !== "object") return false;
          const row = item as Record<string, unknown>;
          return (
            row.handMissing === true ||
            row.needsHandRetry === true ||
            row.handInPhoto === false
          );
        });
      if (
        out?.handMissing === true ||
        out?.needsHandRetry === true ||
        out?.handInPhoto === false ||
        foodsMissingHand
      ) {
        stopPoll();
        setWaiting(false);
        setHostSawPalm(false);
        setFailed(
          out?.message ||
          "사진에 손바닥이 보이지 않아 그릇 지름을 판별할 수 없습니다. 그릇 옆에 손바닥을 두고 다시 찍어 올려 주세요.",
        );
        return false;
      }
      if (out?.needsVesselHints && applyVesselHints(out.foods)) {
        setWaiting(false);
        // Hints are applied; keep polling briefly so host can refine, but unlock UI.
        return false;
      }
      const prompts = out ? readWebPrompts(out) : null;
      if (prompts) {
        const hasActionable = prompts.some(
          (prompt) =>
            prompt.needsCandidatePick || unitNutritionReady(prompt),
        );
        // Do not reopen an empty "not in DB" panel from background peeks
        // (구성 확인, 폴링) after the user closed it or never asked.
        if (
          !hasActionable &&
          webPromptsRef.current.length === 0 &&
          !expectMissingRef.current
        ) {
          return false;
        }
        if (!hasActionable && dismissedMissRef.current === key) {
          return false;
        }
        setWebPrompts((prev) =>
          prompts.map((prompt) => {
            const older = prev.find((item) => item.query === prompt.query);
            if (!older) return prompt;
            // Already answered: do not overwrite what the user is reviewing.
            if (unitNutritionReady(older)) return older;
            if (older.needsCandidatePick && older.selectedPick) return older;
            return {
              ...prompt,
              candidateName:
                prompt.candidateName && prompt.candidateName !== prompt.query
                  ? prompt.candidateName
                  : older.candidateName || prompt.candidateName,
              kcalPerUnit: prompt.kcalPerUnit || older.kcalPerUnit,
              carbPerUnit: prompt.carbPerUnit || older.carbPerUnit,
              proteinPerUnit: prompt.proteinPerUnit || older.proteinPerUnit,
              fatPerUnit: prompt.fatPerUnit || older.fatPerUnit,
              webMiss: unitNutritionReady(prompt) ? false : prompt.webMiss,
              unit: prompt.unit || older.unit,
              servingGrams: prompt.servingGrams || older.servingGrams,
              needsCandidatePick:
                prompt.needsCandidatePick || older.needsCandidatePick,
              candidates:
                prompt.candidates.length > 0
                  ? prompt.candidates
                  : older.candidates,
              selectedPick: older.selectedPick || prompt.selectedPick,
            };
          }),
        );
        setWaiting(false);
        const picksReady = prompts.every(
          (prompt) =>
            prompt.needsCandidatePick || unitNutritionReady(prompt),
        );
        if (picksReady) {
          expectMissingRef.current = false;
          stopPoll();
        }
        return false;
      }
      if (out?.ok && applyPortionFoods(out.foods)) {
        stopPoll();
        expectMissingRef.current = false;
        dismissedMissRef.current = "";
        setWebPrompts([]);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function buildFoodsPayload(source: FoodDraft[] = drafts) {
    return source.map((draft) => {
      const base = {
        slot: 1,
        meal,
        name: draft.name,
        role: draft.role,
        cuisine: textOnly ? ("text" as const) : draft.cuisine,
        densityGPerMl: 1,
        handfulVolumeMl,
        servingGrams: draft.servingGrams || undefined,
        servingKcal: draft.servingKcal || undefined,
        kcalPerUnit: draft.kcalPerUnit || undefined,
        carbPerUnit: draft.carbPerUnit || undefined,
        proteinPerUnit: draft.proteinPerUnit || undefined,
        fatPerUnit: draft.fatPerUnit || undefined,
        nameConfirmed: draft.nameConfirmed || undefined,
        candidateName: draft.candidateName.trim() || undefined,
        matchedFoodName: draft.matchedFoodName.trim() || undefined,
        noneOfCandidates: draft.noneOfCandidates || undefined,
      };
      if (draft.amountMode === "vessel") {
        const requirePhoto = hasHostPhoto && !textOnly;
        const diameterCm =
          draft.vessel.diameterCm > 0
            ? draft.vessel.diameterCm
            : lockedVesselDiameterCm(
              measuredLength,
              measuredWidth,
              draft.photoDiameterCm > 0 ? draft.photoDiameterCm : undefined,
              requirePhoto,
            );
        return {
          ...base,
          containerDiameterCm: diameterCm > 0 ? diameterCm : undefined,
          thicknessCm: draft.vessel.heightCm,
          coverage: 1,
          curvature: 0.35,
          fillRatio: draft.vessel.fillRatio,
          servings: draft.vessel.servings,
        };
      }
      // 사용자가 적은 단위. 줌은 부피, 그 외는 개수. 기준 g는 서버·AI가 판단.
      const noted = parseAmountNote(draft.amountNote);
      return {
        ...base,
        amountNote: draft.amountNote.trim() || undefined,
        handfuls: noted.handfuls > 0 ? noted.handfuls : undefined,
        pieceCount:
          noted.handfuls > 0
            ? undefined
            : noted.count > 0
              ? noted.count
              : undefined,
        grams: draft.servingGrams || undefined,
      };
    });
  }

  function vesselPhotoGuide(key: string, foodLines: string) {
    return `[먼저 처리·필수] 식사 사진의 밥·국 그릇 지름을 저장된 손바닥 폭 ${measuredWidth || "?"}cm·손 길이 ${measuredLength || "?"}cm와 비교해 판별하라. 손바닥이 없으면 handInPhoto=false로 vesselHints를 호출하고 지름을 넣지 마라. 있으면 지금 lookup-meal-portions에 vesselHints만 넣어라. 개인 공기·국그릇은 사진 속 손·그릇 상단 외경 픽셀 비율×손 폭으로 containerDiameterCm·thicknessCm을 넣고, 손 폭을 지름으로 복사하지 마라. 참고 앵커: 스텐 밥공기 약 10.5cm, 가정용 도자기 밥 11.3~12.5cm, 국그릇 12.5~13.8cm, 냉면·우동·큰 면기 17~21cm. 냄비·후라이팬·전골냄비·큰 뚝배기면 sharedPot true. handInPhoto·palmComparison 필수. 사용자에게 지름을 묻지 마라. 채팅에 숫자만 답하지 마라. note·accountKey는 아래 그대로.\n대상: ${foodLines}\nnote:\n${key}\naccountKey=${accountKey}`;
  }

  function vesselsNeedPhotoDiameter(list: FoodDraft[]) {
    if (!hasHostPhoto || textOnly || embedded) return [];
    return list.filter(
      (draft) =>
        (draft.role === "rice" || draft.role === "soup") &&
        draft.amountMode === "vessel" &&
        !draft.sharedPot &&
        !(draft.photoDiameterCm > 0) &&
        !(draft.vessel.diameterCm > 0),
    );
  }

  async function askHostForVesselDiameter(
    key: string,
    list: FoodDraft[],
  ): Promise<boolean> {
    const pending = vesselsNeedPhotoDiameter(list);
    if (pending.length === 0) return true;
    if (!hasHostPhoto || embedded) {
      setWaiting(false);
      setFailed(
        "사진으로 그릇 지름을 판별하려면 GPT,Claude 채팅창에 손바닥과 식단 사진을 함께 올려 주세요.",
      );
      return false;
    }
    const foodLines = pending.map((draft) => draft.name).join(", ");
    const text = vesselPhotoGuide(key, foodLines);
    await updateModelContext({
      content: [
        {
          type: "text",
          text,
          annotations: { audience: ["assistant"] },
        },
      ],
    }).catch(() => undefined);
    const stamp = `vessel:${key}\n${foodLines}`;
    const recent =
      askedHostRef.current.stamp === stamp &&
      Date.now() - askedHostRef.current.at < 3000;
    if (recent) return true;
    askedHostRef.current = { stamp, at: Date.now() };
    try {
      await sendMessage(
        `${foodLines} 밥·국 그릇 지름을 사진 손바닥과 비교해 지금 lookup-meal-portions vesselHints에 넣으세요. 손 폭을 그대로 지름으로 쓰지 마세요. 냄비·팬이면 sharedPot true. note·accountKey는 아래 그대로.
note:
${key}
accountKey=${accountKey}`,
      );
      return true;
    } catch {
      askedHostRef.current = { stamp: "", at: 0 };
      stopPoll();
      setWaiting(false);
      setFailed(
        "자동으로 사진 판별 요청을 보내지 못했습니다. 채팅창에 '그릇 지름 확인해 줘'라고 입력하거나 아래에서 그릇 크기를 직접 선택해 주세요.",
      );
      return false;
    }
  }

  async function askHost(key: string) {
    const handLine =
      measuredWidth > 0
        ? `손바닥 폭 ${measuredWidth}cm, 손 길이 ${measuredLength || "?"}cm, 1줌 ${handfulVolumeMl || "?"}ml.`
        : "손 치수 없음(글만·기준 분량 가능).";
    const instruction = textOnly
      ? `사진 없이 글만으로 식사 열량을 계산하라. ${handLine} 음식마다 사용자가 적은 amountNote(1줌, 2장, 3개 등)를 그대로 써라. 줌은 손 1줌 부피다. 그 외 단위는 네가 1단위 g와 개수를 판단해 servingGrams·pieceCount에 넣어라. 양(g)은 인터넷에서 추측하지 마라. cuisine=text. lookup-meal-portions를 호출하라. note:\n${key}\naccountKey=${accountKey}.`
      : meal === "snack"
        ? `간식 포장지(성분표) 사진을 보고 사용자가 적은 단위 1개당 kcal를 읽어라. ${handLine} 먹은 양은 사용자가 적은 amountNote 그대로다. 줌은 저장된 손 1줌 부피고, 장·개·봉지 등은 그 1단위 kcal다. g당으로 넣지 마라. cuisine=snack, role=snack. lookup-meal-portions 호출. note:\n${key}\naccountKey=${accountKey}.`
        : vesselPhotoGuide(
          key,
          drafts
            .filter((d) => d.role === "rice" || d.role === "soup")
            .map((d) => d.name)
            .join(", ") || "밥·국",
        );
    try {
      void updateModelContext({
        content: [
          {
            type: "text",
            text: instruction,
            annotations: { audience: ["assistant"] },
          },
        ],
      }).catch(() => undefined);
    } catch {
      /* host may ignore */
    }
  }

  async function startClassify() {
    if (!ready || isPending || saved || waiting) return;
    if (meal === "snack" && !hasPhoto && drafts.every((d) => !d.servingGrams)) {
      setFailed("간식은 포장지(성분표) 사진을 찍어 주세요. 또는 기준 분량을 직접 넣으세요.");
    }
    if (needsHand && (measuredWidth <= 0 || !(handfulVolumeMl > 0))) {
      setFailed("손 치수·1줌을 먼저 저장해야 사진·줌·그릇으로 계산할 수 있습니다.");
      return;
    }
    const nextDrafts =
      drafts.length > 0
        ? drafts
        : draftsFromNote(note, meal, measuredLength, measuredWidth);
    setDrafts(nextDrafts);
    setCuisine(meal === "snack" ? "snack" : textOnly ? "text" : "korean");
    const key = mealPortionKey([{ slot: 1, meal, note: note.trim() }]);
    setFailed("");
    setNutrition(null);
    setConfirmed(false);
    setPortionKey(key);
    expectMissingRef.current = false;
    setWebPrompts([]);
    setFoodsAccepted(false);
    stopPoll();
    const needDiameter = vesselsNeedPhotoDiameter(nextDrafts).length > 0;
    setWaiting(needDiameter);
    setHostSawPalm(false);
    await askHost(key);
    if (needDiameter) {
      const sent = await askHostForVesselDiameter(key, nextDrafts);
      if (!sent) return;
    }
    if (await peekPortion(key)) {
      setWaiting(false);
      return;
    }
    if (!needDiameter) {
      setWaiting(false);
      return;
    }
    let tries = 0;
    pollRef.current = setInterval(() => {
      tries += 1;
      void (async () => {
        await peekPortion(key);
        const still = vesselsNeedPhotoDiameter(
          draftsRef.current.length > 0 ? draftsRef.current : nextDrafts,
        );
        if (still.length === 0) {
          stopPoll();
          setWaiting(false);
          return;
        }
        if (tries >= 30) {
          stopPoll();
          setWaiting(false);
          setFailed(
            "사진에서 밥·국 그릇 지름을 아직 못 읽었습니다. kcal 계산을 다시 눌러 주세요.",
          );
        }
      })();
    }, MISSING_POLL_MS);
  }

  function readWebPrompts(out: {
    needsWebConfirm?: boolean;
    foods?: unknown;
  }): WebPrompt[] | null {
    if (!out.needsWebConfirm || !Array.isArray(out.foods)) return null;
    const prompts = out.foods.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const query = String(row.query ?? row.foodName ?? "").trim();
      if (!query) return [];
      const kcal = Number(row.kcalPerUnit) || Number(row.kcalPerBasis) || 0;
      const serving = Number(row.servingGrams) || 0;
      const unit = String(row.unit ?? "").trim() || "개";
      const candidates = Array.isArray(row.candidates)
        ? row.candidates.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const cand = entry as Record<string, unknown>;
          const foodName = String(cand.foodName ?? "").trim();
          if (!foodName) return [];
          return [
            {
              foodName,
              kcal: Number(cand.kcal) || 0,
              servingWeight: String(cand.servingWeight ?? ""),
            } satisfies CandidateOption,
          ];
        })
        : [];
      const needsCandidatePick =
        row.needsCandidatePick === true && candidates.length > 0;
      return [
        {
          query,
          candidateName: String(row.foodName ?? query),
          unit,
          kcalPerUnit: kcal > 0 ? String(kcal) : "",
          carbPerUnit: String(Number(row.carbPerUnit) || 0),
          proteinPerUnit: String(Number(row.proteinPerUnit) || 0),
          fatPerUnit: String(Number(row.fatPerUnit) || 0),
          webMiss:
            !needsCandidatePick &&
            (row.webMiss === true || !unitNutritionReady({
              kcalPerUnit: kcal > 0 ? String(kcal) : "",
              carbPerUnit: String(Number(row.carbPerUnit) || 0),
              proteinPerUnit: String(Number(row.proteinPerUnit) || 0),
              fatPerUnit: String(Number(row.fatPerUnit) || 0),
            })),
          servingGrams: serving > 0 ? String(serving) : "",
          needsCandidatePick,
          candidates,
          selectedPick: "",
        } satisfies WebPrompt,
      ];
    });
    return prompts;
  }

  async function askHostForMissingKcal(
    lines: string,
    key: string,
  ): Promise<void> {
    await updateModelContext({
      content: [
        {
          type: "text",
          text: missingFoodGuide(lines, key, accountKey, handfulVolumeMl),
          annotations: { audience: ["assistant"] },
        },
      ],
    }).catch(() => undefined);
    const stamp = `${key}\n${lines}`;
    const recent =
      askedHostRef.current.stamp === stamp &&
      Date.now() - askedHostRef.current.at < 3000;
    if (recent) return;
    askedHostRef.current = { stamp, at: Date.now() };
    try {
      await sendMessage(
        missingFoodChat(lines, key, accountKey, handfulVolumeMl),
      );
    } catch {
      askedHostRef.current = { stamp: "", at: 0 };
      setFailed("채팅으로 확인 요청을 보내지 못했습니다. kcal 계산을 다시 눌러 주세요.");
    }
  }

  async function confirmKcal(override?: FoodDraft[]) {
    if (!ready || isPending || saved) return;
    const list =
      override ??
      (drafts.length > 0
        ? drafts
        : draftsFromNote(note, meal, measuredLength, measuredWidth));
    if (list.length === 0) {
      setFailed("음식 이름을 적어 주세요.");
      return;
    }
    setDrafts(list);
    if (
      needsHand &&
      !(handfulVolumeMl > 0) &&
      list.some((draft) => parseAmountNote(draft.amountNote).handfuls > 0)
    ) {
      setFailed("줌은 반찬 부피라 손 1줌이 있어야 계산됩니다.");
      return;
    }
    if (
      list.some(
        (draft) =>
          draft.amountMode !== "vessel" && draft.amountNote.trim().length === 0,
      )
    ) {
      setFailed("양을 단위와 함께 적어 주세요. 예: 1줌, 2장, 3개");
      return;
    }
    const key =
      portionKey || mealPortionKey([{ slot: 1, meal, note: note.trim() }]);
    setPortionKey(key);
    const needDiameter = vesselsNeedPhotoDiameter(list);
    if (needDiameter.length > 0) {
      setFailed("");
      setWaiting(true);
      const sent = await askHostForVesselDiameter(key, list);
      if (!sent) return;
      stopPoll();
      const startedAt = Date.now();
      pollRef.current = setInterval(() => {
        if (Date.now() - startedAt > MISSING_POLL_MAX_MS) {
          stopPoll();
          setWaiting(false);
          setFailed(
            "사진에서 밥·국 그릇 지름을 아직 못 읽었습니다. 다시 눌러 주세요.",
          );
          return;
        }
        void (async () => {
          await peekPortion(key);
          if (vesselsNeedPhotoDiameter(draftsRef.current).length === 0) {
            stopPoll();
            setWaiting(false);
            void confirmKcal(draftsRef.current);
          }
        })();
      }, MISSING_POLL_MS);
      return;
    }
    setFailed("");
    setWaiting(true);
    try {
      const payload = buildFoodsPayload(list);
      const result = await Promise.race([
        lookupPortions({
          note: key,
          handInPhoto: hostSawPalm ? true : undefined,
          palmComparison:
            hostSawPalm && measuredWidth > 0
              ? `저장된 손바닥 폭 ${measuredWidth}cm를 기준으로 사진 속 그릇 지름을 비교함`
              : "",
          foods: payload.length
            ? payload
            : list.map((draft) => ({
              slot: 1,
              meal,
              name: draft.name,
              role: draft.role,
              cuisine: textOnly ? "text" : draft.cuisine,
              handfuls: parseAmountNote(draft.amountNote).handfuls || undefined,
              pieceCount:
                parseAmountNote(draft.amountNote).handfuls > 0
                  ? undefined
                  : parseAmountNote(draft.amountNote).count || undefined,
              amountNote: draft.amountNote.trim() || undefined,
              handfulVolumeMl,
              containerDiameterCm:
                draft.amountMode === "vessel"
                  ? (draft.vessel.diameterCm > 0
                    ? draft.vessel.diameterCm
                    : lockedVesselDiameterCm(
                      measuredLength,
                      measuredWidth,
                      draft.photoDiameterCm > 0
                        ? draft.photoDiameterCm
                        : undefined,
                      hasHostPhoto && !textOnly,
                    )) || undefined
                  : undefined,
              thicknessCm:
                draft.amountMode === "vessel" ? draft.vessel.heightCm : undefined,
              coverage: draft.amountMode === "vessel" ? 1 : undefined,
              fillRatio:
                draft.amountMode === "vessel" ? draft.vessel.fillRatio : undefined,
              servings:
                draft.amountMode === "vessel"
                  ? draft.vessel.servings
                  : undefined,
              servingGrams: draft.servingGrams || undefined,
              servingKcal: draft.servingKcal || undefined,
            })),
          accountKey,
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("열량 계산이 너무 오래 걸립니다. 다시 눌러 주세요.")),
            20000,
          );
        }),
      ]);
      const out = result.structuredContent;
      const prompts = out ? readWebPrompts(out) : null;
      if (prompts) {
        dismissedMissRef.current = "";
        setFoodsAccepted(false);
        setConfirmed(false);
        setNutrition(null);
        setFailed("");
        const pickPrompts = prompts.filter(
          (prompt) => prompt.needsCandidatePick,
        );
        const missingNutrition = prompts.filter(
          (prompt) =>
            !prompt.needsCandidatePick && !unitNutritionReady(prompt),
        );
        expectMissingRef.current = missingNutrition.length > 0;
        setWebPrompts(prompts);
        setWaiting(false);
        if (pickPrompts.length > 0 && missingNutrition.length === 0) {
          // List is ready for the user; host may refine order via alsoSearch.
          await updateModelContext({
            content: [
              {
                type: "text",
                text: `[카드 후보] ${pickPrompts.map((p) => p.query).join(", ")} — 사진과 비슷한 순으로 candidatePicks·동의어 alsoSearch를 같은 note·accountKey로 lookup-meal-portions에 넣을 수 있다. 사용자가 고르기 전에는 matchedFoodName·nameConfirmed 금지. 이름 변경을 묻지 마라.\nnote:\n${key}\naccountKey=${accountKey}`,
                annotations: { audience: ["assistant"] },
              },
            ],
          }).catch(() => undefined);
          stopPoll();
          return;
        }
        if (missingNutrition.length === 0) {
          stopPoll();
          return;
        }
        const lines = missingNutrition
          .map((prompt) => {
            const draft = list.find((item) => item.name === prompt.query);
            const amount =
              draft?.amountNote.trim() || `1${prompt.unit || "개"}`;
            return `${prompt.query} ${amount}`;
          })
          .join(", ");
        await askHostForMissingKcal(lines, key);
        stopPoll();
        const startedAt = Date.now();
        pollRef.current = setInterval(() => {
          if (Date.now() - startedAt > MISSING_POLL_MAX_MS) {
            stopPoll();
            return;
          }
          void peekPortion(key);
        }, MISSING_POLL_MS);
        return;
      }
      if (out?.ok && applyPortionFoods(out.foods)) {
        stopPoll();
        expectMissingRef.current = false;
        dismissedMissRef.current = "";
        setWebPrompts([]);
        setConfirmed(true);
        setWaiting(false);
        return;
      }
      setFailed(out?.message || "확인에 실패했습니다. 분량을 다시 조절해 주세요.");
      setWaiting(false);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      setFailed(
        raw.includes("너무 오래")
          ? raw
          : failureText(error),
      );
      setWaiting(false);
    }
  }

  async function resolvePhoto(photo: MealPhoto): Promise<MealPhoto | undefined> {
    if (!photo.file_id && !photo.download_url) return undefined;
    let download_url = photo.download_url;
    if (!download_url && photo.file_id) {
      try {
        const fresh = await getDownloadUrl({ fileId: photo.file_id });
        download_url = fresh.downloadUrl;
      } catch {
        /* host may not support file API */
      }
    }
    if (!photo.file_id || !download_url) return undefined;
    return {
      file_id: photo.file_id,
      download_url,
      mime_type: photo.mime_type,
      file_name: photo.file_name,
    };
  }

  if (!embedded && !toolInfo.isSuccess) {
    return (
      <div
        className={`${theme === "dark" ? "dark" : ""} min-h-[200px] p-4 bg-background text-foreground`}
      >
        식사 기록 카드를 불러오는 중…
      </div>
    );
  }

  const estimated = confirmed && nutrition != null && nutrition.foods.length > 0;

  return (
    <form
      className={`${theme === "dark" ? "dark" : ""} flex min-h-[280px] flex-col bg-background text-foreground [overflow-anchor:none]`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || isPending || saved || !estimated || !nutrition) return;
        setFailed("");
        void (async () => {
          const photo = await resolvePhoto(hostPhoto);
          const foods = nutrition.foods
            .filter((food) => (food.grams ?? 0) > 0)
            .map((food) => ({
              foodName: food.foodName,
              grams: food.grams ?? 0,
              kcal: food.kcal,
              carbG: food.carbG,
              proteinG: food.proteinG,
              fatG: food.fatG,
            }));
          if (foods.length === 0) {
            setFailed("계산된 분량이 없습니다. 확인을 다시 눌러 주세요.");
            return;
          }
          try {
            const result = await callToolAsync({
              date: day,
              meal,
              entries: [
                {
                  meal,
                  note: note.trim(),
                  foods,
                  ...(photo ? { photo } : {}),
                },
              ],
              accountKey,
            });
            const out = result.structuredContent;
            if (!out?.ok) {
              setFailed("저장하지 못했습니다. 다시 눌러 주세요.");
              return;
            }
            setSummary(
              `${day} 저장 완료 · ${mealLabel[meal]} ${out.foodCount}개·${out.kcal}kcal`,
            );
            setNutrition({
              kcal: Number(out.kcal) || 0,
              carbG: Number(out.carbG) || 0,
              proteinG: Number(out.proteinG) || 0,
              fatG: Number(out.fatG) || 0,
              foods: Array.isArray(out.foods)
                ? out.foods.map((food) => ({
                  foodName: String(food.foodName ?? ""),
                  kcal: Number(food.kcal) || 0,
                  carbG: Number(food.carbG) || 0,
                  proteinG: Number(food.proteinG) || 0,
                  fatG: Number(food.fatG) || 0,
                }))
                : nutrition.foods,
            });
            setSaved(true);
            bumpProfile();
          } catch (error) {
            setFailed(failureText(error));
          }
        })();
      }}
    >
      <div className="flex-1 space-y-3 p-4 pb-28">
        <div>
          <h2 className="text-lg font-bold">{day} · 식사 등록</h2>
          <p className="mt-1 text-sm font-medium text-amber-800 dark:text-amber-200">
            한 번에 한 끼만 · 사진은 최대 1장(없어도 글만으로 기록 가능)
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
            끼니
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {mealSlots.map((option) => (
              <button
                key={option}
                type="button"
                disabled={saved}
                onClick={() => {
                  setMeal(option);
                  forgetPortion();
                  setDrafts([]);
                }}
                className={`rounded-lg border px-3 py-1.5 text-sm font-bold disabled:opacity-60 ${meal === option
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-border bg-background"
                  }`}
              >
                {mealLabel[option]}
              </button>
            ))}
          </div>

          {meal === "snack" ? (
            <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              과자·포장 간식은 <strong>봉지의 성분표(영양정보)</strong>를 찍어
              주세요. 먹은 양은 줌 또는 낱개(1/2·1/3 등)로 고릅니다.
            </p>
          ) : null}

          {picked ? (
            <PhotoCanvas file={picked} alt="식사/포장지 사진" />
          ) : hostPhoto.file_id || hostPhoto.download_url ? (
            <HostFileImage
              fileId={hostPhoto.file_id}
              downloadUrl={hostPhoto.download_url}
              alt="식사/포장지 사진"
              className="mb-3 max-h-52 w-full rounded-lg object-cover"
            />
          ) : null}

          <label className="mb-3 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-sm font-medium">
            {picked || hostPhoto.file_id
              ? "사진 바꾸기"
              : meal === "snack"
                ? "포장지 사진 선택"
                : "사진 선택 (선택)"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={saved}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setPicked(file);
                forgetPortion();
              }}
            />
          </label>
          {!textOnly && meal !== "snack" && (picked || embedded) && !hasHostPhoto ? (
            <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              사진으로 그릇 지름을 판별하려면 채팅창에 손바닥과 식단 사진을 함께
              올려 주세요. 아래에서 그릇 크기를 직접 고르거나 줌으로도 적을 수
              있습니다.
            </p>
          ) : null}

          <label className="block text-sm font-medium">
            먹은 음식
            <textarea
              value={note}
              maxLength={200}
              rows={3}
              placeholder={
                meal === "snack"
                  ? "예: 초코파이, 감자칩"
                  : "예: 공기밥, 된장국, 김치, 계란말이"
              }
              disabled={saved}
              onChange={(event) => {
                setNote(event.target.value);
                forgetPortion();
                setDrafts([]);
              }}
              className="mt-1.5 h-20 w-full resize-none overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
        </div>

        {!hasPhoto && meal !== "snack" ? (
          <p className="text-xs text-muted-foreground">
            사진 없음 → 기준 분량(예: 바나나 1개)으로 계산합니다.
          </p>
        ) : null}

        {drafts.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-bold">먹은 양이 얼마나 되나요</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {textOnly
                ? "사진 없음 → 예: 밥 1공기, 김치 1줌, 바나나 1개처럼 단위와 함께 적으세요."
                : "줌은 반찬의 부피를 나타낼 수 있습니다. 장, 개, 봉지처럼 다른 단위는 그대로 적으면 됩니다. 적은 단위는 확인 때 판단합니다."}
            </p>
            {!textOnly && meal !== "snack" ? (
              <div className="mb-1 flex gap-1">
                {(["korean", "western"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={saved}
                    onClick={() => setCuisine(option)}
                    className={`rounded-md border px-2 py-1 text-xs font-bold ${cuisine === option
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-border"
                      }`}
                  >
                    {option === "korean" ? "한식" : "양식"}
                  </button>
                ))}
              </div>
            ) : null}
            {drafts.map((draft, index) => (
              <div
                key={`${draft.name}-${index}`}
                className="rounded-lg border border-border p-2"
              >
                <p className="text-sm font-semibold">
                  {roleLabel[draft.role] ?? draft.role} · {draft.name}
                </p>
                {(draft.role === "rice" || draft.role === "soup") &&
                  !textOnly ? (
                  <div className="mt-2 flex gap-2">
                    {(
                      [
                        ["vessel", "개인 그릇"],
                        ["text", "냄비·팬 → 줌"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={saved}
                        onClick={() => {
                          const next = [...drafts];
                          next[index] = {
                            ...draft,
                            amountMode: mode,
                            sharedPot: mode === "text",
                            amountNote:
                              mode === "text" ? draft.amountNote : draft.amountNote,
                          };
                          setDrafts(next);
                          setConfirmed(false);
                        }}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${(mode === "vessel" && draft.amountMode === "vessel") ||
                            (mode === "text" && draft.amountMode !== "vessel")
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-border"
                          }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {draft.sharedPot && draft.amountMode !== "vessel" ? (
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                    냄비·팬처럼 같이 먹는 그릇이면, 먹은 양만 손 1줌
                    {handfulVolumeMl > 0 ? `(${handfulVolumeMl}ml)` : ""} 기준으로
                    적어 주세요.
                  </p>
                ) : null}
                {draft.amountMode === "vessel" && !textOnly ? (
                  <div className="mt-2">
                    <MealVesselControls
                      handLengthCm={measuredLength}
                      handWidthCm={measuredWidth}
                      requirePhotoDiameter={hasHostPhoto && !textOnly}
                      photoDiameterCm={
                        draft.photoDiameterCm > 0
                          ? draft.photoDiameterCm
                          : undefined
                      }
                      value={draft.vessel}
                      label={draft.role === "soup" ? "국" : draft.role === "rice" ? "밥" : "그릇"}
                      askSharedBowl={
                        draft.role === "rice" || draft.role === "soup"
                      }
                      onChange={(vessel) => {
                        const diameterEdited =
                          Math.abs(vessel.diameterCm - draft.vessel.diameterCm) >
                          0.05;
                        const next = [...drafts];
                        next[index] = {
                          ...draft,
                          vessel,
                          photoDiameterCm:
                            diameterEdited && vessel.diameterCm > 0
                              ? vessel.diameterCm
                              : draft.photoDiameterCm,
                        };
                        setDrafts(next);
                        setConfirmed(false);
                      }}
                    />
                  </div>
                ) : (
                  <div className="mt-2">
                    <label className="block text-sm font-medium">
                      양
                      <input
                        type="text"
                        value={draft.amountNote}
                        placeholder={
                          draft.sharedPot || draft.role === "rice" || draft.role === "soup"
                            ? "예: 1줌, 1.5줌"
                            : textOnly
                              ? "예: 1공기, 1줌, 2장, 1개"
                              : "예: 1줌, 2장, 3개"
                        }
                        disabled={saved}
                        onChange={(event) => {
                          const next = [...drafts];
                          next[index] = {
                            ...draft,
                            amountNote: event.target.value,
                            amountMode:
                              draft.amountMode === "vessel"
                                ? "text"
                                : draft.amountMode,
                          };
                          setDrafts(next);
                          setConfirmed(false);
                        }}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {nutrition ? (
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-sm text-muted-foreground">
              {saved ? "저장한 칼로리" : confirmed ? "확정 칼로리" : "미리보기"}
            </p>
            <p className="text-3xl font-bold">
              {nutrition.kcal}
              <span className="ml-1 text-base font-medium">kcal</span>
            </p>
            <p className="mt-1 text-sm">
              탄 {nutrition.carbG}g · 단 {nutrition.proteinG}g · 지{" "}
              {nutrition.fatG}g
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {nutrition.foods.map((food, index) => (
                <li key={`${food.foodName}-${index}`}>
                  {food.role ? `${roleLabel[food.role] ?? food.role} · ` : ""}
                  {food.foodName} {food.grams ?? 0}g · {food.kcal}kcal
                  {food.amountSource ? ` · ${food.amountSource}` : ""}
                </li>
              ))}
            </ul>
            <div className="mt-3 h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { name: "탄수화물", grams: nutrition.carbG, fill: "#f59e0b" },
                    { name: "단백질", grams: nutrition.proteinG, fill: "#16a34a" },
                    { name: "지방", grams: nutrition.fatG, fill: "#2563eb" },
                  ]}
                >
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis width={36} unit="g" tick={{ fontSize: 11 }} />
                  <Bar dataKey="grams" radius={[6, 6, 0, 0]}>
                    {[
                      { fill: "#f59e0b" },
                      { fill: "#16a34a" },
                      { fill: "#2563eb" },
                    ].map((row, index) => (
                      <Cell key={index} fill={row.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null}

        {saved ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
            <p className="font-bold text-emerald-700 dark:text-emerald-300">
              등록 완료
            </p>
            <p className="text-muted-foreground">{summary}</p>
          </div>
        ) : null}

        {failed ? (
          <p className="text-sm text-red-600" role="alert">
            {failed}
          </p>
        ) : null}
        {saved || estimated ? (
          <SourceFooter
            data={{
              ko: "식품영양성분 데이터베이스",
              en: "Korean Food Composition Database system(K-FCDB)",
            }}
          />
        ) : null}
      </div>

      {webPrompts.length > 0 && !foodsAccepted ? (
        <div className="space-y-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold">
              {webPrompts.some((prompt) => prompt.needsCandidatePick)
                ? "비슷한 DB 음식 중 고르세요"
                : webPrompts.some((prompt) => unitNutritionReady(prompt))
                  ? "이 음식과 1단위 열량·탄단지가 맞나요?"
                  : "식품 DB에 같은 이름이 없습니다."}
            </p>
            <button
              type="button"
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-semibold"
              onClick={() => {
                dismissedMissRef.current = portionKey;
                expectMissingRef.current = false;
                askedHostRef.current = { stamp: "", at: 0 };
                stopPoll();
                setWebPrompts([]);
                setFoodsAccepted(false);
                setFailed("");
              }}
            >
              닫기
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {webPrompts.some((prompt) => prompt.needsCandidatePick)
              ? "목록에서 맞는 이름을 고르거나 ‘목록에 없음’을 누르세요. 없으면 AI가 열량·탄단지를 채웁니다."
              : webPrompts.some((prompt) => unitNutritionReady(prompt))
                ? "칼로리·탄단지를 계산하기 전에 확인합니다. 줌은 저장된 손 1줌이라 바꾸지 않습니다."
                : "AI가 채우거나, 아래에서 1단위 kcal와 탄단지(g)를 직접 적은 뒤 확인하세요."}
          </p>
          {webPrompts.map((prompt, index) => {
            const found = unitNutritionReady(prompt);
            const unit = prompt.unit || "개";
            const patchPrompt = (patch: Partial<WebPrompt>) => {
              const next = [...webPrompts];
              const merged = { ...prompt, ...patch };
              next[index] = {
                ...merged,
                webMiss: merged.needsCandidatePick
                  ? false
                  : !unitNutritionReady(merged),
              };
              setWebPrompts(next);
              setFoodsAccepted(false);
            };
            if (prompt.needsCandidatePick) {
              return (
                <div key={prompt.query} className="space-y-2">
                  <p className="text-sm font-semibold">적은 이름 · {prompt.query}</p>
                  <div className="space-y-1.5">
                    {prompt.candidates.map((cand) => {
                      const selected = prompt.selectedPick === cand.foodName;
                      return (
                        <button
                          key={cand.foodName}
                          type="button"
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selected
                              ? "border-blue-600 bg-blue-500/10 font-semibold"
                              : "border-border bg-background"
                            }`}
                          onClick={() => {
                            patchPrompt({ selectedPick: cand.foodName });
                          }}
                        >
                          <span className="block">{cand.foodName}</span>
                          {cand.kcal > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              기준 {cand.kcal}kcal
                              {cand.servingWeight
                                ? ` · 1회 ${cand.servingWeight}`
                                : ""}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${prompt.selectedPick === "__none__"
                          ? "border-blue-600 bg-blue-500/10 font-semibold"
                          : "border-border bg-background"
                        }`}
                      onClick={() => {
                        patchPrompt({ selectedPick: "__none__" });
                      }}
                    >
                      목록에 없음
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={prompt.query} className="space-y-2">
                <p className="text-sm font-semibold">적은 이름 · {prompt.query}</p>
                <label className="block text-xs">
                  확인한 이름
                  <input
                    type="text"
                    value={prompt.candidateName}
                    onChange={(event) => {
                      patchPrompt({ candidateName: event.target.value });
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs">
                  1{unit}당 kcal
                  {unit === "줌" && handfulVolumeMl
                    ? ` · 손 1줌 ${handfulVolumeMl}ml`
                    : ""}
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={prompt.kcalPerUnit}
                    placeholder={found ? undefined : "예: 90"}
                    onChange={(event) => {
                      patchPrompt({ kcalPerUnit: event.target.value });
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums"
                  />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs">
                    탄수화물 g
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      inputMode="decimal"
                      value={prompt.carbPerUnit}
                      placeholder="0"
                      onChange={(event) => {
                        patchPrompt({ carbPerUnit: event.target.value });
                      }}
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm tabular-nums"
                    />
                  </label>
                  <label className="block text-xs">
                    단백질 g
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      inputMode="decimal"
                      value={prompt.proteinPerUnit}
                      placeholder="0"
                      onChange={(event) => {
                        patchPrompt({ proteinPerUnit: event.target.value });
                      }}
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm tabular-nums"
                    />
                  </label>
                  <label className="block text-xs">
                    지방 g
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      inputMode="decimal"
                      value={prompt.fatPerUnit}
                      placeholder="0"
                      onChange={(event) => {
                        patchPrompt({ fatPerUnit: event.target.value });
                      }}
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm tabular-nums"
                    />
                  </label>
                </div>
              </div>
            );
          })}
          {webPrompts.some((prompt) => !prompt.needsCandidatePick) ? (
            <button
              type="button"
              className="w-full rounded-lg border border-border py-2 text-xs font-semibold"
              onClick={() => {
                void peekPortion(portionKey);
              }}
            >
              AI 답이 왔는지 확인
            </button>
          ) : null}
          <button
            type="button"
            className="w-full rounded-xl border border-blue-600 py-3 text-sm font-bold text-blue-700 disabled:opacity-60 dark:text-blue-300"
            disabled={
              foodsAccepted ||
              webPrompts.some((prompt) =>
                prompt.needsCandidatePick
                  ? !prompt.selectedPick
                  : !unitNutritionReady(prompt),
              )
            }
            onClick={() => {
              const next = drafts.map((draft) => {
                const prompt = webPrompts.find(
                  (item) => item.query === draft.name,
                );
                if (!prompt) return draft;
                if (prompt.needsCandidatePick) {
                  if (prompt.selectedPick === "__none__") {
                    return {
                      ...draft,
                      nameConfirmed: false,
                      matchedFoodName: "",
                      noneOfCandidates: true,
                      candidateName: draft.name,
                      kcalPerUnit: 0,
                      carbPerUnit: 0,
                      proteinPerUnit: 0,
                      fatPerUnit: 0,
                    };
                  }
                  return {
                    ...draft,
                    nameConfirmed: true,
                    noneOfCandidates: false,
                    matchedFoodName: prompt.selectedPick,
                    candidateName: prompt.selectedPick,
                    kcalPerUnit: 0,
                    carbPerUnit: 0,
                    proteinPerUnit: 0,
                    fatPerUnit: 0,
                  };
                }
                const kcal = Number(prompt.kcalPerUnit);
                const serving = Number(prompt.servingGrams);
                return {
                  ...draft,
                  nameConfirmed: true,
                  noneOfCandidates: true,
                  candidateName: prompt.candidateName.trim() || draft.name,
                  matchedFoodName: "",
                  kcalPerUnit: kcal,
                  carbPerUnit: Number(prompt.carbPerUnit) || 0,
                  proteinPerUnit: Number(prompt.proteinPerUnit) || 0,
                  fatPerUnit: Number(prompt.fatPerUnit) || 0,
                  servingGrams: serving > 0 ? serving : draft.servingGrams,
                };
              });
              setDrafts(next);
              const needsAi = webPrompts.some(
                (prompt) =>
                  prompt.needsCandidatePick &&
                  prompt.selectedPick === "__none__",
              );
              if (needsAi) {
                setFoodsAccepted(false);
                setWebPrompts([]);
                setFailed("");
                void confirmKcal(next);
                return;
              }
              const onlyDbPicks = webPrompts.every(
                (prompt) =>
                  prompt.needsCandidatePick &&
                  prompt.selectedPick &&
                  prompt.selectedPick !== "__none__",
              );
              if (onlyDbPicks) {
                setFoodsAccepted(false);
                setWebPrompts([]);
                setFailed("");
                void confirmKcal(next);
                return;
              }
              setFoodsAccepted(true);
              setFailed("");
            }}
          >
            {foodsAccepted
              ? "음식 확인함"
              : webPrompts.some((prompt) => prompt.needsCandidatePick)
                ? "선택한 음식으로 계산"
                : "이 음식이 맞아요"}
          </button>
        </div>
      ) : null}

      <div className="border-t border-border bg-background p-3 [overflow-anchor:none]">
        {waiting ? (
          <p className="mb-2 text-center text-sm text-muted-foreground">
            분량·열량을 계산하는 중…
          </p>
        ) : webPrompts.length > 0 && !foodsAccepted ? (
          <p className="mb-2 text-center text-sm text-muted-foreground">
            {webPrompts.some((prompt) => prompt.needsCandidatePick)
              ? "DB 후보를 고르거나 ‘목록에 없음’을 누른 뒤 계산하세요."
              : webPrompts.some((prompt) => unitNutritionReady(prompt))
                ? "칼로리 계산 전에 1단위 열량·탄단지가 맞는지 확인해 주세요."
                : "AI가 1단위 열량·탄단지(줌이면 손 1줌)를 채우면 여기에 표시됩니다."}
          </p>
        ) : null}
        {drafts.length > 0 || textOnly || hasPhoto || estimated ? (
          <div className="flex flex-col gap-2">
            {drafts.length === 0 && !estimated ? (
              <button
                type="button"
                disabled={!ready || isPending || saved || waiting}
                onClick={() => {
                  setDrafts(
                    draftsFromNote(note, meal, measuredLength, measuredWidth),
                  );
                  void startClassify();
                }}
                className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white disabled:opacity-60"
              >
                {waiting ? "분류 중…" : "분량 입력 열기"}
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  !ready ||
                  isPending ||
                  saved ||
                  waiting ||
                  (webPrompts.length > 0 && !foodsAccepted)
                }
                onClick={() => {
                  void confirmKcal();
                }}
                className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white disabled:opacity-60"
              >
                {waiting
                  ? "계산 중…"
                  : estimated
                    ? "kcal계산 다시하기"
                    : "kcal 계산"}
              </button>
            )}
            {estimated ? (
              <button
                type="submit"
                disabled={!ready || isPending || saved || waiting}
                className="w-full rounded-xl border border-blue-600 py-3.5 text-base font-bold text-blue-700 disabled:opacity-60 dark:text-blue-300"
              >
                {saved ? "등록했습니다" : isPending ? "저장 중…" : "저장"}
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            disabled={!ready || isPending || saved}
            onClick={() => {
              setDrafts(
                draftsFromNote(note, meal, measuredLength, measuredWidth),
              );
            }}
            className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white disabled:opacity-60"
          >
            분량 입력 열기
          </button>
        )}
      </div>

      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "write-meal-foods",
          date: day,
          meal,
          note: note.trim(),
          cuisine,
          ready,
          saved,
          hasPhoto,
          textOnly,
        })}
      />
    </form>
  );
}
