CREATE TABLE `marketing_fixed_cost` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`note` text,
	`qty` real DEFAULT 1 NOT NULL,
	`unit_amount_cents` integer DEFAULT 0 NOT NULL,
	`unit_label` text,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`active` number DEFAULT true NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`created_by` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
