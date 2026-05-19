CREATE INDEX IF NOT EXISTS task_tenant_created_idx ON task(tenant_id, created_at DESC);
