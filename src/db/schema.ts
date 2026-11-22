import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const mealSlots = ["breakfast", "lunch", "dinner", "snack"] as const;

export const foodCategories = ["음식", "가공식품"] as const;

export const sexes = ["male", "female"] as const;

export const oauthProviders = ["google", "kakao"] as const;

export const targetBodyTypes = [
  "slim",
  "hypertrophy",
  "power",
  "upper",
  "lower",
] as const;

export const workoutKinds = ["strength", "cardio"] as const;

export const workoutModes = [
  "rest_timer",
  "emom",
  "amrap",
  "stopwatch",
  "manual",
] as const;

export const exerciseLateralities = ["unilateral", "bilateral"] as const;

export const exerciseRegions = [
  "upper",
  "core",
  "lower",
  "full",
] as const;

export const foods = sqliteTable(
  "foods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    foodCode: text("food_code").notNull().unique(),
    foodName: text("food_name").notNull(),
    category: text("category", { enum: foodCategories }).notNull(),
    basis: text("basis").notNull(),
    kcal: real("kcal"),
    carbG: real("carb_g"),
    proteinG: real("protein_g"),
    fatG: real("fat_g"),
    servingRef: text("serving_ref"),
    servingWeight: text("serving_weight"),
  },
  (table) => [index("foods_category_idx").on(table.category)],
);

export const users = sqliteTable(
  "users",
  {
  id: text("id").primaryKey(),
  /** Normalized email from Google/Kakao — primary cross-device identity. */
  email: text("email"),
  displayName: text("display_name"),
  toneLevel: integer("tone_level"),
  handLengthCm: real("hand_length_cm"),
  handWidthCm: real("hand_width_cm"),
  /** One-handful volume (ml) from raw-rice calibration. */
  handfulVolumeMl: real("handful_volume_ml"),
  inbodyMeasuredOn: text("inbody_measured_on"),
  weightKg: real("weight_kg"),
  skeletalMuscleKg: real("skeletal_muscle_kg"),
  bodyFatKg: real("body_fat_kg"),
  bodyFatPercent: real("body_fat_percent"),
  muscleUpperLeftKg: real("muscle_upper_left_kg"),
  muscleUpperRightKg: real("muscle_upper_right_kg"),
  muscleCoreKg: real("muscle_core_kg"),
  muscleLowerLeftKg: real("muscle_lower_left_kg"),
  muscleLowerRightKg: real("muscle_lower_right_kg"),
  heightCm: real("height_cm"),
  sex: text("sex", { enum: sexes }),
  goalKcal: real("goal_kcal"),
  goalCarbG: real("goal_carb_g"),
  goalProteinG: real("goal_protein_g"),
  goalFatG: real("goal_fat_g"),
  goalBurnKcal: real("goal_burn_kcal"),
  targetBodyType: text("target_body_type", { enum: targetBodyTypes }),
  /** Days the user gave themselves to reach the want-to-be body. */
  targetDays: integer("target_days"),
  /** YYYY-MM-DD the body-goal window started (habit stickers + growth tree). */
  targetStartedOn: text("target_started_on"),
  /** YYYY-MM-DD inclusive end of the body-goal window. */
  targetEndedOn: text("target_ended_on"),
  etagSecret: text("etag_secret"),
  /** Last Google/Kakao login written by the OAuth callback (Cloudflare D1). */
  lastAuthProvider: text("last_auth_provider", { enum: oauthProviders }),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

export const inbodyReadings = sqliteTable(
  "inbody_readings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    measuredOn: text("measured_on").notNull(),
    weightKg: real("weight_kg").notNull(),
    skeletalMuscleKg: real("skeletal_muscle_kg").notNull(),
    bodyFatKg: real("body_fat_kg").notNull(),
    bodyFatPercent: real("body_fat_percent").notNull(),
    muscleUpperLeftKg: real("muscle_upper_left_kg").notNull(),
    muscleUpperRightKg: real("muscle_upper_right_kg").notNull(),
    muscleCoreKg: real("muscle_core_kg").notNull(),
    muscleLowerLeftKg: real("muscle_lower_left_kg").notNull(),
    muscleLowerRightKg: real("muscle_lower_right_kg").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("inbody_readings_user_date_idx").on(
      table.userId,
      table.measuredOn,
    ),
  ],
);

export const mealLogs = sqliteTable(
  "meal_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    meal: text("meal", { enum: mealSlots }).notNull(),
    foodName: text("food_name").notNull(),
    grams: real("grams").notNull(),
    kcal: real("kcal").notNull(),
    carbG: real("carb_g").notNull().default(0),
    proteinG: real("protein_g").notNull().default(0),
    fatG: real("fat_g").notNull().default(0),
    photoKey: text("photo_key"),
    userId: text("user_id").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
  },
  (table) => [index("meal_logs_user_date_idx").on(table.userId, table.date)],
);

export const exercises = sqliteTable(
  "exercises",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(),
    nameKo: text("name_ko").notNull(),
    kind: text("kind", { enum: workoutKinds }).notNull(),
    laterality: text("laterality", {
      enum: exerciseLateralities,
    }).notNull(),
    region: text("region", { enum: exerciseRegions }).notNull(),
    isolation: integer("isolation").notNull().default(0),
    cue: text("cue").notNull().default(""),
  },
  (table) => [
    index("exercises_region_idx").on(table.region),
    index("exercises_laterality_idx").on(table.laterality),
  ],
);

