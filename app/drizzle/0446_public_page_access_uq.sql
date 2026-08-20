CREATE UNIQUE INDEX IF NOT EXISTS `public_page_access_tenant_page_uq` ON `public_page_access` (`tenant_id`,`page_key`);
