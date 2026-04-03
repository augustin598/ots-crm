ALTER TABLE `meta_ads_account` ADD COLUMN `account_status` integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE `meta_ads_account` ADD COLUMN `disable_reason` integer DEFAULT 0;
