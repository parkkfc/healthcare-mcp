ALTER TABLE `users` DROP COLUMN `last_auth_email`;
--> statement-breakpoint
ALTER TABLE `oauth_login_attempts` DROP COLUMN `link_user_id`;