export const workoutLogs = sqliteTable(
  "workout_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    exercise: text("exercise").notNull(),
    kind: text("kind", { enum: workoutKinds }).notNull(),
    weightKg: real("weight_kg").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    sets: integer("sets").notNull().default(0),
    durationMin: real("duration_min").notNull().default(0),
    burnedKcal: real("burned_kcal").notNull().default(0),
    mode: text("mode", { enum: workoutModes }).notNull().default("manual"),
    rounds: integer("rounds").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("workout_logs_user_date_idx").on(table.userId, table.date)],
);

export const trainingVenuesDb = ["gym", "home"] as const;

/**
 * One Mon–Sun (Seoul) workout schedule per user · venue · home gear.
 * Loaded for the rest of the week; rebuilt on the next Monday or fingerprint change.
 */
export const workoutWeekPlans = sqliteTable(
  "workout_week_plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    /** Monday YYYY-MM-DD (Asia/Seoul civil date). */
    weekStart: text("week_start").notNull(),
    /** Sunday YYYY-MM-DD. */
    weekEnd: text("week_end").notNull(),
    venue: text("venue", { enum: trainingVenuesDb }).notNull(),
    /** Sorted home gear ids joined by comma; empty for gym. */
    homeEquipment: text("home_equipment").notNull().default(""),
    /** Invalidate when inbody / goal / injuries change. */
    fingerprint: text("fingerprint").notNull(),
    planJson: text("plan_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("workout_week_plans_user_week_venue_uidx").on(
      table.userId,
      table.weekStart,
      table.venue,
      table.homeEquipment,
    ),
    index("workout_week_plans_user_week_idx").on(table.userId, table.weekStart),
  ],
);

/** Host-estimated burn waiting for the workout log card to pick up. */
export const pendingWorkoutBurns = sqliteTable("pending_workout_burns", {
  userId: text("user_id").primaryKey(),
  /** Exact sentence the card is waiting on. */
  note: text("note").notNull().default(""),
  exercise: text("exercise").notNull(),
  kind: text("kind", { enum: workoutKinds }).notNull(),
  matchedName: text("matched_name").notNull().default(""),
  burnedKcal: real("burned_kcal").notNull(),
  weightKg: real("weight_kg").notNull().default(0),
  reps: integer("reps").notNull().default(0),
  sets: integer("sets").notNull().default(0),
  durationMin: real("duration_min").notNull().default(0),
  distanceKm: real("distance_km").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

/** Host palm / 1-meal portion estimate waiting for the meal card. */
export const pendingMealPortions = sqliteTable("pending_meal_portions", {
  userId: text("user_id").primaryKey(),
  /** Exact slot key the card is waiting on. */
  note: text("note").notNull().default(""),
  foodsJson: text("foods_json").notNull().default("[]"),
  palmComparison: text("palm_comparison").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const oauthLoginStatuses = [
  "pending",
  "done",
  "error",
] as const;

export const oauthAuthModes = ["signup", "login"] as const;

/** Google / Kakao identity → users.id (guest_, user_, or ChatGPT subject). */
export const oauthIdentities = sqliteTable(
  "oauth_identities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider", { enum: oauthProviders }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: text("user_id").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("oauth_identities_provider_user_idx").on(
      table.provider,
      table.providerUserId,
    ),
    index("oauth_identities_user_idx").on(table.userId),
  ],
);

/** Browser login attempt the widget polls until the OAuth callback finishes. */
export const oauthLoginAttempts = sqliteTable("oauth_login_attempts", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: oauthProviders }).notNull(),
  status: text("status", { enum: oauthLoginStatuses }).notNull(),
  mode: text("mode", { enum: oauthAuthModes }).notNull().default("login"),
  userId: text("user_id"),
  /** guest_/user_ key the widget should store when userId is a host subject. */
  clientAccountKey: text("client_account_key"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

/**
 * Maps a widget accountKey (user_) onto the real users.id (may be ChatGPT
 * openai/subject). Claude can only store guest_/user_ keys.
 */
export const accountAliases = sqliteTable("account_aliases", {
  clientKey: text("client_key").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Key handed to the host LLM by open-home / open-login when it called without
 * a logged-in accountKey. The widget claims it with the key stored on the
 * device, so the model and the widget resolve to the same users row.
 * claimedAt stays null until the widget has answered.
 */
export const conversationKeys = sqliteTable("conversation_keys", {
  key: text("key").primaryKey(),
  createdAt: text("created_at").notNull(),
  claimedAt: text("claimed_at"),
});

/** Catalog of host-readable training / calorie playbooks (R2 originals + D1 text). */
export const trainingDocs = sqliteTable("training_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  summary: text("summary").notNull(),
  r2Key: text("r2_key").notNull(),
  sourceFile: text("source_file").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const trainingDocChunks = sqliteTable(
  "training_doc_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: text("doc_id")
      .notNull()
      .references(() => trainingDocs.id),
    chunkIndex: integer("chunk_index").notNull(),
    heading: text("heading").notNull().default(""),
    body: text("body").notNull(),
  },
  (table) => [
    index("training_doc_chunks_doc_idx").on(table.docId),
    uniqueIndex("training_doc_chunks_doc_chunk_uidx").on(
      table.docId,
      table.chunkIndex,
    ),
  ],
);
