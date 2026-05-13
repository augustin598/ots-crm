-- daPackage: expand to mirror DirectAdmin's Edit Package UI 1:1.
ALTER TABLE `da_package` ADD `max_email_forwarders` integer;
ALTER TABLE `da_package` ADD `max_mailing_lists` integer;
ALTER TABLE `da_package` ADD `max_autoresponders` integer;
ALTER TABLE `da_package` ADD `max_domain_pointers` integer;
ALTER TABLE `da_package` ADD `email_daily_limit` integer;
ALTER TABLE `da_package` ADD `anonymous_ftp` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `cgi` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `php` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `ssl` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `ssh` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `dns_control` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `cron` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `spam` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `clamav` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `wordpress` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `git` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `redis` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `suspend_at_limit` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `oversold` integer DEFAULT 0 NOT NULL;
ALTER TABLE `da_package` ADD `skin` text;
ALTER TABLE `da_package` ADD `language` text;

-- daServer: structured sync-result history
ALTER TABLE `da_server` ADD `last_sync_result` text;
