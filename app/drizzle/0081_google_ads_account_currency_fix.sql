-- `currency_code` e creată deja de 0072_google_ads_accounts.sql, la instalările noi.
-- Fișierul ăsta exista doar ca să adauge coloana pe bazele mai vechi, și a rulat
-- peste tot. Conținutul original era `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
-- pe care SQLite nu-l acceptă: o bază curată murea aici, la migrarea 81 din 477.
-- Nu poate redeveni un ALTER simplu, fiindcă pe o bază curată coloana există deja.
SELECT 1;
