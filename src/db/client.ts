import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

export function seoulToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** Inclusive day gap between YYYY-MM-DD strings (UTC date math). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function getDb() {
  const { env } = await import("cloudflare:workers");
  return drizzle(env.DB, { schema });
}

export async function saveMealBytes(
  bytes: Uint8Array,
  mimeType: string,
  date: string,
  meal: string,
) {
  const { env } = await import("cloudflare:workers");
  const extension = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : "jpg";
  const key = `meals/${date}/${meal}/${crypto.randomUUID()}.${extension}`;
  await env.IMAGES.put(key, bytes, {
    httpMetadata: { contentType: mimeType || "image/jpeg" },
  });
  return key;
}

export async function saveMealPhoto(
  photo: { download_url: string; mime_type?: string },
  date: string,
  meal: string,
) {
  const { env } = await import("cloudflare:workers");
  const response = await fetch(photo.download_url);
  if (!response.ok) {
    throw new Error("업로드한 사진을 가져오지 못했습니다.");
  }
  const extension = photo.mime_type?.includes("png")
    ? "png"
    : photo.mime_type?.includes("webp")
      ? "webp"
      : "jpg";
  const key = `meals/${date}/${meal}/${crypto.randomUUID()}.${extension}`;
  await env.IMAGES.put(key, await response.arrayBuffer(), {
    httpMetadata: { contentType: photo.mime_type || "image/jpeg" },
  });
  return key;
}

export async function getUserProfile(userId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

type UserPatch = {
  displayName?: string;
  toneLevel?: number;
  handLengthCm?: number;
  handWidthCm?: number;
  handfulVolumeMl?: number;
  inbodyMeasuredOn?: string;
  weightKg?: number;
  skeletalMuscleKg?: number;
  bodyFatKg?: number;
  bodyFatPercent?: number;
  muscleUpperLeftKg?: number;
  muscleUpperRightKg?: number;
  muscleCoreKg?: number;
  muscleLowerLeftKg?: number;
  muscleLowerRightKg?: number;
  heightCm?: number;
  sex?: (typeof schema.sexes)[number];
  goalKcal?: number;
  goalCarbG?: number;
  goalProteinG?: number;
  goalFatG?: number;
  goalBurnKcal?: number;
  targetBodyType?: (typeof schema.targetBodyTypes)[number];
  targetDays?: number;
  targetStartedOn?: string;
  targetEndedOn?: string;
  etagSecret?: string;
};

export async function saveTargetBodyType(
  userId: string,
  targetBodyType: (typeof schema.targetBodyTypes)[number],
  targetDays: number,
  targetStartedOn: string,
  targetEndedOn: string,
) {
  return saveUser(userId, {
    targetBodyType,
    targetDays,
    targetStartedOn,
    targetEndedOn,
  });
}

/** Clears the want-to-be body window (stickers/growth stop). */
export async function clearTargetBodyGoal(userId: string) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .update(schema.users)
    .set({
      targetBodyType: null,
      targetDays: null,
      targetStartedOn: null,
      targetEndedOn: null,
      updatedAt: now,
    })
    .where(eq(schema.users.id, userId));
  return now;
}

async function saveUser(userId: string, input: UserPatch) {
  // Keys left undefined must not overwrite saved columns.
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as UserPatch;
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .insert(schema.users)
    .values({
      id: userId,
      ...patch,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { ...patch, updatedAt: now },
    });
  return now;
}

export async function saveGoals(
  userId: string,
  goals: {
    goalKcal?: number;
    goalCarbG?: number;
    goalProteinG?: number;
    goalFatG?: number;
    goalBurnKcal?: number;
  },
) {
  return saveUser(userId, goals);
}

export async function saveBodyProfile(
  userId: string,
  body: { heightCm?: number; sex?: (typeof schema.sexes)[number] },
) {
  return saveUser(userId, body);
}

