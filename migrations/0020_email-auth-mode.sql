ALTER TABLE `users` ADD `email` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);
--> statement-breakpoint
ALTER TABLE `oauth_login_attempts` ADD `mode` text DEFAULT 'login' NOT NULL;
