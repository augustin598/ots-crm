ALTER TABLE `client_secondary_email` ADD `notify_invoices` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `client_secondary_email` ADD `notify_tasks` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `client_secondary_email` ADD `notify_contracts` integer DEFAULT false NOT NULL;