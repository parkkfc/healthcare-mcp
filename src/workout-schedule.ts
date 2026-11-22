/**
 * Today's session is chosen by the trainer: weekday template + InBody
 * upper/lower balance + want-to-be body. The user does not pick the body part.
 * Slots are filled from the exercise catalog first. Unfilled roles are returned
 * so the host model can insert a matching move.
 */

export const sessionKinds = [
  "full",
  "upper",
  "lower",
  "push",
  "pull",
  "legs",
] as const;

export type SessionKind = (typeof sessionKinds)[number];

export const scheduleBiases = ["upper", "lower", "balanced"] as const;
export type ScheduleBias = (typeof scheduleBiases)[number];

export type SessionRegion = "upper" | "core" | "lower" | "full";

export type CatalogItem = {
  slug: string;
  nameKo: string;
  kind: "strength" | "cardio";
  laterality: "unilateral" | "bilateral";
  region: SessionRegion;
  isolation: number;
  cue: string;
};

export type MissingSlot = {
  role: string;
  label: string;
  region: SessionRegion;
  muscles: string;
  hint: string;
};

export type FilledSlot = {
  item: CatalogItem;
  sets: number;
  role: string;
};

type SlotDef = {
  id: string;
  label: string;
  region: SessionRegion;
  muscles: string;
  match: RegExp;
  reject?: RegExp;
  sets: number;
  isolation: 0 | 1;
  hint: string;
};

