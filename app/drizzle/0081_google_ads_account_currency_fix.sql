-- Add currency_code to google_ads_account for existing databases
-- Fresh installs already have this column via 0072_google_ads_accounts.sql
-- This migration safely adds the column only if it does not exist yet
ALTER TABLE `google_ads_account` ADD COLUMN IF NOT EXISTS `currency_code` text NOT NULL DEFAULT 'USD';
