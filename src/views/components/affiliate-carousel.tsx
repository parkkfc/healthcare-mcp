import { useOpenExternal } from "skybridge/web";
import type { AffiliateBlock } from "@/affiliate.js";

const storeColor = {
  coupang: "#e11d48",
  iherb: "#16a34a",
  lunchbox: "#f59e0b",
} as const;

/**
 * Recommendation cards for a shortfall the server just computed. Each card
 * says whether its link is an affiliate link or a plain store search.
 */
export function AffiliateCarousel({ block }: { block: AffiliateBlock }) {
  // MVP: affiliateFor always returns show:false. Keep the UI for later.
  const openExternal = useOpenExternal();
  if (!block.show || block.items.length === 0) return null;
  return (
    <section className="mt-3 rounded-lg border border-border p-3">
      <h3 className="text-sm font-bold">{block.title}</h3>
      <p className="text-xs text-muted-foreground">{block.detail}</p>
      <div className="mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
        {block.items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => openExternal(item.url)}
            className="w-40 shrink-0 snap-start rounded-lg border border-border bg-background p-3 text-left transition hover:border-blue-600/50"
          >
            <span
              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
              style={{ background: storeColor[item.store] }}
            >
              {item.storeLabel}
            </span>
            <span className="mt-2 block text-sm font-bold">{item.title}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {item.reason}
            </span>
            <span className="mt-2 block text-[10px] text-muted-foreground">
              {item.isAffiliate ? "제휴 링크 · 구매 시 수수료" : "일반 링크"}
            </span>
            <span className="mt-1 block text-xs font-bold text-blue-600">
              보러 가기
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
