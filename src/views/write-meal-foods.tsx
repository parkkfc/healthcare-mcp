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
import { useFiles, useModelContext, useUser } from "skybridge/web";
import { useCallTool, useToolInfo } from "@/helpers.js";
import {
  coerceMealPortionRole,
  mealPortionKey,
  parseAmountNote,
  type MealCuisine,
  type MealPortionRole,
} from "@/meal-portions.js";
import {
  defaultVessel,
  lockedVesselDiameterCm,
  MealVesselControls,
  type VesselState,
} from "./components/meal-vessel.js";
import { HostFileImage } from "./components/host-file-image.js";
import { SourceFooter } from "./components/source-footer.js";
import { ChatNextHint } from "./components/chat-next-hint.js";
import { bumpProfile } from "../hooks/profile-sync.js";
import { useAccountKey } from "./use-account-key.js";
import { useAssistantContext } from "../hooks/use-assistant-context.js";

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
  /** Rice/soup DB miss only: macros per 100 g (with kcalPer100g). */
  carbPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  /** kcal of one typed unit (1줌, 1장). Not per gram. */
  kcalPerUnit: number;
  carbPerUnit: number;
  proteinPerUnit: number;
  fatPerUnit: number;
  /** Host-judged bulk density (g/ml). 0 = server fallback. */
  densityGPerMl: number;
  amountMode: "vessel" | "handful" | "piece" | "text";
};

type FoodGroup = "side" | "bowl";

/** Fields that change a bowl's grams. kcalPer100g from a result is excluded so a result does not invalidate itself. */
function bowlSigOf(list: FoodDraft[]): string {
  return list
    .map((draft) =>
      [
        draft.name,
        draft.vessel.diameterCm,
        draft.vessel.heightCm,
        draft.vessel.fillRatio,
        draft.vessel.servings,
        draft.densityGPerMl,
        draft.matchedFoodName,
        draft.noneOfCandidates ? 1 : 0,
      ].join("|"),
    )
    .join(";");
}

function sideSigOf(list: FoodDraft[]): string {
  return list
    .map(
      (draft) =>
        `${draft.name}|${draft.amountNote}|${draft.densityGPerMl}|${draft.servingGrams}|${draft.kcalPerUnit}|${draft.matchedFoodName}|${draft.noneOfCandidates ? 1 : 0}`,
    )
    .join(";");
}

function kcalPer100FromBasis(kcalPerBasis: number, basis: string): number {
  const basisG = Number.parseFloat(basis);
  const denom = Number.isFinite(basisG) && basisG > 0 ? basisG : 100;
  if (!(kcalPerBasis > 0)) return 0;
  return Math.round(((kcalPerBasis * 100) / denom) * 10) / 10;
}

function densityLabel(kcalPer100g: number): string {
  return kcalPer100g > 0 ? `100g당 ${kcalPer100g}kcal` : "";
}

function roundMacro(value: number) {
  return Math.round(value * 10) / 10;
}

function sumNutrition(foods: SavedNutrition["foods"]): SavedNutrition {
  return {
    kcal: foods.reduce((sum, food) => sum + food.kcal, 0),
    carbG: roundMacro(foods.reduce((sum, food) => sum + food.carbG, 0)),
    proteinG: roundMacro(foods.reduce((sum, food) => sum + food.proteinG, 0)),
    fatG: roundMacro(foods.reduce((sum, food) => sum + food.fatG, 0)),
    foods,
  };
}

type SavedNutrition = {
  kcal: number;
  carbG: number;
  proteinG: number;
  fatG: number;
  foods: {
    foodName: string;
    /** Name the user typed; merges side and bowl lookups by name, not index. */
    query?: string;
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
  /** Rice/soup: the numbers are per 100 g, not per 1공기. */
  per100g: boolean;
  needsCandidatePick: boolean;
  candidates: CandidateOption[];
  /** Chosen DB name, or "__none__" for 목록에 없음. */
  selectedPick: string;
};

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

/** Assistant-only context when server estimate fails; no composer follow-up. */
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

function failureText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.replace(/accountKey=\S+/gi, "").trim();
  if (text.includes("로그인")) {
    return "로그인된 계정에만 저장됩니다. 홈에서 로그인한 뒤 다시 등록해 주세요.";
  }
  return "저장하지 못했습니다. 다시 눌러 주세요.";
}

function splitFoodToken(raw: string): { name: string; amountNote: string } {
  const text = raw.replace(/^(아침|점심|저녁|간식)\s*[/:]?\s*/, "").trim();
  const match = text.match(
    /^(.*\S)\s+(\d+(?:\.\d+)?\s*(?:줌|개|장|공기|그릇|잔|인분|봉지|조각)|반\s*줌)$/,
  );
  if (!match) return { name: text, amountNote: "" };
  return { name: match[1].trim(), amountNote: match[2].replace(/\s+/g, "") };
}

function mealFromNote(note: string): MealSlot | null {
  const head = note.trim().slice(0, 6);
  if (head.startsWith("아침")) return "breakfast";
  if (head.startsWith("점심")) return "lunch";
  if (head.startsWith("저녁")) return "dinner";
  if (head.startsWith("간식")) return "snack";
  return null;
}

