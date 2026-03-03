-- BUG 1: Migrate existing URL materials from type='video' to type='url'
UPDATE marketing_material SET type = 'url' WHERE type = 'video' AND external_url IS NOT NULL AND file_path IS NULL;

-- BUG 9: Add indexes for query performance
CREATE INDEX IF NOT EXISTS idx_mm_tenant_client ON marketing_material(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_mm_tenant_category ON marketing_material(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_mm_status ON marketing_material(status);
