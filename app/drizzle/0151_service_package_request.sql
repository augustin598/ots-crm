CREATE TABLE `service_package_request` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text REFERENCES `client`(`id`),
	`client_user_id` text REFERENCES `client_user`(`id`),
	`category_slug` text NOT NULL,
	`tier` text NOT NULL,
	`note` text,
	`status` text NOT NULL DEFAULT 'pending',
	`contacted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (current_timestamp),
	`updated_at` timestamp NOT NULL DEFAULT (current_timestamp)
);
