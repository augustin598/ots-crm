ALTER TABLE `invoice` ADD `currency` text DEFAULT 'RON' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `default_currency` text DEFAULT 'RON' NOT NULL;