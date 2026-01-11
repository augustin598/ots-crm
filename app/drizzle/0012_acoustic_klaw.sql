CREATE TABLE `revolut_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text,
	`private_key` text NOT NULL,
	`public_certificate` text NOT NULL,
	`redirect_uri` text,
	`is_active` number DEFAULT true NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revolut_integration_tenant_id_unique` ON `revolut_integration` (`tenant_id`);