ALTER TABLE `hosting_product` ADD `features` text;
ALTER TABLE `hosting_product` ADD `highlight_badge` text;
ALTER TABLE `hosting_product` ADD `sort_order` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `is_active` integer DEFAULT 1 NOT NULL;