/** Per-user HMAC key for etags. Created on first use. */
export async function getEtagSecret(userId: string): Promise<string> {
  const user = await getUserProfile(userId);
  if (user?.etagSecret) return user.etagSecret;
  const etagSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  await saveUser(userId, { etagSecret });
  return etagSecret;
}

export async function getHandProfile(userId: string) {
  const user = await getUserProfile(userId);
  if (
    !user ||
    user.handLengthCm == null ||
    user.handWidthCm == null ||
    user.handfulVolumeMl == null ||
    !(user.handfulVolumeMl > 0)
  ) {
    return null;
  }
  return user;
}

export async function saveHandProfile(
  userId: string,
  handLengthCm: number,
  handWidthCm: number,
  handfulVolumeMl: number,
) {
  const updatedAt = await saveUser(userId, {
    handLengthCm,
    handWidthCm,
    handfulVolumeMl,
  });
  return { handLengthCm, handWidthCm, handfulVolumeMl, updatedAt };
}

export async function getTrainerTone(userId: string) {
  const user = await getUserProfile(userId);
  if (!user || user.toneLevel == null) return null;
  return { toneLevel: user.toneLevel, updatedAt: user.updatedAt };
}

export async function saveTrainerTone(userId: string, toneLevel: number) {
  const updatedAt = await saveUser(userId, { toneLevel });
  return { toneLevel, updatedAt };
}

export async function saveDisplayName(userId: string, displayName: string) {
  const updatedAt = await saveUser(userId, { displayName });
  return { displayName, updatedAt };
}

export async function getInbody(userId: string) {
  const user = await getUserProfile(userId);
  if (
    !user ||
    user.weightKg == null ||
    user.skeletalMuscleKg == null ||
    user.bodyFatKg == null
  ) {
    return null;
  }
  return user;
}

export async function saveInbody(
  userId: string,
  reading: {
    inbodyMeasuredOn: string;
    weightKg: number;
    skeletalMuscleKg: number;
    bodyFatKg: number;
    bodyFatPercent: number;
    muscleUpperLeftKg: number;
    muscleUpperRightKg: number;
    muscleCoreKg: number;
    muscleLowerLeftKg: number;
    muscleLowerRightKg: number;
    heightCm?: number;
    sex?: (typeof schema.sexes)[number];
  },
) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .insert(schema.inbodyReadings)
    .values({
      userId,
      measuredOn: reading.inbodyMeasuredOn,
      weightKg: reading.weightKg,
      skeletalMuscleKg: reading.skeletalMuscleKg,
      bodyFatKg: reading.bodyFatKg,
      bodyFatPercent: reading.bodyFatPercent,
      muscleUpperLeftKg: reading.muscleUpperLeftKg,
      muscleUpperRightKg: reading.muscleUpperRightKg,
      muscleCoreKg: reading.muscleCoreKg,
      muscleLowerLeftKg: reading.muscleLowerLeftKg,
      muscleLowerRightKg: reading.muscleLowerRightKg,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.inbodyReadings.userId, schema.inbodyReadings.measuredOn],
      set: {
        weightKg: reading.weightKg,
        skeletalMuscleKg: reading.skeletalMuscleKg,
        bodyFatKg: reading.bodyFatKg,
        bodyFatPercent: reading.bodyFatPercent,
        muscleUpperLeftKg: reading.muscleUpperLeftKg,
        muscleUpperRightKg: reading.muscleUpperRightKg,
        muscleCoreKg: reading.muscleCoreKg,
        muscleLowerLeftKg: reading.muscleLowerLeftKg,
        muscleLowerRightKg: reading.muscleLowerRightKg,
      },
    });
  const updatedAt = await saveUser(userId, reading);
  return { ...reading, updatedAt };
}

