CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_invoice_txid ON meta_invoice_download(tenant_id, txid) WHERE txid IS NOT NULL;
