CREATE TABLE `whatsapp_session` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`status` text NOT NULL,
	`phone_e164` text,
	`display_name` text,
	`storage_path` text NOT NULL,
	`last_connected_at` timestamp,
	`last_disconnected_at` timestamp,
	`last_error` text,
	`created_at` timestamp NOT NULL DEFAULT (current_timestamp),
	`updated_at` timestamp NOT NULL DEFAULT (current_timestamp)
);
