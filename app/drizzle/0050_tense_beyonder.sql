CREATE TABLE `bnr_exchange_rate` (
	`id` text PRIMARY KEY NOT NULL,
	`currency` text NOT NULL,
	`rate` real NOT NULL,
	`multiplier` integer DEFAULT 1,
	`rate_date` text NOT NULL,
	`fetched_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bnr_rate_currency_date_idx` ON `bnr_exchange_rate` (`currency`,`rate_date`);