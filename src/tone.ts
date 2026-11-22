/**
 * Fixed coach voice — stage picker (1~5) removed from the product.
 * Host still speaks with humor; no per-user tone setting.
 */

export const DEFAULT_MEAL_MISS =
  "식사 기록이 빠진 날이 있어요. 오늘 한 끼만 찍어서 다시 붙여 봐요.";

export const DEFAULT_COACH_GUIDE =
  "독해도 유머가 있어야 하고, 듣고 나서 기분만 나쁘면 안 된다. 웃긴 비유 뒤에 다음 한 끼나 내일을 남긴다. 욕설은 쓰지 않는다. 식사 누락이면 오늘 등록을 재촉한다.";

/** @deprecated Tone stages removed; kept so old callers compile until cleaned. */
export const trainerTones = [] as const;

/** @deprecated Always undefined — tone picker removed. */
export function findTrainerTone(_level: number): undefined {
  return undefined;
}
