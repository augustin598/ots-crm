CREATE TABLE IF NOT EXISTS `ads_account_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`platform` text NOT NULL,
	`ads_account_id` text NOT NULL,
	`monthly_budget` integer,
	`is_active` integer NOT NULL DEFAULT 1,
	`created_at` text NOT NULL DEFAULT (current_date),
	`updated_at` text NOT NULL DEFAULT (current_date)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ads_account_budget_acc_idx` ON `ads_account_budget` (`ads_account_id`);