export async function listInbodyReadings(
  userId: string,
  start: string,
  end: string,
) {
  const db = await getDb();
  return db
    .select()
    .from(schema.inbodyReadings)
    .where(
      and(
        eq(schema.inbodyReadings.userId, userId),
        gte(schema.inbodyReadings.measuredOn, start),
        lte(schema.inbodyReadings.measuredOn, end),
      ),
    )
    .orderBy(asc(schema.inbodyReadings.measuredOn));
}

export async function getLastMealDate(userId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select({ date: schema.mealLogs.date })
    .from(schema.mealLogs)
    .where(eq(schema.mealLogs.userId, userId))
    .orderBy(desc(schema.mealLogs.date))
    .limit(1);
  return rows[0]?.date ?? null;
}

export async function hasMealOnDate(userId: string, date: string) {
  const db = await getDb();
  const rows = await db
    .select({ date: schema.mealLogs.date })
    .from(schema.mealLogs)
    .where(
      and(eq(schema.mealLogs.userId, userId), eq(schema.mealLogs.date, date)),
    )
    .limit(1);
  return rows.length > 0;
}

/** Distinct meal days between from..to inclusive. */
export async function countMealDays(
  userId: string,
  from: string,
  to: string,
): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ date: schema.mealLogs.date })
    .from(schema.mealLogs)
    .where(
      and(
        eq(schema.mealLogs.userId, userId),
        gte(schema.mealLogs.date, from),
        lte(schema.mealLogs.date, to),
      ),
    )
    .groupBy(schema.mealLogs.date);
  return rows.length;
}

export const INBODY_MIN_INTERVAL_DAYS = 28;

export async function listMealLogs(userId: string, start: string, end: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.mealLogs)
    .where(
      and(
        eq(schema.mealLogs.userId, userId),
        gte(schema.mealLogs.date, start),
        lte(schema.mealLogs.date, end),
      ),
    )
    .orderBy(asc(schema.mealLogs.date), asc(schema.mealLogs.id));
}

