/**
 * Device / client clock helpers.
 * Widgets use local browser time; the server prefers clientDate / clientTimeZone
 * from the tool args, then falls back to Asia/Seoul.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(value: string | undefined | null): value is string {
  return Boolean(value && YMD.test(value));
}

/** Local civil YYYY-MM-DD on the device running the widget. */
export function deviceToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** IANA timezone of the device, e.g. America/New_York. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/**
 * True once 12:00 local (device) on that civil day has passed.
 * Past days → true; today before noon → false; future → false.
 */
export function localNoonPassed(day: string, now = new Date()): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return false;
  const noon = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
    0,
    0,
    0,
  );
  return now.getTime() >= noon.getTime();
}

/** Server-side day resolution for tools that accept a device clock. */
export function resolveClientDay(
  clientDate?: string,
  clientTimeZone?: string,
): { day: string; timeZone: string } {
  if (isValidYmd(clientDate)) {
    return {
      day: clientDate,
      timeZone: clientTimeZone?.trim() || "device",
    };
  }
  const tz = clientTimeZone?.trim();
  if (tz) {
    try {
      const day = new Date().toLocaleDateString("en-CA", { timeZone: tz });
      if (isValidYmd(day)) return { day, timeZone: tz };
    } catch {
      // invalid IANA → Seoul fallback
    }
  }
  return {
    day: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
    timeZone: "Asia/Seoul",
  };
}
