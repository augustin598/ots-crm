CREATE UNIQUE INDEX IF NOT EXISTS `ads_optimization_task_day_unique` ON `ads_optimization_task` (`tenant_id`,`target_id`,`scheduled_for`);
