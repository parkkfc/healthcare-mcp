CREATE TABLE `workout_week_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`venue` text NOT NULL,
	`home_equipment` text DEFAULT '' NOT NULL,
	`fingerprint` text NOT NULL,
	`plan_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workout_week_plans_user_week_venue_uidx` ON `workout_week_plans` (`user_id`,`week_start`,`venue`,`home_equipment`);--> statement-breakpoint
CREATE INDEX `workout_week_plans_user_week_idx` ON `workout_week_plans` (`user_id`,`week_start`);