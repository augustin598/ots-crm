CREATE TABLE `client_website` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`name` text,
	`url` text NOT NULL,
	`is_default` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

-- Populare automată din câmpul client.website existent
INSERT INTO `client_website` (`id`, `tenant_id`, `client_id`, `name`, `url`, `is_default`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(15))),
	`tenant_id`,
	`id`,
	'Site principal',
	`website`,
	1,
	datetime('now'),
	datetime('now')
FROM `client`
WHERE `website` IS NOT NULL AND trim(`website`) != '';

ALTER TABLE `seo_link` ADD `website_id` text REFERENCES `client_website`(`id`);
