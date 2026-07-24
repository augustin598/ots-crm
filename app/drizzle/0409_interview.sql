CREATE TABLE IF NOT EXISTS `interview` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`nume` text NOT NULL,
	`data_interviu` text NOT NULL,
	`data_inceput` text,
	`data_sfarsit` text,
	`studio` text DEFAULT 'Heylux Studio' NOT NULL,
	`sursa` text,
	`channel_id` text NOT NULL,
	`status` text DEFAULT 'in_evaluare' NOT NULL,
	`observatii` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `interview_channel`(`id`) ON UPDATE no action ON DELETE no action
);
