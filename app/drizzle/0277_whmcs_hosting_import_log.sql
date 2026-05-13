CREATE TABLE `whmcs_hosting_import_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`imported_at` text NOT NULL,
	`imported_by_user_id` text,
	`entity_type` text NOT NULL,
	`source_id` integer NOT NULL,
	`target_id` text NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
