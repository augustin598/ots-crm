-- Romania standard VAT moved 19% -> 21% in 2025. Bump every tenant still defaulting
-- to the old rate so NEW invoices/contracts default to 21%. Existing issued invoices
-- keep their stored per-invoice `tax_rate` (historical) and are unaffected. Application
-- code already resolves a missing setting to DEFAULT_VAT_PERCENT (21) via $lib/utils/vat.
-- Tenants deliberately on another rate (e.g. a reduced 9%) are left untouched.
UPDATE `invoice_settings` SET `default_tax_rate` = 21 WHERE `default_tax_rate` = 19;
