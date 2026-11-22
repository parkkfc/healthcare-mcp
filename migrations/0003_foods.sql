CREATE TABLE `foods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`food_code` text NOT NULL,
	`food_name` text NOT NULL,
	`category` text NOT NULL,
	`basis` text NOT NULL,
	`kcal` real,
	`carb_g` real,
	`protein_g` real,
	`fat_g` real,
	`serving_ref` text,
	`serving_weight` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `foods_food_code_unique` ON `foods` (`food_code`);--> statement-breakpoint
CREATE INDEX `foods_category_idx` ON `foods` (`category`);