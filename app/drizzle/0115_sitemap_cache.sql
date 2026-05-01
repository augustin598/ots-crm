CREATE TABLE IF NOT EXISTS `sitemap_cache` (
	`url` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`content_lastmod` text,
	`byte_size` integer DEFAULT 0 NOT NULL,
	`fetched_at` timestamp DEFAULT current_date NOT NULL,
	`expires_at` timestamp NOT NULL
);
