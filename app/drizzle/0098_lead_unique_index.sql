-- Add unique index to prevent future duplicate leads
CREATE UNIQUE INDEX IF NOT EXISTS lead_tenant_external_platform_idx
  ON lead(tenant_id, external_lead_id, platform);
