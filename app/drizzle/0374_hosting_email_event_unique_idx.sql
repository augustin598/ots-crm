CREATE UNIQUE INDEX `hosting_email_event_unique` ON `hosting_email_event` (`tenant_id`, `hosting_account_id`, `dedupe_key`);
