CREATE INDEX IF NOT EXISTS client_secondary_email_tenant_client_idx ON client_secondary_email(tenant_id, client_id);
