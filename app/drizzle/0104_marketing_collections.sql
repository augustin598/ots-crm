CREATE TABLE `marketing_collection` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`created_at` timestamp NOT NULL DEFAULT current_timestamp,
	`updated_at` timestamp NOT NULL DEFAULT current_timestamp
);
