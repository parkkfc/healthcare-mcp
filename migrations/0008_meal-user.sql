DROP INDEX `meal_logs_date_idx`;--> statement-breakpoint
ALTER TABLE `meal_logs` ADD `user_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `meal_logs_user_date_idx` ON `meal_logs` (`user_id`,`date`);