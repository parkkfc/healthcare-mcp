CREATE TABLE `oauth_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text,
	`display_name` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_identities_provider_user_idx` ON `oauth_identities` (`provider`,`provider_user_id`);
--> statement-breakpoint
CREATE INDEX `oauth_identities_user_idx` ON `oauth_identities` (`user_id`);
--> statement-breakpoint
CREATE TABLE `oauth_login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`link_user_id` text,
	`user_id` text,
	`client_account_key` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_aliases` (
	`client_key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL
);
