-- Facebook session cookies storage on integration
ALTER TABLE meta_ads_integration ADD COLUMN fb_session_cookies TEXT;--> statement-breakpoint
ALTER TABLE meta_ads_integration ADD COLUMN fb_session_status TEXT NOT NULL DEFAULT 'none';--> statement-breakpoint

-- Invoice downloads table (real Facebook billing PDF receipts)
CREATE TABLE IF NOT EXISTS meta_invoice_download (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  integration_id TEXT NOT NULL REFERENCES meta_ads_integration(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES client(id),
  meta_ad_account_id TEXT NOT NULL,
  ad_account_name TEXT,
  bm_name TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  pdf_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  downloaded_at INTEGER,
  error_message TEXT,
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS meta_invoice_dl_dedup
  ON meta_invoice_download(tenant_id, meta_ad_account_id, period_start);
