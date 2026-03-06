-- Sprint 3: Optimistic locking, Audit trail, contractId FK

-- 1. Optimistic locking: version column on contract
ALTER TABLE contract ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- 2. Audit trail: contract_activity table
CREATE TABLE IF NOT EXISTS contract_activity (
    id TEXT PRIMARY KEY NOT NULL,
    contract_id TEXT NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
    user_id TEXT,
    tenant_id TEXT NOT NULL REFERENCES tenant(id),
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);
CREATE INDEX IF NOT EXISTS idx_contract_activity_contract ON contract_activity(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_activity_tenant ON contract_activity(tenant_id);

-- 3. contractId FK on invoice and recurring_invoice
ALTER TABLE invoice ADD COLUMN contract_id TEXT REFERENCES contract(id);
ALTER TABLE recurring_invoice ADD COLUMN contract_id TEXT REFERENCES contract(id);
CREATE INDEX IF NOT EXISTS idx_invoice_contract ON invoice(contract_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoice_contract ON recurring_invoice(contract_id);
