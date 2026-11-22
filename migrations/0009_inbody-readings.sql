CREATE TABLE `inbody_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`measured_on` text NOT NULL,
	`weight_kg` real NOT NULL,
	`skeletal_muscle_kg` real NOT NULL,
	`body_fat_kg` real NOT NULL,
	`body_fat_percent` real NOT NULL,
	`muscle_upper_left_kg` real NOT NULL,
	`muscle_upper_right_kg` real NOT NULL,
	`muscle_core_kg` real NOT NULL,
	`muscle_lower_left_kg` real NOT NULL,
	`muscle_lower_right_kg` real NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbody_readings_user_date_idx` ON `inbody_readings` (`user_id`,`measured_on`);