# AdPilot Phase 1: Product Attribution Engine - Audit Report

> **Ticket ID**: ADPILOT-PA-001
> **Version**: Phase 1 Complete
> **Date**: 2026-05-11
> **Author**: Antigravity (Windows Agent)
> **Reviewer**: May (Mac Pro Agent)
> **Status**: ✅ PHASE 1 DEPLOYED & VERIFIED

---

## Executive Summary

Phase 1 of the Product Attribution Engine has been successfully deployed to production. The system now attributes Shopify orders to Facebook campaigns at the product level, enabling Collection-level P&L analysis.

| Metric | Target | Actual |
|---|---|---|
| Paid FB Attribution | >= 50% | **87%** (47/54 FB orders) |
| Attribution Sync | < 30s | **9.9s** (106 orders) |
| Orders Processed | 7-day window | **106 orders** |
| Line Items Persisted | All | **462 items** |
| Products Cached | Auto | **78 unique products** |
| Build Status | Pass | ✅ Pass |

---

## Phase 0 Recap: Data Quality Audit

### Bugs Fixed (5 total)

| # | Bug | Impact | Fix |
|---|---|---|---|
| 1 | TS build error (circular type inference) | 404 on production | Added explicit `: Response` type annotation |
| 2 | Stale Shopify token in DB | 401 API errors | Synced DB with current `.env.local` token |
| 3 | Supabase 500-row query limit | Coverage dropped to 10% | Reversed logic: fetch orders first, query DB by ID |
| 4 | Facebook sync excluding archived campaigns | Missing historical campaign data | Built campaign map from BOTH fetchCampaigns AND insights |
| 5 | Organic traffic misclassified as "unmatched" | Coverage reported 44% instead of 87% | Added `google_ads` and `organic_direct` categories |

### Final Audit v3 Results

```json
{
  "paid_fb_coverage_percent": 87,
  "paid_fb_orders": 54,
  "paid_fb_matched": 47,
  "go_no_go": "🟢 GO"
}
```

**Traffic Classification (106 orders):**

| Category | Orders | Revenue | Notes |
|---|---|---|---|
| ✅ id_match | 47 | $4,200.25 | Campaign ID matched |
| 📘 facebook_only | 6 | — | FB source, no campaign UTM |
| 🔵 google_ads | 18 | $3,338.73 | Google Shopping (out of FB scope) |
| ⚪ organic_direct | 34 | $3,914.57 | Organic, Shopify app, direct |
| ❓ unattributed | 1 | $37.41 | No source data |

---

## Phase 1 Implementation

### Database Schema (3 tables)

#### 1. `order_attributions` (order-level)
- Primary key: `shopify_order_id` (UNIQUE)
- Fields: UTM parameters, attribution type, matched campaign ID/name, customer data, debug fields
- Indexes: `order_date`, `matched_campaign_id`, `attribution_type`

#### 2. `order_attribution_items` (line-item level)
- Foreign key: `order_attribution_id` → `order_attributions(id) ON DELETE CASCADE`
- Fields: product ID, SKU, title, type, quantity, item_revenue, collection_key
- Indexes: `order_attribution_id`, `collection_key`, `shopify_product_id`

#### 3. `product_collection_cache` (product → collection mapping)
- Primary key: `shopify_product_id`
- Fields: canonical_collection, product_type, product_title
- Auto-populated during sync

### Attribution Logic (`src/lib/attribution.ts`)

**Matching Priority Chain:**
1. **Priority A**: `utm_campaign` numeric ID → `campaign_snapshots.campaign_id` (87% coverage)
2. **Priority B**: `utm_source` campaign name → `campaign_snapshots.campaign_name`
3. **Priority C**: `source`/`referrerUrl` classification (Facebook, Google, organic)

**Collection Inference:**
- Keyword-based mapping from product title/type → collection (billiards, bowling, darts, fishing, other)
- Cached in `product_collection_cache` for performance
- 78 products auto-classified on first sync

### API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/shopify/attribution-sync` | GET/POST | Run attribution pipeline (7-90 days) |
| `/api/shopify/collections` | GET | Collection P&L (revenue/spend/profit/ROAS) |
| `/api/shopify/attribution-audit` | GET | Data quality audit (v3) |

### Performance

| Operation | Time |
|---|---|
| Shopify order fetch (106 orders, paginated) | ~4s |
| Campaign lookup (36 unique IDs) | ~1s |
| Attribution matching (106 orders) | <100ms |
| Batch DB writes (106 orders + 462 items + 78 cache) | ~4s |
| **Total** | **9.9s** |

Optimization: Batch DB writes reduced calls from ~500 (1 per order) to ~6 (chunked upserts).

---

## Spend Allocation Logic (Per SRS v1.2)

```
Campaign X spent $100 today, sold 3 orders:
  - Order A: $30 billiard shirt  → billiards share = 30%
  - Order B: $50 bowling shirt   → bowling share = 50%
  - Order C: $20 billiard shirt  → billiards share = 20%

Attributed spend:
  - Billiards: $100 × 50% = $50  (30+20 / 100)
  - Bowling:   $100 × 50% = $50  (50 / 100)
```

No double-counting. Revenue share is calculated per campaign per day.

---

## Remaining Items

### 3 Unmatched FB Orders ($340.50, 2.8% of total revenue)

| utm_source | utm_campaign | Revenue | Issue |
|---|---|---|---|
| `img2` | (none) | $139.21 | Custom UTM, no campaign ID |
| `7.5 - bia240426 - 1 - copy` | `120245072007100253` | $46.80 | Campaign from unsupported ad account |
| `bowling18112` | `26.12 - BIA BOWLING DARTS - ASC` | $154.49 | utm_campaign contains NAME not ID |

**Resolution**: Campaign aliases table (Phase 1.5) or manual mapping.

### 19 Duplicate Campaign Names

19 campaign names map to multiple campaign IDs (e.g., "18.4 - bowling0703" → 2 IDs). These don't currently affect attribution since orders use numeric IDs, but should be monitored.

---

## Verification Checklist

- [x] Phase 0 audit: 87% paid FB coverage (>50% gate)
- [x] Database migration: 3 tables created on Supabase
- [x] Attribution sync: 106 orders processed, 462 items persisted
- [x] Batch performance: 9.9s (well within 120s timeout)
- [x] Collection P&L endpoint: Deployed
- [x] Build passes: `npm run build` exit code 0
- [x] Production deployment: Vercel (adpilot1.vercel.app)
- [x] Idempotent: Re-running sync updates existing records

---

## Files Changed

### New Files
| File | Purpose |
|---|---|
| `src/lib/attribution.ts` | Core attribution engine (matching, persistence, collection inference) |
| `src/app/api/shopify/attribution-sync/route.ts` | Attribution sync endpoint (GET/POST) |
| `src/app/api/shopify/collections/route.ts` | Collection P&L API |
| `supabase/migrate_product_attribution.sql` | Database migration script |

### Modified Files
| File | Change |
|---|---|
| `src/app/api/shopify/attribution-audit/route.ts` | Upgraded to v3 (traffic classification) |
| `src/app/api/facebook/sync/route.ts` | Include archived/deleted campaigns from insights |

---

## Next Steps: Phase 2 (Customer LTV)

1. `customer_ltv` table + aggregation
2. First-touch campaign attribution
3. LTV/CAC ratio calculation
4. Customer cohort dashboard
5. AI budget allocation suggestions

> **Recommendation**: Phase 1 is production-ready. Recommend monitoring for 1 week before proceeding to Phase 2.
