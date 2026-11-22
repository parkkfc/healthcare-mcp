/**
 * Recommendation cards shown only when a shortfall was just computed.
 *
 * Partner links come from Worker variables. Until a variable is set, that card
 * opens a plain store search and is labelled as a normal link, not an
 * affiliate one.
 *
 *   COUPANG_PARTNERS_URL_CHICKEN  Coupang Partners short link for chicken breast
 *   COUPANG_PARTNERS_URL_PROTEIN  Coupang Partners short link for protein powder
 *   IHERB_RCODE                   iHerb rewards code appended as ?rcode=
 *   LUNCHBOX_PARTNER_URL          diet lunchbox brand partner link
 *
 * MVP: affiliateFor always returns noAffiliate. Uncomment the builder below
 * when partner codes are ready.
 */

export type AffiliateStore = "coupang" | "iherb" | "lunchbox";

export type AffiliateItem = {
  id: string;
  store: AffiliateStore;
  storeLabel: string;
  title: string;
  reason: string;
  url: string;
  isAffiliate: boolean;
};

export type AffiliateBlock = {
  show: boolean;
  title: string;
  detail: string;
  items: AffiliateItem[];
};

export type AffiliateNeed =
  | { kind: "protein"; gapG: number }
  | { kind: "lower-body" };

/** Hosts the carousel may open without a confirmation dialog. */
export const affiliateRedirectDomains = [
  "https://www.coupang.com",
  "https://link.coupang.com",
  "https://kr.iherb.com",
];

export const noAffiliate: AffiliateBlock = {
  show: false,
  title: "",
  detail: "",
  items: [],
};

export async function affiliateFor(
  need: AffiliateNeed | null,
): Promise<AffiliateBlock> {
  void need;
  return noAffiliate;
}

/*
type PartnerEnv = {
  COUPANG_PARTNERS_URL_CHICKEN?: string;
  COUPANG_PARTNERS_URL_PROTEIN?: string;
  IHERB_RCODE?: string;
  LUNCHBOX_PARTNER_URL?: string;
};

async function partnerEnv(): Promise<PartnerEnv> {
  try {
    const { env } = await import("cloudflare:workers");
    return env;
  } catch {
    return {};
  }
}

function httpsUrl(value: string | undefined): string | null {
  const url = value?.trim() ?? "";
  return url.startsWith("https://") ? url : null;
}

function coupangSearch(query: string): string {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(query)}`;
}

function iherbSearch(query: string, rcode: string | null): string {
  const base = `https://kr.iherb.com/search?kw=${encodeURIComponent(query)}`;
  return rcode ? `${base}&rcode=${encodeURIComponent(rcode)}` : base;
}

export async function affiliateForLive(
  need: AffiliateNeed | null,
): Promise<AffiliateBlock> {
  if (!need) return noAffiliate;
  if (need.kind === "protein" && need.gapG <= 0) return noAffiliate;

  const env = await partnerEnv();
  const chicken = httpsUrl(env.COUPANG_PARTNERS_URL_CHICKEN);
  const protein = httpsUrl(env.COUPANG_PARTNERS_URL_PROTEIN);
  const lunchbox = httpsUrl(env.LUNCHBOX_PARTNER_URL);
  const rcode = env.IHERB_RCODE?.trim() || null;

  const reason =
    need.kind === "protein"
      ? `단백질 ${need.gapG}g 부족`
      : "하체 근육량이 상체보다 적음";
  const items: AffiliateItem[] = [
    {
      id: "coupang-chicken",
      store: "coupang",
      storeLabel: "쿠팡",
      title: "닭가슴살",
      reason,
      url: chicken ?? coupangSearch("닭가슴살"),
      isAffiliate: chicken !== null,
    },
    {
      id: "coupang-protein",
      store: "coupang",
      storeLabel: "쿠팡",
      title: "단백질 보충제",
      reason,
      url: protein ?? coupangSearch("단백질 보충제"),
      isAffiliate: protein !== null,
    },
    {
      id: "iherb-protein",
      store: "iherb",
      storeLabel: "아이허브",
      title: "웨이 프로틴",
      reason,
      url: iherbSearch("whey protein", rcode),
      isAffiliate: rcode !== null,
    },
    {
      id: "lunchbox",
      store: "lunchbox",
      storeLabel: "다이어트 도시락",
      title: "고단백 도시락",
      reason,
      url: lunchbox ?? coupangSearch("고단백 다이어트 도시락"),
      isAffiliate: lunchbox !== null,
    },
  ];
  const linked = items.some((item) => item.isAffiliate);
  return {
    show: true,
    title:
      need.kind === "protein"
        ? `부족한 단백질 ${need.gapG}g 채우기`
        : "하체가 상체보다 적습니다. 운동 후 단백질 보충",
    detail: linked
      ? "제휴 링크가 포함되어 있습니다. 구매하면 앱이 수수료를 받을 수 있고, 앱은 무료입니다."
      : "아직 제휴 코드가 연결되지 않은 일반 검색 링크입니다.",
    items,
  };
}
*/
