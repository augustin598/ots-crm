CREATE TABLE `stripe_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text,
	`account_name` text,
	`account_email` text,
	`secret_key_encrypted` text NOT NULL,
	`publishable_key` text NOT NULL,
	`webhook_secret_encrypted` text,
	`is_test_mode` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`last_tested_at` text,
	`last_error` text,
	`created_at` text DEFAULT (current_date) NOT NULL,
	`updated_at` text DEFAULT (current_date) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`)
);
CREATE UNIQUE INDEX `stripe_integration_tenant_id_unique` ON `stripe_integration` (`tenant_id`);
CREATE INDEX `stripe_integration_tenant_idx` ON `stripe_integration` (`tenant_id`);
