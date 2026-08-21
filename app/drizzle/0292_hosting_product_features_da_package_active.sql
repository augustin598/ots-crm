ALTER TABLE `hosting_product` ADD `features` text;--> statement-breakpoint
ALTER TABLE `hosting_product` ADD `highlight_badge` text;--> statement-breakpoint
ALTER TABLE `hosting_product` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `da_package` ADD `is_active` integer DEFAULT 1 NOT NULL;
