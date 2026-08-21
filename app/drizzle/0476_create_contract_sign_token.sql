CREATE TABLE `contract_sign_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL UNIQUE,
	`contract_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`signing_url` text,
	`expires_at` timestamp NOT NULL,
	`used` number DEFAULT false NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contract`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
