CREATE INDEX IF NOT EXISTS `content_article_tenant_website_publish_idx` ON `content_article` (`tenant_id`, `website_id`, `publish_status`);
