CREATE UNIQUE INDEX IF NOT EXISTS `content_article_tenant_source_idx` ON `content_article` (`tenant_id`,`source_url`);
