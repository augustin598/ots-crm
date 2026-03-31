ALTER TABLE `meta_ads_page` ADD COLUMN `client_id` text REFERENCES `client`(`id`);
