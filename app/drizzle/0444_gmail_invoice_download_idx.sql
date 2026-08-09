CREATE UNIQUE INDEX IF NOT EXISTS `gmail_invoice_download_uq` ON `gmail_invoice_download` (`tenant_id`,`gmail_message_id`,`attachment_filename`);
