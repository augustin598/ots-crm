CREATE TABLE `da_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`hosting_account_id` text,
	`da_server_id` text,
	`action` text NOT NULL,
	`trigger` text NOT NULL,
	`invoice_id` text,
	`success` integer NOT NULL,
	`error_message` text,
	`duration_ms` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hosting_account_id`) REFERENCES `hosting_account`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`da_server_id`) REFERENCES `da_server`(`id`) ON UPDATE no action ON DELETE set null
);
