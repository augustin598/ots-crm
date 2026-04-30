CREATE UNIQUE INDEX `client_cui_per_tenant_unique` ON `client` (`tenant_id`, lower(`cui`)) WHERE `cui` IS NOT NULL;
