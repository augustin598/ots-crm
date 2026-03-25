-- Fix: dedup index must include client_id (one invoice can map to multiple clients)
DROP INDEX IF EXISTS `meta_ads_invoice_dedup`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meta_ads_invoice_dedup` ON `meta_ads_invoice` (`tenant_id`, `meta_invoice_id`, `client_id`);
