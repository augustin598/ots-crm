CREATE TABLE `wordpress_security_event` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`site_id` text NOT NULL REFERENCES `wordpress_site`(`id`),
	`event_uid` text NOT NULL,
	`occurred_at` timestamp NOT NULL,
	`sentinel_sev` text NOT NULL,
	`level` text NOT NULL,
	`event` text NOT NULL,
	`username` text,
	`ip` text,
	`uri` text,
	`user_agent` text,
	`data` text,
	`created_at` timestamp NOT NULL DEFAULT current_timestamp
);
