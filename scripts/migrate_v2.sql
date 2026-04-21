-- AdPilot V2.0 Migration
ALTER TABLE campaign_snapshots ADD COLUMN IF NOT EXISTS fb_status TEXT DEFAULT 'ACTIVE';
ALTER TABLE campaign_snapshots ADD COLUMN IF NOT EXISTS effective_status TEXT DEFAULT 'ACTIVE';
ALTER TABLE campaign_snapshots ADD COLUMN IF NOT EXISTS campaign_created_time TIMESTAMPTZ;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS ai_api_key TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'openai';
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'gpt-4o-mini';
