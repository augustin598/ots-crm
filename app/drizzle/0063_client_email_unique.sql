-- Email uniqueness per tenant (SQLite allows multiple NULLs in unique indexes)
CREATE UNIQUE INDEX IF NOT EXISTS `client_email_tenant_idx` ON `client` (`tenant_id`, `email`);
