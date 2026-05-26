CREATE TABLE hosting_inquiry_item (
  id TEXT PRIMARY KEY NOT NULL,
  inquiry_id TEXT NOT NULL REFERENCES hosting_inquiry(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  hosting_product_id TEXT REFERENCES hosting_product(id) ON DELETE SET NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  vat_rate INTEGER NOT NULL DEFAULT 19,
  domain_name TEXT,
  domain_mode TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
