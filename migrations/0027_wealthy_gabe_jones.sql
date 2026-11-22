CREATE TABLE `pending_workout_burns` (
	`user_id` text PRIMARY KEY NOT NULL,
	`exercise` text NOT NULL,
	`kind` text NOT NULL,
	`matched_name` text DEFAULT '' NOT NULL,
	`burned_kcal` real NOT NULL,
	`weight_kg` real DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`sets` integer DEFAULT 0 NOT NULL,
	`duration_min` real DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
