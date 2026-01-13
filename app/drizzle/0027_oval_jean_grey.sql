DROP INDEX "anaf_spv_integration_tenant_id_unique";--> statement-breakpoint
DROP INDEX "email_settings_tenant_id_unique";--> statement-breakpoint
DROP INDEX "invitation_token_unique";--> statement-breakpoint
DROP INDEX "invoice_settings_tenant_id_unique";--> statement-breakpoint
DROP INDEX "keez_integration_tenant_id_unique";--> statement-breakpoint
DROP INDEX "magic_link_token_token_unique";--> statement-breakpoint
DROP INDEX "plugin_name_unique";--> statement-breakpoint
DROP INDEX "revolut_integration_tenant_id_unique";--> statement-breakpoint
DROP INDEX "smartbill_integration_tenant_id_unique";--> statement-breakpoint
DROP INDEX "task_settings_tenant_id_unique";--> statement-breakpoint
DROP INDEX "tenant_slug_unique";--> statement-breakpoint
DROP INDEX "tenant_cui_unique";--> statement-breakpoint
DROP INDEX "user_email_unique";--> statement-breakpoint
ALTER TABLE `anaf_spv_integration` ALTER COLUMN "access_token" TO "access_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX `anaf_spv_integration_tenant_id_unique` ON `anaf_spv_integration` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_settings_tenant_id_unique` ON `email_settings` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_unique` ON `invitation` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_settings_tenant_id_unique` ON `invoice_settings` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `keez_integration_tenant_id_unique` ON `keez_integration` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `magic_link_token_token_unique` ON `magic_link_token` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_name_unique` ON `plugin` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `revolut_integration_tenant_id_unique` ON `revolut_integration` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `smartbill_integration_tenant_id_unique` ON `smartbill_integration` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_settings_tenant_id_unique` ON `task_settings` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_slug_unique` ON `tenant` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_cui_unique` ON `tenant` (`cui`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
ALTER TABLE `anaf_spv_integration` ALTER COLUMN "refresh_token" TO "refresh_token" text;--> statement-breakpoint
ALTER TABLE `anaf_spv_integration` ADD `client_id` text;--> statement-breakpoint
ALTER TABLE `anaf_spv_integration` ADD `client_secret` text;