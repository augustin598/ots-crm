CREATE TABLE IF NOT EXISTS `ads_account_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`platform` text NOT NULL,
	`ads_account_id` text NOT NULL,
	`monthly_budget` integer,
	`is_active` number DEFAULT true NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ads_account_budget_acc_idx` ON `ads_account_budget` (`ads_account_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketing_collection` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketing_collection_material` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`material_id` text NOT NULL,
	`added_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `marketing_collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `marketing_material`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `report_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`frequency` text DEFAULT 'disabled' NOT NULL,
	`day_of_week` integer DEFAULT 1,
	`day_of_month` integer DEFAULT 1,
	`platforms` text DEFAULT '["meta","google","tiktok"]' NOT NULL,
	`recipient_emails` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`last_sent_at` timestamp,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `saved_report_view` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`filters` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `client` ADD `monthly_budget` integer;--> statement-breakpoint
ALTER TABLE `client_user_preferences` ADD `onboarding_tour_completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `client_user_preferences` ADD `onboarding_tour_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `client_user_preferences` ADD `onboarding_checklist` text;--> statement-breakpoint
ALTER TABLE `meta_ads_account` ADD `account_status` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_ads_account` ADD `disable_reason` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant` ADD `favicon` text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `lead_tenant_external_platform_idx` ON `lead` (`tenant_id`,`external_lead_id`,`platform`);