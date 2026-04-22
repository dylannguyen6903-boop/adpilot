-- AdPilot V3.0 Migration — Smart Campaign Intelligence Engine
-- Run this manually in Supabase SQL Editor

-- Add funnel metrics to campaign_snapshots
ALTER TABLE campaign_snapshots 
  ADD COLUMN IF NOT EXISTS add_to_cart INTEGER DEFAULT 0;
ALTER TABLE campaign_snapshots 
  ADD COLUMN IF NOT EXISTS initiate_checkout INTEGER DEFAULT 0;
ALTER TABLE campaign_snapshots 
  ADD COLUMN IF NOT EXISTS landing_page_views INTEGER DEFAULT 0;
