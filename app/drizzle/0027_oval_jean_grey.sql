ALTER TABLE `anaf_spv_integration` ALTER COLUMN "access_token" TO "access_token" text;--> statement-breakpoint
ALTER TABLE `anaf_spv_integration` ALTER COLUMN "refresh_token" TO "refresh_token" text;--> statement-breakpoint
ALTER TABLE `anaf_spv_integration` ADD `client_id` text;--> statement-breakpoint
ALTER TABLE `anaf_spv_integration` ADD `client_secret` text;