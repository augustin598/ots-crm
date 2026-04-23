-- Paused flag: scheduler (uptime ping + updates check) skips this site.
-- Manual actions in the CRM still work — user can click Refresh / Apply etc.
ALTER TABLE `wordpress_site` ADD COLUMN `paused` integer NOT NULL DEFAULT 0;
