-- Marketing material indexes for query performance
CREATE INDEX IF NOT EXISTS idx_marketing_material_tenant_client ON marketing_material (tenant_id, client_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_marketing_material_tenant_category ON marketing_material (tenant_id, category);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_marketing_material_tenant_created ON marketing_material (tenant_id, created_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_marketing_material_tenant_client_category ON marketing_material (tenant_id, client_id, category);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_task_marketing_material_task ON task_marketing_material (task_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_task_marketing_material_material ON task_marketing_material (marketing_material_id);
