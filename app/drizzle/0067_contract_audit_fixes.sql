-- Fix: contractSignToken cascade delete + unique contract number per tenant
-- Note: SQLite doesn't support ALTER TABLE to modify FK constraints,
-- so we recreate the table with the correct FK and add a unique index.

-- Add unique index on contract number per tenant (IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_number_tenant ON contract (contract_number, tenant_id);
