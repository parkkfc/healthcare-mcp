CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tone_level` integer,
	`hand_length_cm` real,
	`hand_width_cm` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `users` (`id`, `tone_level`, `hand_length_cm`, `hand_width_cm`, `created_at`, `updated_at`)
SELECT
	p.`id`,
	t.`tone_level`,
	p.`hand_length_cm`,
	p.`hand_width_cm`,
	p.`updated_at`,
	p.`updated_at`
FROM `user_profiles` p
LEFT JOIN `trainer_settings` t ON t.`id` = p.`id`
UNION
SELECT
	t.`id`,
	t.`tone_level`,
	NULL,
	NULL,
	t.`updated_at`,
	t.`updated_at`
FROM `trainer_settings` t
WHERE NOT EXISTS (
	SELECT 1 FROM `user_profiles` p WHERE p.`id` = t.`id`
);
--> statement-breakpoint
DROP TABLE `trainer_settings`;
--> statement-breakpoint
DROP TABLE `user_profiles`;
