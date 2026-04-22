ALTER TABLE `google_ads_account` ADD COLUMN `integration_id` text REFERENCES `google_ads_integration`(`id`);
