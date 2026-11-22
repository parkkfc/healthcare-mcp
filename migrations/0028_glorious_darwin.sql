ALTER TABLE `pending_workout_burns` ADD `note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `pending_workout_burns` ADD `distance_km` real DEFAULT 0 NOT NULL;