export async function getMealLog(userId: string, id: number) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.mealLogs)
    .where(and(eq(schema.mealLogs.id, id), eq(schema.mealLogs.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Scales kcal and macros by the gram ratio of one row. */
export async function updateMealLogGrams(
  userId: string,
  id: number,
  grams: number,
) {
  const row = await getMealLog(userId, id);
  if (!row) return null;
  const ratio = row.grams > 0 ? grams / row.grams : 1;
  const next = {
    grams,
    kcal: Math.round(row.kcal * ratio * 10) / 10,
    carbG: Math.round(row.carbG * ratio * 10) / 10,
    proteinG: Math.round(row.proteinG * ratio * 10) / 10,
    fatG: Math.round(row.fatG * ratio * 10) / 10,
    updatedAt: new Date().toISOString(),
  };
  const db = await getDb();
  await db
    .update(schema.mealLogs)
    .set(next)
    .where(and(eq(schema.mealLogs.id, id), eq(schema.mealLogs.userId, userId)));
  return { ...row, ...next };
}

/** Deletes exactly one row. There is no multi-row delete. */
export async function deleteMealLog(userId: string, id: number) {
  const db = await getDb();
  await db
    .delete(schema.mealLogs)
    .where(and(eq(schema.mealLogs.id, id), eq(schema.mealLogs.userId, userId)));
}

export async function listExercises() {
  const db = await getDb();
  return db.select().from(schema.exercises).orderBy(asc(schema.exercises.id));
}

/** Rank catalog exercises by Korean name / slug match for workout search. */
export async function findExercisesByName(query: string, limit = 5) {
  const raw = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (raw.length === 0) return [];
  const compact = raw.replace(/\s+/g, "");
  const all = await listExercises();
  return all
    .map((row) => {
      const name = row.nameKo.toLowerCase();
      const slug = row.slug.toLowerCase();
      let score = 0;
      if (name === raw) score = 100;
      else if (name.startsWith(raw)) score = 80;
      else if (name.includes(raw)) score = 60;
      else if (slug === compact || slug.includes(compact)) score = 40;
      else if (raw.includes(name) && name.length >= 2) score = 30;
      return { row, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.nameKo.localeCompare(b.row.nameKo))
    .slice(0, Math.max(1, limit))
    .map((item) => item.row);
}

export async function insertExercises(
  rows: {
    slug: string;
    nameKo: string;
    kind: (typeof schema.workoutKinds)[number];
    laterality: (typeof schema.exerciseLateralities)[number];
    region: (typeof schema.exerciseRegions)[number];
    isolation: number;
    cue: string;
  }[],
) {
  const db = await getDb();
  const saved: string[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const bySlug = await db
      .select({ slug: schema.exercises.slug })
      .from(schema.exercises)
      .where(eq(schema.exercises.slug, row.slug))
      .limit(1);
    const byName = await db
      .select({ slug: schema.exercises.slug })
      .from(schema.exercises)
      .where(eq(schema.exercises.nameKo, row.nameKo))
      .limit(1);
    if (bySlug.length > 0 || byName.length > 0) {
      skipped.push(row.nameKo);
      continue;
    }
    await db.insert(schema.exercises).values({
      slug: row.slug,
      nameKo: row.nameKo,
      kind: row.kind,
      laterality: row.laterality,
      region: row.region,
      isolation: row.isolation,
      cue: row.cue,
    });
    saved.push(row.nameKo);
  }
  return { saved, skipped };
}

export async function insertWorkoutLogs(
  userId: string,
  date: string,
  entries: {
    exercise: string;
    kind: (typeof schema.workoutKinds)[number];
    weightKg: number;
    reps: number;
    sets: number;
    durationMin: number;
    burnedKcal: number;
    mode?: (typeof schema.workoutModes)[number];
    rounds?: number;
  }[],
) {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  for (const entry of entries) {
    await db.insert(schema.workoutLogs).values({
      userId,
      date,
      exercise: entry.exercise,
      kind: entry.kind,
      weightKg: entry.weightKg,
      reps: entry.reps,
      sets: entry.sets,
      durationMin: entry.durationMin,
      burnedKcal: entry.burnedKcal,
      mode: entry.mode ?? "manual",
      rounds: entry.rounds ?? 0,
      createdAt,
    });
  }
}

export async function upsertPendingWorkoutBurn(
  userId: string,
  row: {
    note: string;
    exercise: string;
    kind: (typeof schema.workoutKinds)[number];
    matchedName: string;
    burnedKcal: number;
    weightKg: number;
    reps: number;
    sets: number;
    durationMin: number;
    distanceKm: number;
  },
) {
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const values = {
    userId,
    note: row.note,
    exercise: row.exercise,
    kind: row.kind,
    matchedName: row.matchedName,
    burnedKcal: row.burnedKcal,
    weightKg: row.weightKg,
    reps: row.reps,
    sets: row.sets,
    durationMin: row.durationMin,
    distanceKm: row.distanceKm,
    updatedAt,
  };
  // One write instead of delete+insert (halves D1 row writes).
  await db
    .insert(schema.pendingWorkoutBurns)
    .values(values)
    .onConflictDoUpdate({
      target: schema.pendingWorkoutBurns.userId,
      set: {
        note: values.note,
        exercise: values.exercise,
        kind: values.kind,
        matchedName: values.matchedName,
        burnedKcal: values.burnedKcal,
        weightKg: values.weightKg,
        reps: values.reps,
        sets: values.sets,
        durationMin: values.durationMin,
        distanceKm: values.distanceKm,
        updatedAt: values.updatedAt,
      },
    });
}

export async function getPendingWorkoutBurn(userId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.pendingWorkoutBurns)
    .where(eq(schema.pendingWorkoutBurns.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertPendingMealPortions(
  userId: string,
  row: { note: string; foodsJson: string; palmComparison: string },
) {
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const values = {
    userId,
    note: row.note,
    foodsJson: row.foodsJson,
    palmComparison: row.palmComparison,
    updatedAt,
  };
  await db
    .insert(schema.pendingMealPortions)
    .values(values)
    .onConflictDoUpdate({
      target: schema.pendingMealPortions.userId,
      set: {
        note: values.note,
        foodsJson: values.foodsJson,
        palmComparison: values.palmComparison,
        updatedAt: values.updatedAt,
      },
    });
}

export async function getPendingMealPortions(userId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.pendingMealPortions)
    .where(eq(schema.pendingMealPortions.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function clearPendingWorkoutBurn(userId: string) {
  const db = await getDb();
  await db
    .delete(schema.pendingWorkoutBurns)
    .where(eq(schema.pendingWorkoutBurns.userId, userId));
}

export async function listWorkoutLogs(
  userId: string,
  start: string,
  end: string,
) {
  const db = await getDb();
  return db
    .select()
    .from(schema.workoutLogs)
    .where(
      and(
        eq(schema.workoutLogs.userId, userId),
        gte(schema.workoutLogs.date, start),
        lte(schema.workoutLogs.date, end),
      ),
    )
    .orderBy(asc(schema.workoutLogs.date), asc(schema.workoutLogs.id));
}

export async function getWorkoutLog(userId: string, id: number) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.workoutLogs)
    .where(
      and(eq(schema.workoutLogs.id, id), eq(schema.workoutLogs.userId, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Deletes exactly one row. There is no multi-row delete. */
export async function deleteWorkoutLog(userId: string, id: number) {
  const db = await getDb();
  await db
    .delete(schema.workoutLogs)
    .where(
      and(eq(schema.workoutLogs.id, id), eq(schema.workoutLogs.userId, userId)),
    );
}

export async function getWorkoutWeekPlan(input: {
  userId: string;
  weekStart: string;
  venue: "gym" | "home";
  homeEquipment: string;
}) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.workoutWeekPlans)
    .where(
      and(
        eq(schema.workoutWeekPlans.userId, input.userId),
        eq(schema.workoutWeekPlans.weekStart, input.weekStart),
        eq(schema.workoutWeekPlans.venue, input.venue),
        eq(schema.workoutWeekPlans.homeEquipment, input.homeEquipment),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Week plans whose Mon–Sun window overlaps [start, end]. Newest first. */
export async function listWorkoutWeekPlansOverlapping(
  userId: string,
  start: string,
  end: string,
) {
  const db = await getDb();
  return db
    .select()
    .from(schema.workoutWeekPlans)
    .where(
      and(
        eq(schema.workoutWeekPlans.userId, userId),
        lte(schema.workoutWeekPlans.weekStart, end),
        gte(schema.workoutWeekPlans.weekEnd, start),
      ),
    )
    .orderBy(desc(schema.workoutWeekPlans.updatedAt));
}

export async function upsertWorkoutWeekPlan(input: {
  userId: string;
  weekStart: string;
  weekEnd: string;
  venue: "gym" | "home";
  homeEquipment: string;
  fingerprint: string;
  planJson: string;
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  const existing = await getWorkoutWeekPlan(input);
  if (existing) {
    // Skip write when nothing meaningful changed (cuts D1 writes on re-open).
    if (
      existing.fingerprint === input.fingerprint &&
      existing.planJson === input.planJson &&
      existing.weekEnd === input.weekEnd
    ) {
      return;
    }
    await db
      .update(schema.workoutWeekPlans)
      .set({
        weekEnd: input.weekEnd,
        fingerprint: input.fingerprint,
        planJson: input.planJson,
        updatedAt: now,
      })
      .where(eq(schema.workoutWeekPlans.id, existing.id));
    return;
  }
  await db.insert(schema.workoutWeekPlans).values({
    userId: input.userId,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    venue: input.venue,
    homeEquipment: input.homeEquipment,
    fingerprint: input.fingerprint,
    planJson: input.planJson,
    createdAt: now,
    updatedAt: now,
  });
}
