CREATE TABLE `workout_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`exercise` text NOT NULL,
	`kind` text NOT NULL,
	`weight_kg` real DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`sets` integer DEFAULT 0 NOT NULL,
	`duration_min` real DEFAULT 0 NOT NULL,
	`burned_kcal` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workout_logs_user_date_idx` ON `workout_logs` (`user_id`,`date`);--> statement-breakpoint
ALTER TABLE `meal_logs` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `height_cm` real;--> statement-breakpoint
ALTER TABLE `users` ADD `sex` text;--> statement-breakpoint
ALTER TABLE `users` ADD `goal_kcal` real;--> statement-breakpoint
ALTER TABLE `users` ADD `goal_carb_g` real;--> statement-breakpoint
ALTER TABLE `users` ADD `goal_protein_g` real;--> statement-breakpoint
ALTER TABLE `users` ADD `goal_fat_g` real;--> statement-breakpoint
ALTER TABLE `users` ADD `goal_burn_kcal` real;--> statement-breakpoint
ALTER TABLE `users` ADD `etag_secret` text;