const SLOTS: Record<string, SlotDef> = {
  chest_press: {
    id: "chest_press",
    label: "가슴 밀기",
    region: "upper",
    muscles: "대흉근",
    match: /벤치|푸시업|push|덤벨 프레스|체스트 프레스/,
    reject: /숄더|레터럴|플라이|트라이|삼두|인클라인|익스텐/,
    sets: 3,
    isolation: 0,
    hint: "대흉근 복합. 헬스장이면 바벨 또는 덤벨 벤치프레스. 홈이면 푸시업이나 집에 있는 덤벨 프레스.",
  },
  incline_press: {
    id: "incline_press",
    label: "인클라인 프레스",
    region: "upper",
    muscles: "윗가슴(쇄골두)",
    match: /인클라인/,
    reject: /플라이|레터럴|컬/,
    sets: 3,
    isolation: 0,
    hint: "30~44도 인클라인 프레스. 헬스장은 덤벨/바벨, 홈은 의자에 기대는 덤벨 프레스 또는 디클라인 푸시업.",
  },
  chest_fly: {
    id: "chest_fly",
    label: "가슴 플라이",
    region: "upper",
    muscles: "대흉근(수평 내전)",
    match: /플라이|fly|풀어파트/,
    reject: /리버스|후면/,
    sets: 2,
    isolation: 1,
    hint: "가슴 이완 플라이. 헬스장은 케이블/펙덱, 홈은 밴드 풀어파트 또는 덤벨 플라이.",
  },
  shoulder_press: {
    id: "shoulder_press",
    label: "숄더 프레스",
    region: "upper",
    muscles: "전면 삼각근",
    match: /숄더 프레스|오버헤드 프레스|숄더프레스/,
    reject: /레터럴|트라이|벤치/,
    sets: 2,
    isolation: 0,
    hint: "전면 어깨 프레스. 덤벨 또는 머신. 어깨가 불편하면 넣지 마세요.",
  },
  lateral_raise: {
    id: "lateral_raise",
    label: "측면 레이즈",
    region: "upper",
    muscles: "측면 삼각근",
    match: /레터럴|사이드 레이즈|lateral/,
    sets: 3,
    isolation: 1,
    hint: "측면 삼각근 고립. 덤벨 또는 케이블 레터럴 레이즈.",
  },
  triceps: {
    id: "triceps",
    label: "삼두 익스텐션",
    region: "upper",
    muscles: "상완삼두(장두)",
    match: /트라이|삼두|푸시다운|킥백/,
    reject: /레그|이두|컬/,
    sets: 3,
    isolation: 1,
    hint: "삼두 장두. 오버헤드 트라이셉스 익스텐션을 우선. 홈이면 밴드나 덤벨.",
  },
  vertical_pull: {
    id: "vertical_pull",
    label: "수직 당기기",
    region: "upper",
    muscles: "광배근",
    match: /풀업|풀다운|랫|pull-up|chin/,
    reject: /푸시|프레스/,
    sets: 3,
    isolation: 0,
    hint: "수직 당기기. 헬스장은 랫풀다운, 철봉이 있으면 풀업.",
  },
  row: {
    id: "row",
    label: "수평 로우",
    region: "upper",
    muscles: "광배근·상배부",
    match: /로우|row/,
    reject: /업라이트|레그/,
    sets: 3,
    isolation: 0,
    hint: "수평 당기기. 시티드 로우, 덤벨 로우, 또는 밴드 로우.",
  },
  rear_delt: {
    id: "rear_delt",
    label: "후면 어깨",
    region: "upper",
    muscles: "후면 삼각근",
    match: /리버스|후면|페이스 풀|리어 델트/,
    sets: 3,
    isolation: 1,
    hint: "후면 삼각근. 리버스 펙덱 또는 벤트오버 레터럴.",
  },
  curl: {
    id: "curl",
    label: "이두 컬",
    region: "upper",
    muscles: "상완이두·상완근",
    match: /이두|바이셉|프리처|인클라인 컬|덤벨 컬|바벨 컬/,
    reject: /레그컬|leg.?curl|해머만쓸일없음/,
    sets: 2,
    isolation: 1,
    hint: "이두 이완. 인클라인 덤벨 컬 또는 프리처 컬.",
  },
  squat: {
    id: "squat",
    label: "하체 밀기",
    region: "lower",
    muscles: "대퇴사두·둔근",
    match: /스쿼트|squat|런지|lunge/,
    reject: /스윙/,
    sets: 3,
    isolation: 0,
    hint: "무릎 굽히는 하체 밀기. 헬스장은 백스쿼트/레그프레스, 홈은 고블릿 스쿼트나 런지.",
  },
  hinge: {
    id: "hinge",
    label: "힙 힌지",
    region: "lower",
    muscles: "햄스트링·둔근",
    match: /데드리프트|루마니안|rdl|루마니안/,
    reject: /쓰러스트|브릿지|스윙/,
    sets: 3,
    isolation: 0,
    hint: "힙 힌지. 루마니안 데드리프트. 허리가 불편하면 가벼운 덤벨로.",
  },
  hip_thrust: {
    id: "hip_thrust",
    label: "힙 쓰러스트",
    region: "lower",
    muscles: "둔근",
    match: /쓰러스트|브릿지|hip/,
    reject: /데드버그/,
    sets: 3,
    isolation: 0,
    hint: "둔근. 힙 쓰러스트 또는 글루트 브릿지.",
  },
  leg_extension: {
    id: "leg_extension",
    label: "레그 익스텐션",
    region: "lower",
    muscles: "대퇴직근",
    match: /익스텐션|extension/,
    reject: /트라이|삼두|푸시/,
    sets: 3,
    isolation: 1,
    hint: "대퇴직근 이완. 레그 익스텐션. 홈에 머신이 없으면 맨몸 시스시 스쿼트는 넣지 말고, 의자에 앉아 하는 저항이 있을 때만.",
  },
  leg_curl: {
    id: "leg_curl",
    label: "레그 컬",
    region: "lower",
    muscles: "햄스트링",
    match: /레그컬|레그 컬|leg.?curl/,
    sets: 3,
    isolation: 1,
    hint: "햄스트링 이완. 시티드 레그컬을 우선. 홈이면 밴드 레그컬.",
  },
  calf: {
    id: "calf",
    label: "카프 레이즈",
    region: "lower",
    muscles: "비복근",
    match: /카프|종아리|calf/,
    sets: 3,
    isolation: 1,
    hint: "무릎을 편 스트레이트 레그 카프 레이즈.",
  },
  core: {
    id: "core",
    label: "코어",
    region: "core",
    muscles: "복근",
    match: /플랭크|크런치|데드버그|버드독|니 레이즈|레그 레이즈|사이드 브릿지/,
    sets: 2,
    isolation: 1,
    hint: "코어는 맨 마지막. 크런치, 데드버그, 또는 행잉 니 레이즈.",
  },
};

