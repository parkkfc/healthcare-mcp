CREATE TABLE `meal_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`food_name` text NOT NULL,
	`grams` real NOT NULL,
	`kcal` real NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meal_logs_date_idx` ON `meal_logs` (`date`);