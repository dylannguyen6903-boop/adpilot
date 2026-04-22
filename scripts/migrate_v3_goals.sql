-- AdPilot V3.0 Migration — Goal-Driven Planning
-- Run in Supabase Dashboard > SQL Editor

-- Monthly profit target for goal-driven planning
ALTER TABLE business_profiles 
  ADD COLUMN IF NOT EXISTS monthly_profit_target NUMERIC DEFAULT 15000;
