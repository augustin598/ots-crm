-- Add missing refresh tracking columns to tiktok_ads_integration
ALTER TABLE `tiktok_ads_integration` ADD COLUMN `last_refresh_attempt_at` timestamp;--> statement-breakpoint
ALTER TABLE `tiktok_ads_integration` ADD COLUMN `last_refresh_error` text;--> statement-breakpoint
ALTER TABLE `tiktok_ads_integration` ADD COLUMN `consecutive_refresh_failures` integer DEFAULT 0;
