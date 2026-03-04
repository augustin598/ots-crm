ALTER TABLE marketing_material ADD COLUMN campaign_type TEXT;
CREATE INDEX IF NOT EXISTS idx_mm_campaign_type ON marketing_material(campaign_type);
