CREATE UNIQUE INDEX IF NOT EXISTS `email_suppression_unique_idx` ON `email_suppression` (`tenant_id`, `email`);
