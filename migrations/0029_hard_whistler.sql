CREATE TABLE `pending_meal_portions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`foods_json` text DEFAULT '[]' NOT NULL,
	`palm_comparison` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
