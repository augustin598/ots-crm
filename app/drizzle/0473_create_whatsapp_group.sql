CREATE TABLE `whatsapp_group` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`group_jid` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`participant_count` integer DEFAULT 0 NOT NULL,
	`watched` number DEFAULT false NOT NULL,
	`client_id` text,
	`participants_json` text,
	`avatar_path` text,
	`avatar_mime_type` text,
	`avatar_fetched_at` timestamp,
	`last_synced_at` timestamp,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