export const exerciseRoleIds = Object.keys(SLOTS);

export function slotByRole(role: string): SlotDef | undefined {
  return SLOTS[role];
}

const TEMPLATES: Record<SessionKind, string[]> = {
  full: [
    "squat",
    "chest_press",
    "vertical_pull",
    "leg_curl",
    "lateral_raise",
    "triceps",
  ],
  upper: [
    "chest_press",
    "row",
    "incline_press",
    "vertical_pull",
    "lateral_raise",
    "triceps",
  ],
  lower: ["squat", "hinge", "leg_extension", "leg_curl", "calf", "core"],
  push: [
    "chest_press",
    "incline_press",
    "chest_fly",
    "shoulder_press",
    "lateral_raise",
    "triceps",
  ],
  pull: ["vertical_pull", "row", "rear_delt", "curl", "core"],
  legs: [
    "squat",
    "hinge",
    "hip_thrust",
    "leg_extension",
    "leg_curl",
    "calf",
    "core",
  ],
};

/**
 * Doc (C-shape / HIRT·LISS base): ~3 full-body multi-joint only
 * e.g. push-up + pull-up/row + squat — never a 5~7 isolation stack.
 * Same skeleton for every session kind so AMRAP/VFL-base stays full-body.
 */
const FULL_BODY_MJ3 = ["chest_press", "vertical_pull", "squat"] as const;

const AMRAP_TEMPLATES: Record<SessionKind, string[]> = {
  full: [...FULL_BODY_MJ3],
  upper: [...FULL_BODY_MJ3],
  lower: [...FULL_BODY_MJ3],
  push: [...FULL_BODY_MJ3],
  pull: [...FULL_BODY_MJ3],
  legs: [...FULL_BODY_MJ3],
};

export const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** Display order for the week strip: Mon → Sun. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export type WeekDaySlot = {
  weekday: number;
  dayLabel: string;
  mark: "O" | "X";
  kind: SessionKind | "rest";
  /** Always the template session for that weekday (even when mark is X). */
  templateKind: SessionKind;
  sessionLabel: string;
};

/**
 * Week template kinds plus rest days by phase frequency
 * (phase1 ≈ 3일, phase2 ≈ 4일, phase3 ≈ 6일).
 */
export function buildWeekCalendar(input: {
  phase: 1 | 2 | 3;
  bias: ScheduleBias;
}): WeekDaySlot[] {
  const { days } = weekFor(input.phase, input.bias);
  const train = new Set<number>();
  if (input.phase <= 1) {
    // 월·수·금
    train.add(1);
    train.add(3);
    train.add(5);
  } else if (input.phase === 2) {
    // 월·화·목·금
    train.add(1);
    train.add(2);
    train.add(4);
    train.add(5);
  } else {
    // 월~토
    for (let i = 1; i <= 6; i += 1) train.add(i);
  }
  return WEEKDAY.map((dayLabel, weekday) => {
    const on = train.has(weekday);
    const templateKind = days[weekday] ?? "full";
    return {
      weekday,
      dayLabel,
      mark: on ? ("O" as const) : ("X" as const),
      kind: on ? templateKind : ("rest" as const),
      templateKind,
      sessionLabel: on ? sessionKindLabel[templateKind] : "휴식",
    };
  });
}

/** YYYY-MM-DD for `weekday` (0=Sun) in the same week as `baseDate`. */
export function dateInSameWeek(baseDate: string, weekday: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseDate);
  if (!match) return baseDate;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const base = new Date(y, m, d);
  if (!Number.isFinite(base.getTime())) return baseDate;
  const delta = ((weekday % 7) + 7) % 7 - base.getDay();
  base.setDate(base.getDate() + delta);
  const yy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Sun=0 … Sat=6. Upper-weak weeks keep one leg day so legs are not dropped. */
