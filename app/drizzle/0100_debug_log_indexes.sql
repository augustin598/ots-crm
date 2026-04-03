CREATE INDEX IF NOT EXISTS `idx_debug_log_tenant_created` ON `debug_log` (`tenant_id`, `created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_debug_log_level` ON `debug_log` (`level`);
