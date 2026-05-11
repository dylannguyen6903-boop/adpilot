-- ============================================================
-- Phase 1: Product Attribution Engine — Database Migration
-- Ticket: ADPILOT-PA-001 (SRS v1.2)
-- Date: 2026-05-11
-- ============================================================

-- 1. order_attributions (order-level attribution)
CREATE TABLE IF NOT EXISTS order_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Shopify order
  shopify_order_id TEXT NOT NULL,
  shopify_order_name TEXT,
  order_date DATE NOT NULL,
  total_revenue DECIMAL(10,2) NOT NULL,
  
  -- Attribution (from customerJourneySummary)
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  attribution_type TEXT DEFAULT 'unattributed',
    -- 'id_match', 'name_match', 'facebook_only', 'google_ads', 'organic_direct', 'unattributed'
  attribution_source TEXT,        -- raw source from customerJourneySummary
  matched_campaign_id TEXT,       -- resolved campaign_id from campaign_snapshots
  matched_campaign_name TEXT,     -- normalized campaign name used for matching
  
  -- Customer
  customer_email TEXT,
  is_returning_customer BOOLEAN DEFAULT false,
  
  -- Debug
  raw_landing_page TEXT,
  raw_referrer_url TEXT,
  journey_ready BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_oa_order_date ON order_attributions(order_date);
CREATE INDEX IF NOT EXISTS idx_oa_campaign_id ON order_attributions(matched_campaign_id);
CREATE INDEX IF NOT EXISTS idx_oa_attribution_type ON order_attributions(attribution_type);

-- 2. order_attribution_items (line-item level)
CREATE TABLE IF NOT EXISTS order_attribution_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_attribution_id UUID REFERENCES order_attributions(id) ON DELETE CASCADE,
  
  -- Product
  shopify_product_id TEXT,
  sku TEXT,
  product_title TEXT,
  product_type TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  item_revenue DECIMAL(10,2) NOT NULL,
  
  -- Collection mapping
  collection_key TEXT,  -- billiards, bowling, darts, fishing, other
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oai_order ON order_attribution_items(order_attribution_id);
CREATE INDEX IF NOT EXISTS idx_oai_collection ON order_attribution_items(collection_key);
CREATE INDEX IF NOT EXISTS idx_oai_product ON order_attribution_items(shopify_product_id);

-- 3. product_collection_cache
CREATE TABLE IF NOT EXISTS product_collection_cache (
  shopify_product_id TEXT PRIMARY KEY,
  
  canonical_collection TEXT,  -- billiards, bowling, darts, fishing, other
  product_type TEXT,
  product_title TEXT,
  
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. collection_performance_mv (materialized view)
-- Joins attribution items with campaign spend for P&L per collection
CREATE MATERIALIZED VIEW IF NOT EXISTS collection_performance_mv AS
SELECT
  oai.collection_key,
  oa.order_date,
  oa.matched_campaign_id AS campaign_id,
  oa.matched_campaign_name AS campaign_name,
  oa.attribution_type,
  
  -- Revenue metrics
  SUM(oai.item_revenue) AS collection_revenue,
  COUNT(DISTINCT oa.shopify_order_id) AS order_count,
  SUM(oai.quantity) AS items_sold,
  
  -- Revenue share for spend allocation
  CASE 
    WHEN SUM(SUM(oai.item_revenue)) OVER (PARTITION BY oa.matched_campaign_id, oa.order_date) > 0
    THEN SUM(oai.item_revenue) / SUM(SUM(oai.item_revenue)) OVER (PARTITION BY oa.matched_campaign_id, oa.order_date)
    ELSE 0
  END AS revenue_share_in_campaign

FROM order_attribution_items oai
JOIN order_attributions oa ON oa.id = oai.order_attribution_id
WHERE oa.attribution_type IN ('id_match', 'name_match')
GROUP BY oai.collection_key, oa.order_date, oa.matched_campaign_id, oa.matched_campaign_name, oa.attribution_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cpmv_key 
  ON collection_performance_mv(collection_key, order_date, campaign_id);
