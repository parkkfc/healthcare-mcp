import "@/index.css";

import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useEffect, useId, useRef, useState } from "react";
import { useUser } from "skybridge/web";
import type { BarcodeProduct } from "@/barcode.js";
import { useCallTool, useToolInfo } from "@/helpers.js";
import { SourceFooter } from "./components/source-footer.js";
import { useAccountKey } from "./use-account-key.js";

const mealOptions = [
  { id: "breakfast", label: "아침" },
  { id: "lunch", label: "점심" },
  { id: "dinner", label: "저녁" },
  { id: "snack", label: "간식" },
] as const;
type Meal = (typeof mealOptions)[number]["id"];

const formats = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.ITF,
];

const round1 = (value: number) => Math.round(value * 10) / 10;

export function BarcodeScanPanel({
  meal: firstMeal,
  date,
  accountKey,
}: {
  meal: Meal;
  date: string;
  accountKey: string;
}) {
  const readerId = `barcode-reader-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const scanner = useRef<Html5Qrcode | null>(null);
  const { callToolAsync: lookup, isPending: looking } =
    useCallTool("lookup-barcode");
  const { callToolAsync: saveFoods, isPending: saving } =
    useCallTool("record-meal-photos");
  const [cameraOn, setCameraOn] = useState(false);
  const [digits, setDigits] = useState("");
  const [product, setProduct] = useState<BarcodeProduct | null>(null);
  const [grams, setGrams] = useState(100);
  const [meal, setMeal] = useState<Meal>(firstMeal);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState("");

  function reader() {
    scanner.current ??= new Html5Qrcode(readerId, {
      formatsToSupport: formats,
      verbose: false,
    });
    return scanner.current;
  }

  async function stopCamera() {
    const active = scanner.current;
    setCameraOn(false);
    if (!active?.isScanning) return;
    await active.stop().catch(() => undefined);
  }

  useEffect(
    () => () => {
      const active = scanner.current;
      if (active?.isScanning) void active.stop().catch(() => undefined);
    },
    [],
  );

  async function find(code: string) {
    setNotice("");
    setSaved("");
    setProduct(null);
    setDigits(code);
    try {
      const result = await lookup({ barcode: code });
      const found = result.structuredContent;
      if (!found) {
        setNotice("제품 정보를 받지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      if (!found.found) {
        setNotice(found.message);
        return;
      }
      setProduct(found);
      setGrams(found.servingG > 0 ? Math.round(found.servingG) : 100);
    } catch {
      setNotice("제품 조회가 실패했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
  }

  async function startCamera() {
    setNotice("");
    setCameraOn(true);
    try {
      await reader().start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 120 } },
        (decoded) => {
          void stopCamera().then(() => find(decoded));
        },
        undefined,
      );
    } catch {
      setCameraOn(false);
      // Host iframes often deny the camera. The photo and the digits still work.
      setNotice(
        "이 화면에서는 카메라를 쓸 수 없습니다. 바코드 사진을 고르거나 숫자를 적어 주세요.",
      );
    }
  }

  async function scanFile(file: File) {
    setNotice("");
    await stopCamera();
    try {
      const result = await reader().scanFileV2(file, false);
      await find(result.decodedText);
    } catch {
      setNotice(
        "사진에서 바코드를 읽지 못했습니다. 바코드가 크게 보이게 다시 찍거나 숫자를 적어 주세요.",
      );
    }
  }

  const ratio = grams / 100;
  const eaten = product
    ? {
        kcal: Math.round(product.kcalPer100 * ratio),
        carbG: round1(product.carbPer100 * ratio),
        proteinG: round1(product.proteinPer100 * ratio),
        fatG: round1(product.fatPer100 * ratio),
      }
    : null;

  async function save() {
    if (!product || !eaten || !(grams > 0) || saving) return;
    setNotice("");
    try {
      const result = await saveFoods({
        meal,
        date,
        entries: [
          {
            meal,
            note: product.productName,
            foods: [
              {
                foodName: product.productName,
                grams,
                kcal: eaten.kcal,
                carbG: eaten.carbG,
                proteinG: eaten.proteinG,
                fatG: eaten.fatG,
              },
            ],
          },
        ],
        accountKey,
      });
      if (result.structuredContent?.ok) {
        setSaved(
          `${date} ${mealOptions.find((item) => item.id === meal)?.label ?? ""}에 ${product.productName} ${grams}g, ${eaten.kcal}kcal를 저장했습니다.`,
        );
      } else {
        setNotice("저장하지 못했습니다. 한 번 더 눌러 주세요.");
      }
    } catch {
      setNotice("저장하지 못했습니다. 한 번 더 눌러 주세요.");
    }
  }

  return (
    <div className="p-4 bg-background text-foreground rounded-xl border border-border">
      <h2 className="text-lg font-bold">바코드로 기록</h2>
      <p className="text-xs text-muted-foreground">
        포장지의 바코드를 비추거나, 바코드 사진을 고르거나, 숫자를 적어
        주세요.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void (cameraOn ? stopCamera() : startCamera())}
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white"
        >
          {cameraOn ? "카메라 끄기" : "카메라로 스캔"}
        </button>
        <label className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm font-bold">
          바코드 사진 고르기
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void scanFile(file);
            }}
          />
        </label>
      </div>

      {/* Stays in the layout: the scanner measures this box when it starts. */}
      <div id={readerId} className="mt-3 w-full overflow-hidden rounded-lg" />

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (digits.trim().length > 0) void find(digits.trim());
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          value={digits}
          placeholder="바코드 숫자 8~14자리"
          onChange={(event) =>
            setDigits(event.target.value.replace(/\D/g, "").slice(0, 14))
          }
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={looking || digits.length < 8}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-bold disabled:opacity-60"
        >
          {looking ? "찾는 중…" : "찾기"}
        </button>
      </form>

      {notice ? <p className="mt-3 text-sm">{notice}</p> : null}

      {product && eaten ? (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="font-bold">{product.productName}</div>
          <div className="text-xs text-muted-foreground">
            {product.brand ? `${product.brand} · ` : ""}바코드 {product.barcode}
          </div>
          <div className="mt-1 text-xs">
            100g당 {product.kcalPer100}kcal · 탄 {product.carbPer100}g · 단{" "}
            {product.proteinPer100}g · 지 {product.fatPer100}g
          </div>

          <label className="mt-3 block text-xs text-muted-foreground">
            먹은 양 {grams}g
            <input
              type="range"
              min={10}
              max={Math.max(500, Math.round(product.servingG * 2))}
              step={5}
              value={grams}
              onChange={(event) => {
                setSaved("");
                setGrams(Number(event.target.value));
              }}
              className="mt-1 w-full cursor-pointer accent-blue-600"
            />
          </label>
          <input
            type="number"
            min={1}
            value={grams}
            onChange={(event) => {
              setSaved("");
              setGrams(Math.max(0, Number(event.target.value)));
            }}
            className="mt-1 w-24 rounded-lg border border-border bg-background px-2 py-1 text-sm"
          />

          <div className="mt-3 text-xl font-bold">{eaten.kcal}kcal</div>
          <div className="text-xs">
            탄 {eaten.carbG}g · 단 {eaten.proteinG}g · 지 {eaten.fatG}g
          </div>

          <div className="mt-3 flex flex-wrap gap-1">
            {mealOptions.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSaved("");
                  setMeal(item.id);
                }}
                className={`rounded-full border px-3 py-1 text-xs ${
                  meal === item.id
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-border"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={saving || !(grams > 0) || saved.length > 0}
            onClick={() => void save()}
            className="mt-3 w-full rounded-lg bg-blue-600 py-3 font-bold text-white disabled:opacity-60"
          >
            {saving ? "저장 중…" : saved ? "저장됨" : `${date} 기록에 저장`}
          </button>
          {saved ? <p className="mt-2 text-sm">{saved}</p> : null}
        </div>
      ) : null}
      {product ? (
        <SourceFooter data={product.source} libs={["html5-qrcode"]} />
      ) : null}
      <div
        className="hidden"
        data-llm={JSON.stringify({
          view: "scan-food-barcode",
          barcode: product?.barcode ?? "",
          productName: product?.productName ?? "",
          grams: product ? grams : 0,
          meal,
          eaten,
          saved: saved.length > 0,
          source: product?.source.ko ?? "",
        })}
      />
    </div>
  );
}

type ScanData = Extract<
  ReturnType<typeof useToolInfo<"scan-food-barcode">>,
  { isSuccess: true }
>["output"];

function ScanLoaded({ data }: { data: ScanData }) {
  const accountKey = useAccountKey(data.accountKey || undefined);
  return (
    <BarcodeScanPanel
      meal={data.meal}
      date={data.date}
      accountKey={accountKey}
    />
  );
}

export default function ScanFoodBarcode() {
  const { theme } = useUser();
  const toolInfo = useToolInfo<"scan-food-barcode">();
  if (!toolInfo.isSuccess) return null;
  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <ScanLoaded data={toolInfo.output} />
    </div>
  );
}
