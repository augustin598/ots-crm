CREATE TABLE `whatsapp_contact` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`phone_e164` text NOT NULL,
	`display_name` text,
	`push_name` text,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (current_timestamp),
	`updated_at` timestamp NOT NULL DEFAULT (current_timestamp)
);
