ALTER TABLE `hosting_product` ADD `is_public` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hosting_product` ADD `public_sort_order` integer DEFAULT 0 NOT NULL;