const UPPER_WEEK: SessionKind[] = [
  "pull",
  "push",
  "pull",
  "legs",
  "push",
  "pull",
  "push",
];
const LOWER_WEEK: SessionKind[] = [
  "push",
  "legs",
  "legs",
  "pull",
  "legs",
  "legs",
  "push",
];
const FULL_WEEK: SessionKind[] = [
  "lower",
  "full",
  "upper",
  "full",
  "lower",
  "full",
  "upper",
];
const UL_WEEK: SessionKind[] = [
  "lower",
  "upper",
  "lower",
  "upper",
  "lower",
  "upper",
  "lower",
];
const PPL_WEEK: SessionKind[] = [
  "pull",
  "push",
  "pull",
  "legs",
  "push",
  "pull",
  "legs",
];

export const sessionKindLabel: Record<SessionKind, string> = {
  full: "전신",
  upper: "상체",
  lower: "하체",
  push: "상체 밀기",
  pull: "상체 당기기",
  legs: "하체",
};

export type TodaySession = {
  kind: SessionKind;
  label: string;
  bias: ScheduleBias;
  weekdayLabel: string;
  splitLabel: string;
  reason: string;
  weekHint: string;
  shiftedForRecovery: boolean;
};

function weekdayIndex(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return 1;
  const day = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getDay();
  return Number.isFinite(day) ? day : 1;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function limbBalance(input: {
  upperLeftKg: number;
  upperRightKg: number;
  lowerLeftKg: number;
  lowerRightKg: number;
}): { upperMean: number; lowerMean: number; ratio: number } | null {
  const upperMean = (input.upperLeftKg + input.upperRightKg) / 2;
  const lowerMean = (input.lowerLeftKg + input.lowerRightKg) / 2;
  if (upperMean <= 0 || lowerMean <= 0) return null;
  return {
    upperMean: round1(upperMean),
    lowerMean: round1(lowerMean),
    ratio: round1(lowerMean / upperMean),
  };
}

/**
 * Leg segments are normally heavier than arm segments. A ratio near 2.6 is
 * even. Much higher means the legs are ahead, so the week centers on the upper
 * body. Much lower means the legs are behind.
 */
export function scheduleBias(input: {
  upperLeftKg: number;
  upperRightKg: number;
  lowerLeftKg: number;
  lowerRightKg: number;
  targetBodyType?: string | null;
}): { bias: ScheduleBias; upperMean: number; lowerMean: number; ratio: number } {
  const balance = limbBalance(input);
  if (!balance) {
    return { bias: "balanced", upperMean: 0, lowerMean: 0, ratio: 0 };
  }
  let bias: ScheduleBias = "balanced";
  if (balance.ratio >= 3.2) bias = "upper";
  else if (balance.ratio <= 2.0) bias = "lower";
  else if (input.targetBodyType === "upper" && balance.ratio >= 2.75) {
    bias = "upper";
  } else if (input.targetBodyType === "lower" && balance.ratio <= 2.45) {
    bias = "lower";
  }
  return { bias, ...balance };
}

function classifyMove(name: string): "push" | "pull" | "legs" | "other" {
  if (
    /스쿼트|런지|데드|레그|카프|브릿지|쓰러스트|스윙|스텝|종아리/.test(name)
  ) {
    return "legs";
  }
  if (/로우|풀업|풀다운|랫|리버스|이두|바이셉|프리처/.test(name)) return "pull";
  if (/프레스|푸시|플라이|레터럴|트라이|삼두/.test(name)) return "push";
  return "other";
}

export function inferRecentKind(names: string[]): SessionKind | null {
  const counts = { push: 0, pull: 0, legs: 0 };
  for (const name of names) {
    const kind = classifyMove(name);
    if (kind !== "other") counts[kind] += 1;
  }
  const upper = counts.push + counts.pull;
  if (counts.legs > 0 && upper > 0) return "full";
  if (counts.push > 0 && counts.pull > 0) return "upper";
  if (counts.legs > 0) return "legs";
  if (counts.push > 0) return "push";
  if (counts.pull > 0) return "pull";
  return null;
}

function weekFor(phase: 1 | 2 | 3, bias: ScheduleBias): {
  days: SessionKind[];
  splitLabel: string;
} {
  if (bias === "upper") {
    return { days: UPPER_WEEK, splitLabel: "상체 중심 주간" };
  }
  if (bias === "lower") {
    return { days: LOWER_WEEK, splitLabel: "하체 중심 주간" };
  }
  if (phase <= 1) return { days: FULL_WEEK, splitLabel: "무분할" };
  if (phase === 2) return { days: UL_WEEK, splitLabel: "2분할" };
  return { days: PPL_WEEK, splitLabel: "3분할" };
}

function weekHint(days: SessionKind[]): string {
  const bits = days.map(
    (kind, index) => `${WEEKDAY[index]}${sessionKindLabel[kind]}`,
  );
  return `이번 주: ${bits.join(" · ")}`;
}

export function assignTodaySession(input: {
  date: string;
  phase: 1 | 2 | 3;
  upperLeftKg: number;
  upperRightKg: number;
  lowerLeftKg: number;
  lowerRightKg: number;
  targetBodyType?: string | null;
  recentExerciseNames?: string[];
}): TodaySession {
  const weekday = weekdayIndex(input.date);
  const balance = scheduleBias(input);
  const { days, splitLabel } = weekFor(input.phase, balance.bias);
  const yesterday = inferRecentKind(input.recentExerciseNames ?? []);
  let index = weekday;
  let kind = days[index] ?? "full";
  let shifted = false;
  if (yesterday && yesterday === kind) {
    index = (index + 1) % 7;
    kind = days[index] ?? kind;
    shifted = kind !== yesterday;
    if (kind === yesterday) {
      index = (index + 1) % 7;
      kind = days[index] ?? kind;
    }
  }
  const label = sessionKindLabel[kind];
  const dayName = WEEKDAY[weekday] ?? "오늘";
  let reason: string;
  if (balance.upperMean <= 0 || balance.lowerMean <= 0) {
    reason = `${dayName}요일 ${splitLabel} 일정으로 오늘은 ${label}입니다. 상·하체 분절이 없으면 인바디를 다시 재면 부족한 쪽으로 주를 기울입니다.`;
  } else if (balance.bias === "upper") {
    const keepLower = kind === "legs" || kind === "lower";
    reason = keepLower
      ? `${dayName}요일. 하체 ${balance.lowerMean}kg이 상체 ${balance.upperMean}kg보다 발달해 이번 주는 상체 중심입니다. 오늘은 상체를 쉬고 ${label}만 유지합니다.`
      : `${dayName}요일. 하체 ${balance.lowerMean}kg이 상체 ${balance.upperMean}kg보다 발달해 있어 이번 주는 상체 중심입니다. 오늘은 ${label}.`;
  } else if (balance.bias === "lower") {
    const keepUpper = kind === "push" || kind === "pull" || kind === "upper";
    reason = keepUpper
      ? `${dayName}요일. 하체 ${balance.lowerMean}kg이 상체 ${balance.upperMean}kg보다 부족해 이번 주는 하체 중심입니다. 오늘은 하체를 쉬고 ${label}만 유지합니다.`
      : `${dayName}요일. 상체 ${balance.upperMean}kg에 비해 하체 ${balance.lowerMean}kg이 부족해 이번 주는 하체 중심입니다. 오늘은 ${label}.`;
  } else {
    reason = `${dayName}요일 ${splitLabel}. 상체 ${balance.upperMean}kg·하체 ${balance.lowerMean}kg이 한쪽으로 치우치지 않아 오늘은 ${label}입니다.`;
  }
  if (shifted) {
    reason += " 어제와 같은 자극이라 오늘 칸을 하루 미뤘습니다.";
  }
  return {
    kind,
    label,
    bias: balance.bias,
    weekdayLabel: dayName,
    splitLabel,
    reason,
    weekHint: weekHint(days),
    shiftedForRecovery: shifted,
  };
}

function textOf(item: CatalogItem) {
  return `${item.slug} ${item.nameKo}`;
}

function rankHit(
  item: CatalogItem,
  preferUnilateral: boolean,
  amrapCircuit = false,
) {
  let score = 0;
  if (preferUnilateral && item.laterality === "unilateral") score += 3;
  if (!preferUnilateral && item.laterality === "bilateral") score += 2;
  const text = `${item.slug} ${item.nameKo}`;
  if (amrapCircuit) {
    // Prefer bodyweight / light compound patterns for fast cycling.
    if (item.isolation) score -= 12;
    if (/푸시업|풀업|턱걸이|chin|pull.?up|스쿼트|런지|버피|점핑잭/.test(text)) {
      score += 8;
    }
    if (/벤치|바벨|스미스|핵 스쿼트|레그 프레스/.test(text)) score -= 2;
  } else if (/푸시업|점핑|마운틴|플랭크/.test(text)) {
    score -= 3;
  }
  return score;
}

function matchesSlot(item: CatalogItem, slot: SlotDef) {
  if (item.kind !== "strength") return false;
  const text = textOf(item);
  if (!slot.match.test(text)) return false;
  if (slot.reject?.test(text)) return false;
  if (slot.region === "core") return item.region === "core" || item.region === "full";
  if (slot.region === "lower") {
    return item.region === "lower" || item.region === "full";
  }
  return item.region === "upper" || item.region === "full";
}

export function fillSessionSlots(input: {
  kind: SessionKind;
  catalog: CatalogItem[];
  preferUnilateral: boolean;
  leadRegion?: "upper" | "lower" | "core" | null;
  usedSlugs?: string[];
  /**
   * When true: full-body 3 MJ roles, prefer bodyweight/light, no isolation.
   * Use for AMRAP circuits and VFL-protect (LISS + base MJ) days.
   */
  compoundCircuit?: boolean;
  /** AMRAP: sets=0 (rounds). Base-MJ / VFL day: keep template sets. */
  amrapCircuit?: boolean;
}): { filled: FilledSlot[]; missing: MissingSlot[] } {
  const amrap = Boolean(input.amrapCircuit);
  const compound = Boolean(input.compoundCircuit) || amrap;
  const ids = [
    ...(compound
      ? (AMRAP_TEMPLATES[input.kind] ?? AMRAP_TEMPLATES.full)
      : (TEMPLATES[input.kind] ?? TEMPLATES.full)),
  ];
  const defs = ids
    .map((id) => SLOTS[id])
    .filter((slot): slot is SlotDef => Boolean(slot));
  const lead = input.leadRegion;
  const ordered = lead
    ? [
        ...defs.filter((slot) => slot.region === lead),
        ...defs.filter((slot) => slot.region !== lead),
      ]
    : defs;
  const used = new Set(input.usedSlugs ?? []);
  const filled: FilledSlot[] = [];
  const missing: MissingSlot[] = [];
  for (const slot of ordered) {
    const hits = input.catalog
      .filter((item) => {
        if (!matchesSlot(item, slot) || used.has(item.slug)) return false;
        if (compound && item.isolation) return false;
        return true;
      })
      .sort(
        (a, b) =>
          rankHit(b, input.preferUnilateral, compound) -
          rankHit(a, input.preferUnilateral, compound),
      );
    const picked = hits[0];
    if (!picked) {
      missing.push({
        role: slot.id,
        label: slot.label,
        region: slot.region,
        muscles: slot.muscles,
        hint: compound
          ? `${slot.hint} 전신 다관절(맨몸·가벼운 무게) 3종 회로용으로 넣어 주세요.`
          : slot.hint,
      });
      continue;
    }
    used.add(picked.slug);
    // AMRAP cycles rounds; VFL-base MJ keeps ordinary set counts.
    filled.push({
      item: picked,
      sets: amrap ? 0 : slot.sets,
      role: slot.id,
    });
  }
  return { filled, missing };
}

export function sessionTrains(kind: SessionKind): {
  upper: boolean;
  lower: boolean;
} {
  if (kind === "full") return { upper: true, lower: true };
  if (kind === "legs" || kind === "lower") return { upper: false, lower: true };
  return { upper: true, lower: false };
}