type HostFoodItem = {
  name: string;
  role?: string;
  amountNote?: string;
  /** Photo palm×bowl comparison (cm). Never copy hand width. */
  containerDiameterCm?: number;
  thicknessCm?: number;
  /** Host-judged bulk density (g/ml). */
  densityGPerMl?: number;
  /** K-FCDB density only. Total kcal waits for bowl confirm. */
  kcalPer100g?: number;
};

function draftFromHostItem(
  item: HostFoodItem,
  meal: MealSlot,
  handLengthCm: number,
  handWidthCm = 0,
): FoodDraft {
  const name = item.name.trim();
  const role: MealPortionRole =
    meal === "snack" ? "snack" : coerceMealPortionRole(item.role);
  const cuisine: MealCuisine =
    meal === "snack" ? "snack" : role === "main" ? "western" : "korean";
  // Bowl UI only when host marked rice/soup. No name-based guessing.
  const amountMode: FoodDraft["amountMode"] =
    meal === "snack"
      ? "piece"
      : role === "rice" || role === "soup"
        ? "vessel"
        : role === "meat" || role === "fried" || role === "side"
          ? "handful"
          : "text";
  const isBowl = role === "rice" || role === "soup";
  const bowlRole = role === "soup" ? "soup" : "rice";
  const photoCm =
    typeof item.containerDiameterCm === "number" && item.containerDiameterCm > 0
      ? Math.round(item.containerDiameterCm * 10) / 10
      : 0;
  const base = defaultVessel(handLengthCm, handWidthCm, bowlRole);
  const heightCm =
    typeof item.thicknessCm === "number" && item.thicknessCm > 0
      ? Math.round(item.thicknessCm * 10) / 10
      : base.heightCm;
  const density =
    typeof item.densityGPerMl === "number" && item.densityGPerMl > 0
      ? Math.round(item.densityGPerMl * 100) / 100
      : 0;
  const kcalPer100g =
    typeof item.kcalPer100g === "number" && item.kcalPer100g > 0
      ? Math.round(item.kcalPer100g * 10) / 10
      : 0;
  return {
    name,
    role,
    cuisine,
    handfuls: 0,
    pieceCount: 0,
    amountNote: (item.amountNote ?? "").trim(),
    nameConfirmed: false,
    candidateName: "",
    matchedFoodName: "",
    noneOfCandidates: false,
    sharedPot: false,
    photoDiameterCm: photoCm,
    vessel: isBowl
      ? {
          ...base,
          // Photo meals seed only host palm×bowl cm; never a typical interim.
          diameterCm: photoCm > 0 ? photoCm : 0,
          heightCm,
        }
      : base,
    servingGrams: 0,
    servingKcal: 0,
    kcalPer100g,
    carbPer100g: 0,
    proteinPer100g: 0,
    fatPer100g: 0,
    kcalPerUnit: 0,
    carbPerUnit: 0,
    proteinPerUnit: 0,
    fatPerUnit: 0,
    densityGPerMl: density,
    amountMode,
  };
}

