CREATE UNIQUE INDEX `client_hour_ledger_correction_uidx` ON `client_hour_ledger` (`tenant_id`,`source_id`) WHERE `kind` = 'correction';
