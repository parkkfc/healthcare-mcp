declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AI: Ai;
    IMAGES: R2Bucket;
    // Google / Kakao OAuth. Unset disables that provider on the login card.
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    KAKAO_REST_API_KEY?: string;
    KAKAO_CLIENT_SECRET?: string;
    OAUTH_STATE_SECRET?: string;
    PUBLIC_BASE_URL?: string;
    // Affiliate links. Unset means the card opens a plain store search.
    COUPANG_PARTNERS_URL_CHICKEN?: string;
    COUPANG_PARTNERS_URL_PROTEIN?: string;
    IHERB_RCODE?: string;
    LUNCHBOX_PARTNER_URL?: string;
  }
}