/** Prefer host items (with AI roles). Note-only fallback keeps amounts, role=side. */
function draftsFromHost(
  items: HostFoodItem[] | undefined,
  note: string,
  meal: MealSlot,
  handLengthCm: number,
  handWidthCm = 0,
): FoodDraft[] {
  if (Array.isArray(items) && items.length > 0) {
    return items
      .filter((item) => item.name.trim().length > 0)
      .map((item) => draftFromHostItem(item, meal, handLengthCm, handWidthCm));
  }
  const parts = note
    .replace(/^(아침|점심|저녁|간식)\s*[/:]?\s*/, "")
    .split(/[,，、\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => {
    const parsed = splitFoodToken(part);
    return draftFromHostItem(
      {
        name: parsed.name,
        role: meal === "snack" ? "snack" : "side",
        amountNote: parsed.amountNote,
      },
      meal,
      handLengthCm,
      handWidthCm,
    );
  });
}

export default function WriteMealFoods() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"write-meal-foods">();
  const { callToolAsync, isPending } = useCallTool("record-meal-photos");
  const { callToolAsync: lookupPortions } = useCallTool("lookup-meal-portions");
  const { callToolAsync: estimateUnit } = useCallTool("estimate-unit-nutrition");
  const { getDownloadUrl } = useFiles();
  const { update: updateModelContext } = useModelContext();
  const accountKey = useAccountKey();

  const [note, setNote] = useState("");
  const [meal, setMeal] = useState<MealSlot>("lunch");
  const [saved, setSaved] = useState(false);
  const [nutrition, setNutrition] = useState<SavedNutrition | null>(null);
  const [failed, setFailed] = useState("");
  const [summary, setSummary] = useState("");
  const [picked] = useState<File | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [webPrompts, setWebPrompts] = useState<WebPrompt[]>([]);
  const [foodsAccepted, setFoodsAccepted] = useState(false);
  const [portionKey, setPortionKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [cuisine, setCuisine] = useState<MealCuisine>("korean");
  const [drafts, setDrafts] = useState<FoodDraft[]>([]);
  /** Host confirmed palm in photo via vesselHints (handInPhoto true). */
  const [hostSawPalm, setHostSawPalm] = useState(false);
  const askedHostRef = useRef({ stamp: "", at: 0 });
  /** True only after kcal 계산 found a DB miss; keeps empty peeks from reopening the panel. */
  const expectMissingRef = useRef(false);
  const webPromptsRef = useRef(webPrompts);
  webPromptsRef.current = webPrompts;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  /** User closed the miss panel for this portion key. */
  const dismissedMissRef = useRef("");
  /**
   * Sides (반찬) are looked up on their own and shown right away. Rice/soup are
   * looked up only when the user presses 「열량 계산」 after setting the bowl.
   * Both lists are merged by the name the user typed.
   */
  const [sideFoods, setSideFoods] = useState<SavedNutrition["foods"] | null>(
    null,
  );
  const [bowlFoods, setBowlFoods] = useState<SavedNutrition["foods"] | null>(
    null,
  );
  const sideFoodsRef = useRef<SavedNutrition["foods"] | null>(null);
  const bowlFoodsRef = useRef<SavedNutrition["foods"] | null>(null);
  /** Signature of the side drafts the last side lookup ran for. */
  const sideCalcSigRef = useRef("");
  /** Signature of the bowl drafts the current bowl result was computed from. */
  const bowlCalcSigRef = useRef("");

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
    if (!toolInfo.isSuccess) return emptyPhoto();
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
  }, [toolInfo]);

  const day = toolInfo.isSuccess ? (toolInfo.output.date ?? "") : "";

  const measuredWidth =
    toolInfo.isSuccess && typeof toolInfo.output.handWidthCm === "number"
      ? toolInfo.output.handWidthCm
      : 0;
  const measuredLength =
    toolInfo.isSuccess && typeof toolInfo.output.handLengthCm === "number"
      ? toolInfo.output.handLengthCm
      : 0;
  const handfulVolumeMl =
    toolInfo.isSuccess && typeof toolInfo.output.handfulVolumeMl === "number"
      ? toolInfo.output.handfulVolumeMl
      : 0;
  const hostItems = useMemo((): HostFoodItem[] | undefined => {
    if (!toolInfo.isSuccess) return undefined;
    const raw = toolInfo.output.items;
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return raw
      .map((row) => ({
        name: String(row?.name ?? "").trim(),
        role: typeof row?.role === "string" ? row.role : undefined,
        amountNote:
          typeof row?.amountNote === "string" ? row.amountNote.trim() : "",
        containerDiameterCm:
          typeof row?.containerDiameterCm === "number"
            ? row.containerDiameterCm
            : undefined,
        thicknessCm:
          typeof row?.thicknessCm === "number" ? row.thicknessCm : undefined,
        densityGPerMl:
          typeof row?.densityGPerMl === "number" ? row.densityGPerMl : undefined,
        kcalPer100g:
          typeof row?.kcalPer100g === "number" && row.kcalPer100g > 0
            ? row.kcalPer100g
            : undefined,
      }))
      .filter((row) => row.name.length > 0);
  }, [toolInfo]);

  const seededNoteRef = useRef(false);
  useEffect(() => {
    if (!toolInfo.isSuccess || seededNoteRef.current) return;
    const incoming =
      typeof toolInfo.output.note === "string" ? toolInfo.output.note.trim() : "";
    if (!incoming && !(hostItems && hostItems.length > 0)) return;
    seededNoteRef.current = true;
    const nextMeal = mealFromNote(incoming) ?? toolInfo.output.meal ?? "lunch";
    setMeal(nextMeal);
    if (incoming) setNote(incoming);
    setDrafts(
      draftsFromHost(
        hostItems,
        incoming,
        nextMeal,
        measuredLength,
        measuredWidth,
      ),
    );
  }, [toolInfo, hostItems, measuredLength, measuredWidth]);

  // Host re-opens write-meal-foods with palm diameter / density → merge into drafts.
  useEffect(() => {
    if (!hostItems || hostItems.length === 0) return;
    setDrafts((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map((draft) => {
        const hit = hostItems.find(
          (item) => item.name === draft.name || draft.name.includes(item.name),
        );
        if (!hit) return draft;
        const photoCm =
          typeof hit.containerDiameterCm === "number" &&
          hit.containerDiameterCm > 0
            ? Math.round(hit.containerDiameterCm * 10) / 10
            : 0;
        const density =
          typeof hit.densityGPerMl === "number" && hit.densityGPerMl > 0
            ? Math.round(hit.densityGPerMl * 100) / 100
            : 0;
        const kcalPer100g =
          typeof hit.kcalPer100g === "number" && hit.kcalPer100g > 0
            ? Math.round(hit.kcalPer100g * 10) / 10
            : 0;
        const heightCm =
          typeof hit.thicknessCm === "number" && hit.thicknessCm > 0
            ? Math.round(hit.thicknessCm * 10) / 10
            : draft.vessel.heightCm;
        const diameterChanged =
          photoCm > 0 && Math.abs(draft.photoDiameterCm - photoCm) >= 0.05;
        const densityChanged =
          density > 0 && Math.abs((draft.densityGPerMl || 0) - density) >= 0.01;
        const kcalDensityChanged =
          kcalPer100g > 0 &&
          Math.abs((draft.kcalPer100g || 0) - kcalPer100g) >= 0.05;
        if (!diameterChanged && !densityChanged && !kcalDensityChanged) {
          return draft;
        }
        changed = true;
        return {
          ...draft,
          photoDiameterCm: diameterChanged ? photoCm : draft.photoDiameterCm,
          densityGPerMl: densityChanged ? density : draft.densityGPerMl,
          kcalPer100g: kcalDensityChanged ? kcalPer100g : draft.kcalPer100g,
          vessel: diameterChanged
            ? {
                ...draft.vessel,
                diameterCm: photoCm,
                heightCm,
              }
            : draft.vessel,
        };
      });
      return changed ? next : prev;
    });
  }, [hostItems]);

  /** Chat-attached photo that the host vision can actually see. */
  const hasHostPhoto =
    Boolean(hostPhoto.file_id || hostPhoto.download_url) ||
    (toolInfo.isSuccess &&
      typeof toolInfo.output.photoCount === "number" &&
      toolInfo.output.photoCount > 0);
  /** Local preview or host photo — not enough alone for AI diameter. */
  const hasPhoto = Boolean(picked) || hasHostPhoto;

  const ready = note.replace(/\s+/g, " ").trim().length > 0;
  const textOnly = !hasPhoto && meal !== "snack";
  const needsHand = !textOnly && meal !== "snack";

  useAssistantContext(
    JSON.stringify({
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
          : "섭취량은 사진으로 짐작하지 마라. 반찬·개수는 사용자가 적은 단위(줌·개·장)만 쓰고, 줌은 저장된 손 1줌이다. 밥·국 kcal는 카드에서 그릇 크기·내용물 높이를 확정한 뒤에만 나온다. 입력창에는 쓰지 마라.",
    }),
  );

  /** Rice/soup that use the bowl UI (text-only meals treat them like sides). */
  function isBowlDraft(draft: FoodDraft): boolean {
    return (
      (draft.role === "rice" || draft.role === "soup") &&
      draft.amountMode === "vessel" &&
      !textOnly
    );
  }

  function foodMatchesDraft(
    food: SavedNutrition["foods"][number],
    draft: FoodDraft,
  ): boolean {
    if (food.query) return food.query === draft.name;
    return (
      food.foodName === draft.name ||
      food.foodName.includes(draft.name) ||
      draft.name.includes(food.foodName)
    );
  }

  /**
   * Store one group's result (or clear it with null) and rebuild the merged card
   * by name. 확정 = every group that exists has a result.
   */
  function setGroupFoods(
    group: FoodGroup,
    foods: SavedNutrition["foods"] | null,
    all: FoodDraft[] = draftsRef.current,
  ) {
    const side = group === "side" ? foods : sideFoodsRef.current;
    const bowl = group === "bowl" ? foods : bowlFoodsRef.current;
    sideFoodsRef.current = side;
    bowlFoodsRef.current = bowl;
    setSideFoods(side);
    setBowlFoods(bowl);
    const hasSide = all.some((draft) => !isBowlDraft(draft));
    const hasBowl = all.some((draft) => isBowlDraft(draft));
    const order = (food: SavedNutrition["foods"][number]) => {
      const at = all.findIndex((draft) => foodMatchesDraft(food, draft));
      return at < 0 ? 999 : at;
    };
    const merged = [...(side ?? []), ...(bowl ?? [])].sort(
      (a, b) => order(a) - order(b),
    );
    setNutrition(merged.length > 0 ? sumNutrition(merged) : null);
    setConfirmed(
      merged.length > 0 &&
        (!hasSide || side !== null) &&
        (!hasBowl || bowl !== null),
    );
  }

  function resetFoods() {
    sideFoodsRef.current = null;
    bowlFoodsRef.current = null;
    sideCalcSigRef.current = "";
    bowlCalcSigRef.current = "";
    setSideFoods(null);
    setBowlFoods(null);
    setNutrition(null);
    setConfirmed(false);
  }

  function applyPortionFoods(
    foods: unknown,
    group: FoodGroup,
    all: FoodDraft[],
  ): boolean {
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
          query: String(row.query ?? "").trim() || undefined,
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
    // Show DB kcal per 100 g on the card; match by typed name, not by index.
    setDrafts((prev) =>
      prev.map((draft) => {
        const food = parsed.find((row) => foodMatchesDraft(row, draft));
        if (!food) return draft;
        const per100 =
          food.kcalPerBasis > 0
            ? kcalPer100FromBasis(food.kcalPerBasis, food.basis || "100g")
            : 0;
        return per100 > 0 ? { ...draft, kcalPer100g: per100 } : draft;
      }),
    );
    setGroupFoods(group, parsed, all);
    setWaiting(false);
    setFailed("");
    return true;
  }

  function buildFoodsPayload(source: FoodDraft[] = drafts) {
    return source.map((draft) => {
      const base = {
        slot: 1,
        meal,
        name: draft.name,
        role: draft.role,
        cuisine: textOnly ? ("text" as const) : draft.cuisine,
        // Host density when set; else server resolveFoodDensityGPerMl fallback.
        densityGPerMl:
          draft.densityGPerMl > 0 ? draft.densityGPerMl : undefined,
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
        const bowlRole = draft.role === "soup" ? "soup" : "rice";
        const diameterCm =
          draft.vessel.diameterCm > 0
            ? draft.vessel.diameterCm
            : lockedVesselDiameterCm(
              measuredLength,
              measuredWidth,
              draft.photoDiameterCm > 0 ? draft.photoDiameterCm : undefined,
              // Photo meals: never fall back to a typical interim diameter.
              hasHostPhoto && !textOnly,
              bowlRole,
            );
        return {
          ...base,
          containerDiameterCm: diameterCm > 0 ? diameterCm : undefined,
          thicknessCm: draft.vessel.heightCm,
          coverage: 1,
          curvature: 0.35,
          fillRatio: draft.vessel.fillRatio,
          servings: draft.vessel.servings,
          // DB miss rice/soup: per 100 g × bowl grams (never 1공기 × unit kcal).
          kcalPer100g: draft.kcalPer100g > 0 ? draft.kcalPer100g : undefined,
          carbPer100g: draft.carbPer100g > 0 ? draft.carbPer100g : undefined,
          proteinPer100g:
            draft.proteinPer100g > 0 ? draft.proteinPer100g : undefined,
          fatPer100g: draft.fatPer100g > 0 ? draft.fatPer100g : undefined,
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

  async function askHost(key: string) {
    const handLine =
      measuredWidth > 0
        ? `손바닥 폭 ${measuredWidth}cm, 손 길이 ${measuredLength || "?"}cm, 1줌 ${handfulVolumeMl || "?"}ml.`
        : "손 치수 없음(글만·기준 분량 가능).";
    // Photo+rice/soup: diameter must already be on the card from the first open.
    // Never tell the host to re-open write-meal-foods (that creates a second card).
    const instruction = textOnly
      ? `사진 없이 글만으로 식사 열량을 계산하라. ${handLine} 음식마다 사용자가 적은 amountNote(1줌, 2장, 3개 등)를 그대로 써라. 줌은 손 1줌 부피다. 그 외 단위는 네가 1단위 g와 개수를 판단해 servingGrams·pieceCount에 넣어라. 양(g)은 인터넷에서 추측하지 마라. cuisine=text. lookup-meal-portions를 호출하라. note:\n${key}\naccountKey=${accountKey}.`
      : meal === "snack"
        ? `간식 포장지(성분표) 사진을 보고 사용자가 적은 단위 1개당 kcal를 읽어라. ${handLine} 먹은 양은 사용자가 적은 amountNote 그대로다. 줌은 저장된 손 1줌 부피고, 장·개·봉지 등은 그 1단위 kcal다. g당으로 넣지 마라. cuisine=snack, role=snack. lookup-meal-portions 호출. note:\n${key}\naccountKey=${accountKey}.`
        : `사진 식사 카드가 이미 열렸다. write-meal-foods를 다시 열지 마라(카드가 두 장 생긴다). 밥·국 지름이 비었으면 사용자가 카드에서 고친다. lookup vesselHints만 넣지 마라. ${handLine}\nnote:\n${key}\naccountKey=${accountKey}.`;
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
        : draftsFromHost(hostItems, note, meal, measuredLength, measuredWidth);
    setDrafts(nextDrafts);
    setCuisine(meal === "snack" ? "snack" : textOnly ? "text" : "korean");
    const key = mealPortionKey([{ slot: 1, meal, note: note.trim() }]);
    setFailed("");
    resetFoods();
    setPortionKey(key);
    expectMissingRef.current = false;
    setWebPrompts([]);
    setFoodsAccepted(false);
    setHostSawPalm(false);
    setWaiting(false);
    await askHost(key);
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
      const per100g = row.per100g === true || unit === "100g";
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
          per100g,
          needsCandidatePick,
          candidates,
          selectedPick: "",
        } satisfies WebPrompt,
      ];
    });
    return prompts;
  }

  /** Prefer server Workers AI draft; host chat follow-up only as fallback. */
  async function fillMissingWithServerEstimate(
    prompts: WebPrompt[],
    list: FoodDraft[],
    key: string,
  ): Promise<void> {
    setWaiting(true);
    const next = [...prompts];
    let failedAny = false;
    for (let index = 0; index < next.length; index += 1) {
      const prompt = next[index];
      if (prompt.needsCandidatePick || unitNutritionReady(prompt)) continue;
      // Rice/soup: per 100 g. Others: exactly one unit (never "2개" → count twice).
      const unit = prompt.per100g ? "100g" : `1${prompt.unit || "개"}`;
      try {
        const result = await estimateUnit({
          foodName: prompt.query,
          unit,
          accountKey,
        });
        const out = result.structuredContent as
          | {
              kcalPerUnit?: number;
              carbPerUnit?: number;
              proteinPerUnit?: number;
              fatPerUnit?: number;
              gramsPerUnit?: number;
              error?: string;
            }
          | null
          | undefined;
        if (out && Number(out.kcalPerUnit) > 0) {
          const grams = Number(out.gramsPerUnit) || 0;
          next[index] = {
            ...prompt,
            kcalPerUnit: String(out.kcalPerUnit),
            carbPerUnit: String(Number(out.carbPerUnit) || 0),
            proteinPerUnit: String(Number(out.proteinPerUnit) || 0),
            fatPerUnit: String(Number(out.fatPerUnit) || 0),
            // 1단위 g (개·장). 줌·100g당은 서버가 손 부피·그릇으로 g을 구한다.
            servingGrams:
              !prompt.per100g && prompt.unit !== "줌" && grams > 0
                ? String(grams)
                : prompt.servingGrams,
            webMiss: false,
          };
        } else {
          failedAny = true;
        }
      } catch {
        failedAny = true;
      }
    }
    const nextNames = new Set(next.map((prompt) => prompt.query));
    setWebPrompts((prev) => [
      ...prev.filter((prompt) => !nextNames.has(prompt.query)),
      ...next,
    ]);
    setWaiting(false);
    const stillMissing = next.filter(
      (prompt) => !prompt.needsCandidatePick && !unitNutritionReady(prompt),
    );
    if (stillMissing.length === 0) {
      expectMissingRef.current = false;
      setFailed("");
      return;
    }
    if (failedAny) {
      setFailed(
        "서버 초안을 일부 못 채웠습니다. 아래에서 직접 입력하거나 다시 계산해 주세요.",
      );
      await askHostForMissingKcal(
        stillMissing
          .map((prompt) => {
            const draft = list.find((item) => item.name === prompt.query);
            const amount =
              draft?.amountNote.trim() || `1${prompt.unit || "개"}`;
            return `${prompt.query} ${amount}`;
          })
          .join(", "),
        key,
      );
    }
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
    askedHostRef.current = { stamp: `${key}\n${lines}`, at: Date.now() };
    setFailed(
      "서버 초안이 부족하면 아래에서 kcal·탄단지를 직접 입력해 주세요.",
    );
  }

  /**
   * One lookup per group. "side" = everything except the rice/soup bowls; it runs
   * on its own as soon as the card opens. "bowl" = rice/soup only, run by the
   * 「열량 계산」 button after the bowl and fill are set.
   */
  async function confirmKcal(
    override?: FoodDraft[],
    group: FoodGroup = "side",
  ): Promise<void> {
    if (!ready || isPending || saved) return;
    const all =
      override ??
      (drafts.length > 0
        ? drafts
        : draftsFromHost(hostItems, note, meal, measuredLength, measuredWidth));
    if (all.length === 0) {
      setFailed("음식 이름을 적어 주세요.");
      return;
    }
    if (override || drafts.length === 0) setDrafts(all);
    const list = all.filter((draft) =>
      group === "bowl" ? isBowlDraft(draft) : !isBowlDraft(draft),
    );
    if (list.length === 0) {
      // Nothing in this group (e.g. no bowls): it counts as done.
      setGroupFoods(group, [], all);
      return;
    }
    if (
      group === "side" &&
      needsHand &&
      !(handfulVolumeMl > 0) &&
      list.some((draft) => parseAmountNote(draft.amountNote).handfuls > 0)
    ) {
      setFailed("줌은 반찬 부피라 손 1줌이 있어야 계산됩니다.");
      return;
    }
    // Only sides need a typed amount; the bowl is measured with the bowl UI.
    if (
      group === "side" &&
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
    if (group === "bowl") {
      // Photo meals need a diameter (host first-open or user typed). Never re-open the card.
      const missingDiameter = list.filter(
        (draft) =>
          !(draft.vessel.diameterCm > 0) && !(draft.photoDiameterCm > 0),
      );
      if (missingDiameter.length > 0) {
        setFailed(
          "밥·국 지름을 입력해 주세요. 사진 비교값이 없으면 아래에서 직접 고르세요.",
        );
        return;
      }
      bowlCalcSigRef.current = bowlSigOf(list);
    } else {
      sideCalcSigRef.current = sideSigOf(list);
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
                      draft.role === "soup" ? "soup" : "rice",
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
        // This group has no result until its misses are confirmed; the other keeps its own.
        setGroupFoods(group, null, all);
        setFailed("");
        const pickPrompts = prompts.filter(
          (prompt) => prompt.needsCandidatePick,
        );
        const missingNutrition = prompts.filter(
          (prompt) =>
            !prompt.needsCandidatePick && !unitNutritionReady(prompt),
        );
        expectMissingRef.current = missingNutrition.length > 0;
        const groupNames = new Set(list.map((draft) => draft.name));
        setWebPrompts((prev) => [
          ...prev.filter((prompt) => !groupNames.has(prompt.query)),
          ...prompts,
        ]);
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
          return;
        }
        if (missingNutrition.length === 0) {
          return;
        }
        await fillMissingWithServerEstimate(prompts, list, key);
        return;
      }
      if (out?.ok && applyPortionFoods(out.foods, group, all)) {
        expectMissingRef.current = false;
        dismissedMissRef.current = "";
        const groupNames = new Set(list.map((draft) => draft.name));
        setWebPrompts((prev) =>
          prev.filter((prompt) => !groupNames.has(prompt.query)),
        );
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

  const sideDrafts = drafts.filter((draft) => !isBowlDraft(draft));
  const bowlDrafts = drafts.filter((draft) => isBowlDraft(draft));
  const sideKey = sideSigOf(sideDrafts);
  const bowlKey = bowlSigOf(bowlDrafts);
  const needsVessel = bowlDrafts.length > 0;

  // 1) Sides: kcal is fixed as soon as the card opens (DB hit, or AI draft on a miss).
  //    Rice/soup never block this and are not part of this lookup.
  useEffect(() => {
    if (saved || waiting || !ready || sideDrafts.length === 0) return;
    if (
      sideDrafts.some((draft) => draft.amountNote.trim().length === 0)
    ) {
      return;
    }
    if (sideCalcSigRef.current === sideKey) return;
    const timer = window.setTimeout(() => {
      void confirmKcal(drafts, "side");
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by side signature
  }, [sideKey, ready, saved, waiting]);

  // 2) Bowl changed after a calculation → drop the bowl result (and the total)
  //    so the old kcal never stays on screen. Sides are kept.
  useEffect(() => {
    if (!bowlFoodsRef.current) return;
    if (bowlCalcSigRef.current === bowlKey) return;
    bowlCalcSigRef.current = "";
    setGroupFoods("bowl", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by bowl signature
  }, [bowlKey]);

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

  if (!toolInfo.isSuccess) {
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
                ? out.foods.map((food) => {
                  const foodName = String(food.foodName ?? "");
                  const previous = nutrition.foods.find(
                    (row) =>
                      row.foodName === foodName ||
                      row.foodName.includes(foodName) ||
                      foodName.includes(row.foodName),
                  );
                  return {
                    foodName,
                    grams: Number(food.grams) || previous?.grams || 0,
                    kcal: Number(food.kcal) || 0,
                    carbG: Number(food.carbG) || 0,
                    proteinG: Number(food.proteinG) || 0,
                    fatG: Number(food.fatG) || 0,
                    role: previous?.role,
                    amountSource: previous?.amountSource,
                  };
                })
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
          <p className="text-sm font-semibold">{mealLabel[meal]} · 채팅에서 받은 구성</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
            {note.trim() || "채팅에 음식명과 양을 보내 주세요."}
          </p>
          {picked ? (
            <PhotoCanvas file={picked} alt="식사 사진" />
          ) : hostPhoto.file_id || hostPhoto.download_url ? (
            <HostFileImage
              fileId={hostPhoto.file_id}
              downloadUrl={hostPhoto.download_url}
              alt="식사 사진"
              className="mt-3 max-h-52 w-full rounded-lg object-cover"
            />
          ) : null}
        </div>

        {drafts.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-bold">
              {needsVessel ? "밥·국 그릇 맞추기" : "채팅에서 받은 구성"}
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              반찬 열량은 카드가 열리면 바로 계산됩니다. 밥·국은 사진 손바닥
              비교 지름(없으면 직접 입력)과 100g당 열량만 보이고, 그릇·높이를
              맞춘 뒤 「열량 계산」을 누르면 부피×밀도로 g이 정해져 총 kcal가
              나옵니다. 부피를 다시 바꾸면 버튼을 한 번 더 누르세요.
            </p>
            {drafts.map((draft, index) => {
              const isBowl = isBowlDraft(draft);
              // Each group shows only its own result, matched by the typed name.
              const computed = (isBowl ? bowlFoods : sideFoods)?.find((food) =>
                foodMatchesDraft(food, draft),
              );
              const per100 = densityLabel(draft.kcalPer100g);
              const showTotal = Boolean(computed);
              return (
              <div
                key={`${draft.name}-${index}`}
                className="rounded-lg border border-border p-2"
              >
                <p className="text-sm font-semibold">
                  {roleLabel[draft.role] ?? draft.role} · {draft.name}
                  {!isBowl ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {draft.amountNote ? `${draft.amountNote} · ` : ""}
                      {showTotal
                        ? `${computed!.grams ?? 0}g · ${computed!.kcal}kcal`
                        : waiting
                          ? "열량 확인 중…"
                          : per100 || "열량 확인 필요"}
                    </span>
                  ) : (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {showTotal
                        ? `${computed!.grams ?? 0}g · ${computed!.kcal}kcal`
                        : per100 || "100g당 열량 대기"}
                    </span>
                  )}
                </p>
                {isBowl ? (
                  <div className="mt-2">
                    <MealVesselControls
                      handLengthCm={measuredLength}
                      handWidthCm={measuredWidth}
                      requirePhotoDiameter={hasHostPhoto && !textOnly}
                      awaitingPhotoCompare={
                        hasHostPhoto &&
                        !textOnly &&
                        !(draft.photoDiameterCm > 0) &&
                        !(draft.vessel.diameterCm > 0)
                      }
                      bowlRole={draft.role === "soup" ? "soup" : "rice"}
                      photoDiameterCm={
                        draft.photoDiameterCm > 0
                          ? draft.photoDiameterCm
                          : undefined
                      }
                      value={draft.vessel}
                      label={draft.role === "soup" ? "국" : "밥"}
                      askSharedBowl={false}
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
                        // Any volume edit clears only the bowl result (see bowl effect); sides stay.
                      }}
                    />
                  </div>
                ) : null}
              </div>
              );
            })}
            {needsVessel && bowlFoods === null && !saved ? (
              <button
                type="button"
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white disabled:opacity-60"
                disabled={waiting || isPending}
                onClick={() => {
                  void confirmKcal(drafts, "bowl");
                }}
              >
                {waiting ? "열량 계산 중…" : "이 그릇으로 열량 계산"}
              </button>
            ) : null}
          </div>
        ) : null}

        {nutrition && (confirmed || saved) ? (
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-sm text-muted-foreground">
              {saved ? "저장한 칼로리" : "확정 칼로리"}
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
            {saved ? (
              <div className="mt-3 h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: "총열량", kcal: nutrition.kcal, fill: "#0f766e" },
                      { name: "탄수화물", kcal: nutrition.carbG * 4, fill: "#f59e0b" },
                      { name: "단백질", kcal: nutrition.proteinG * 4, fill: "#16a34a" },
                      { name: "지방", kcal: nutrition.fatG * 9, fill: "#2563eb" },
                    ]}
                  >
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis width={40} unit="kcal" tick={{ fontSize: 11 }} />
                    <Bar dataKey="kcal" radius={[6, 6, 0, 0]}>
                      {["#0f766e", "#f59e0b", "#16a34a", "#2563eb"].map(
                        (fill, index) => (
                          <Cell key={index} fill={fill} />
                        ),
                      )}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </div>
        ) : null}

        {saved ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
            <p className="font-bold text-emerald-700 dark:text-emerald-300">
              등록 완료
            </p>
            <p className="text-muted-foreground">{summary}</p>
            <ChatNextHint example="오늘 목표 달성 보여줘" />
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
                  {prompt.per100g ? "100g당" : `1${unit}당`} kcal
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
                const common = {
                  ...draft,
                  nameConfirmed: true,
                  noneOfCandidates: true,
                  candidateName: prompt.candidateName.trim() || draft.name,
                  matchedFoodName: "",
                };
                // Rice/soup: the draft holds per-100 g values; the server multiplies by bowl grams.
                if (prompt.per100g) {
                  return {
                    ...common,
                    kcalPer100g: kcal,
                    carbPer100g: Number(prompt.carbPerUnit) || 0,
                    proteinPer100g: Number(prompt.proteinPerUnit) || 0,
                    fatPer100g: Number(prompt.fatPerUnit) || 0,
                    kcalPerUnit: 0,
                    carbPerUnit: 0,
                    proteinPerUnit: 0,
                    fatPerUnit: 0,
                  };
                }
                return {
                  ...common,
                  kcalPerUnit: kcal,
                  carbPerUnit: Number(prompt.carbPerUnit) || 0,
                  proteinPerUnit: Number(prompt.proteinPerUnit) || 0,
                  fatPerUnit: Number(prompt.fatPerUnit) || 0,
                  servingGrams: serving > 0 ? serving : draft.servingGrams,
                };
              });
              setDrafts(next);
              // Re-run only the group(s) that had a pending miss/pick, sides and bowls separately.
              const groups = new Set<FoodGroup>();
              for (const prompt of webPrompts) {
                const target = next.find((draft) => draft.name === prompt.query);
                if (target) groups.add(isBowlDraft(target) ? "bowl" : "side");
              }
              setFoodsAccepted(false);
              setWebPrompts([]);
              setFailed("");
              void (async () => {
                for (const target of groups) {
                  await confirmKcal(next, target);
                }
              })();
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
                    draftsFromHost(
                      hostItems,
                      note,
                      meal,
                      measuredLength,
                      measuredWidth,
                    ),
                  );
                  void startClassify();
                }}
                className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white disabled:opacity-60"
              >
                {waiting ? "분류 중…" : "분량 입력 열기"}
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  !ready ||
                  isPending ||
                  saved ||
                  waiting ||
                  (webPrompts.length > 0 && !foodsAccepted) ||
                  !estimated
                }
                className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white disabled:opacity-60"
              >
                {saved ? "등록했습니다" : isPending || waiting ? "저장 중…" : "저장"}
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={!ready || isPending || saved}
            onClick={() => {
              setDrafts(
                draftsFromHost(
                  hostItems,
                  note,
                  meal,
                  measuredLength,
                  measuredWidth,
                ),
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
