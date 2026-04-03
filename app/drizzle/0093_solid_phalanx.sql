ALTER TABLE `gmail_integration` ADD `last_refresh_attempt_at` timestamp;--> statement-breakpoint
ALTER TABLE `gmail_integration` ADD `last_refresh_error` text;--> statement-breakpoint
ALTER TABLE `gmail_integration` ADD `consecutive_refresh_failures` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `google_ads_integration` ADD `last_refresh_attempt_at` timestamp;--> statement-breakpoint
ALTER TABLE `google_ads_integration` ADD `last_refresh_error` text;--> statement-breakpoint
ALTER TABLE `google_ads_integration` ADD `consecutive_refresh_failures` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `meta_ads_integration` ADD `last_refresh_attempt_at` timestamp;--> statement-breakpoint
ALTER TABLE `meta_ads_integration` ADD `last_refresh_error` text;--> statement-breakpoint
ALTER TABLE `meta_ads_integration` ADD `consecutive_refresh_failures` integer DEFAULT 0;--> statement-breakpoint
-- meta_ads_page.client_id already exists from prior manual migration
SELECT 1;--> statement-breakpoint
-- tiktok columns already exist from prior manual migration
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;
