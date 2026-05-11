# SRS v1.2: Product-Level Attribution Engine cho AdPilot

> **Ticket ID**: ADPILOT-PA-001
> **Version**: 1.2 (updated: adapt UTM hiện tại, không re-publish ads)
> **Ngày tạo**: 2026-05-10
> **Ngày cập nhật**: 2026-05-11
> **Tạo bởi**: Antigravity (Windows Agent)
> **Review bởi**: May (Mac Pro Agent)
> **Priority**: P1

---

## Changelog

### v1.1 (May review)
- ✅ Sửa data source: `customerJourneySummary` thay vì `order.landingSite` (May P1)
- ✅ Tách `order_attribution` thành 2 tables: order-level + line-item level (May P2)
- ✅ `collection_performance` → materialized view (May P3)
- ✅ Thêm spend allocation logic (revenue share) (May P4)
- ✅ Thêm Phase 0: Data Quality Audit

### v1.2 (Owner feedback)
- ✅ Adapt UTM hiện tại: `utm_source={{campaign.name}}` (KHÔNG re-publish ads)
- ✅ Matching strategy: campaign name → campaign_snapshots (thay vì campaign ID)
- ✅ Granularity: campaign-level (đủ cho Collection P&L)
- ✅ Bỏ requirement setup UTM mới cho ads đang chạy
- ✅ Ads mới tạo sau này: khuyến nghị UTM chuẩn nhưng không bắt buộc

---

## 1. WHAT — Yêu cầu

### Mô tả ngắn
Xây dựng hệ thống Product-Level Attribution cho AdPilot, kết nối dữ liệu Facebook Ads (campaign/adset/ad) với dữ liệu Shopify Orders (products/collections/customers) để:
- Biết **ad nào bán được product nào**
- Biết **collection nào (billiard/bowling/darts/fishing) đang lãi/lỗ** khi tính cả ad spend
- Biết **customer nào từ paid ads có giá trị cao** (LTV tracking, Phase 2)

### Context
Store frenzidea.com có 5-7k products POD, chạy Facebook Ads. Hiện AdPilot chỉ link:
```
Facebook Ads (spend) + Shopify Orders (total revenue) = ROAS tổng
```
Thiếu layer: product-level và customer-level attribution.

---

## 2. WHY — Tại sao cần

- **5-7k products** → không thể chạy ads cho tất cả, phải chọn đúng product
- **POD margin mỏng** (~40-50%) → mỗi $ budget đặt sai = lỗ thật
- **Competitor advantage**: Đối thủ POD chỉ nhìn ROAS tổng. Product-level data = biết đổ budget vào đâu chính xác

---

## 3. STRUCTURE — Kiến trúc (Updated per May review)

### Current State (AS-IS)

```
Facebook campaign_snapshots ──┐
                               ├── JOIN on: date only (LOOSE) → ROAS tổng
Shopify daily_financials  ─────┘
```

### Target State (TO-BE)

```
┌──────────────────┐    ┌─────────────────────┐    ┌────────────────────┐
│  Facebook Ads    │    │  ORDER ATTRIBUTIONS  │    │  Shopify Orders    │
│  campaign_       │    │  (order-level)       │    │  + Line Items      │
│  snapshots       │    │  ───────────────     │    │  ──────────────    │
│  ─────────────   │    │  order_id            │    │  order_id          │
│  campaign_id  ◄──┼────│  campaign_id         │────┼►─product_title     │
│  spend           │    │  adset_id            │    │  product_type      │
│                  │    │  ad_id               │    │  sku               │
│                  │    │  utm_source/medium    │    │  price, quantity   │
│                  │    │  attribution_status   │    │  customer_email    │
│                  │    │  total_revenue        │    │                    │
└──────────────────┘    └─────────┬───────────┘    └────────────────────┘
                                  │
                    ┌─────────────┴────────────────┐
                    │  ORDER ATTRIBUTION ITEMS      │
                    │  (line-item level)             │
                    │  ──────────────────            │
                    │  order_id                      │
                    │  product_id, sku, title         │
                    │  quantity, item_revenue         │
                    │  collection_key                 │
                    └─────────────┬────────────────┘
                                  │
                    ┌─────────────┴────────────────┐
                    │  PRODUCT COLLECTION CACHE     │
                    │  ──────────────────            │
                    │  product_id → collection_key   │
                    │  product_type, tags             │
                    └─────────────┬────────────────┘
                                  │
                    ┌─────────────┴────────────────┐
                    │  COLLECTION P&L VIEW          │
                    │  (materialized view)           │
                    │  ──────────────────            │
                    │  collection_key                │
                    │  total_revenue                  │
                    │  attributed_spend (by rev %)    │
                    │  profit, roas                   │
                    │  top_products                   │
                    └──────────────────────────────┘
```

---

## 4. FLOW — Luồng dữ liệu (Updated)

### Phase 0: Data Quality Audit (TRƯỚC KHI CODE)

```
Script chạy 1 lần → fetch 7 ngày orders gần nhất → report:
- Tổng orders
- % orders có customerJourneySummary.ready = true
- % orders có utm_source chứa campaign name
- % campaign names match được với campaign_snapshots
- % products có collection mapping
- % orders "unattributed" (không UTM, không referrer)
→ Nếu attribution coverage < 30% → STOP, investigate
→ Nếu > 50% → GO, proceed Phase 1
```

### UTM Matching Strategy (v1.2)

```
Owner's existing UTM: utm_source={{campaign.name}}

Matching flow:
  Order.customerJourneySummary.firstVisit.utmParameters.source
  → "Summer Billiard 2026"  (campaign NAME)
  → Normalize: lowercase, trim
  → Match against: campaign_snapshots.campaign_name (normalized)
  → Found? → campaign_id, spend data
  → Not found? → mark as 'utm_unmatched', log for review

Fallback chain:
  1. utm_source → campaign name match
  2. customerJourneySummary.firstVisit.source (e.g. "facebook")
  3. referrerUrl contains "facebook.com"
  4. None → 'unattributed'
```

### Phase 1: Product Attribution (sau Phase 0 pass)

```
Step 1: Shopify sync fetches orders + customerJourneySummary
        GraphQL query: customerJourneySummary {
          ready
          firstVisit { landingPage, referrerUrl, source, utmParameters { source, medium, campaign, content, term } }
          lastVisit { ... }
        }

Step 2: Parse UTM from customerJourneySummary
        utm_source → campaign name → lookup campaign_id from campaign_snapshots
        (Fallback: source field, referrerUrl)

Step 3: Fetch lineItems with product details
        lineItems { product { id, productType, collections(first:3) { edges { node { title } } } } }

Step 4: Save to order_attributions (order-level)
        + order_attribution_items (per line item)

Step 5: Update product_collection_cache (if product not cached)

Step 6: Refresh materialized view: collection_performance_mv

Step 7: Dashboard reads from collection_performance_mv
```

### Spend Allocation Logic (May's correction)

```
Problem: Campaign X spent $100 today, sold 3 orders:
  - Order A: $30 billiard shirt
  - Order B: $50 bowling shirt  
  - Order C: $20 billiard shirt

Total revenue = $100
Billiard share = $50/$100 = 50%
Bowling share = $50/$100 = 50%

Attributed spend:
  - Billiard: $100 × 50% = $50
  - Bowling: $100 × 50% = $50

NOT: Billiard = $100, Bowling = $100 (double count!)
```

---

## 5. DEPENDENCIES

### Shopify API (Updated per May)

| Field | API Path | Available? |
|-------|----------|-----------|
| `customerJourneySummary.firstVisit.utmParameters` | Order GraphQL | ✅ |
| `customerJourneySummary.firstVisit.landingPage` | Order GraphQL | ✅ |
| `customerJourneySummary.firstVisit.source` | Order GraphQL | ✅ |
| `customerJourneySummary.ready` | Order GraphQL | ✅ (phải check) |
| `lineItems.product.productType` | Order GraphQL | ✅ Thêm vào query |
| `lineItems.product.collections` | Order GraphQL | ✅ Thêm vào query |
| `customer.email` | Order GraphQL | ✅ Đã fetch |

**Scopes cần**: `read_orders`, `read_products` (có thể cần thêm `read_products` nếu chưa có)

### Facebook Ads API
- Campaign-level spend: ✅ Đã có
- Ad-level spend: Selective fetch only cho attributed ad_ids (theo May)

### Infrastructure
| Service | Plan hiện tại | Đủ cho feature? |
|---------|-------------|----------------|
| Supabase | Pro ($25/mo) | ✅ Storage tăng ~2MB + 150KB/tháng |
| Vercel | Pro ($20/mo) | ✅ maxDuration=300s đủ |
| Shopify API | Miễn phí | ✅ Chỉ tăng rate limit usage |
| Facebook API | Miễn phí | ✅ |

**Chi phí tăng thêm: $0/tháng**

---

## 6. THREAT MODEL

### Technical Risks

| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| `customerJourneySummary.ready = false` cho nhiều orders | Medium | High | Phase 0 audit sẽ phát hiện, fallback referringSite |
| Multi-product orders double-count revenue | ~~High~~ Fixed | ~~High~~ | Tách line-item table (May fix) |
| Rate limit khi fetch product collections | Low | Medium | Cache product→collection, batch requests |
| Vercel timeout | Low | Medium | Pagination, maxDuration 300s |
| Spend allocation phức tạp | Medium | Medium | Revenue-share formula đã define |

### Data Quality Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Owner không set UTM đúng | ❌ Feature vô dụng | UTM Guide + validation + Phase 0 audit |
| Products không có collection membership | Collection P&L sai | product_collection_cache + manual mapping |
| Organic orders (không UTM) | Inflate unattributed | Filter rõ ràng, hiện % coverage trên dashboard |

### Cost/Abuse Risks
- Storage: ~2MB ban đầu + 150KB/tháng → negligible
- API: Không tốn tiền, chỉ rate limit
- Không có external service mới

---

## 7. DATABASE SCHEMA (Updated per May)

### Table: order_attributions (order-level)

```sql
CREATE TABLE order_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES business_profiles(id),
  
  -- Shopify order
  shopify_order_id TEXT NOT NULL,
  shopify_order_name TEXT,
  order_date DATE NOT NULL,
  total_revenue DECIMAL(10,2) NOT NULL,
  
  -- Attribution (from customerJourneySummary)
  utm_source TEXT,              -- {{campaign.name}} value
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  attribution_type TEXT DEFAULT 'unattributed',
    -- 'utm_campaign_name', 'utm_first_visit', 'referrer', 'source_facebook', 'unattributed'
  attribution_source TEXT,     -- raw source from customerJourneySummary
  matched_campaign_id TEXT,    -- resolved campaign_id from campaign_snapshots
  matched_campaign_name TEXT,  -- normalized campaign name used for matching
  
  -- Customer
  customer_email_hash TEXT,    -- SHA256 for privacy
  is_returning_customer BOOLEAN DEFAULT false,
  
  -- Debug
  raw_landing_page TEXT,
  raw_referrer_url TEXT,
  journey_ready BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(profile_id, shopify_order_id)
);

CREATE INDEX idx_oa_profile_date ON order_attributions(profile_id, order_date);
CREATE INDEX idx_oa_campaign ON order_attributions(utm_campaign);
CREATE INDEX idx_oa_source ON order_attributions(utm_source);
```

### Table: order_attribution_items (line-item level)

```sql
CREATE TABLE order_attribution_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_attribution_id UUID REFERENCES order_attributions(id) ON DELETE CASCADE,
  
  -- Product
  shopify_product_id TEXT,
  sku TEXT,
  product_title TEXT,
  product_type TEXT,           -- T-Shirt, Hoodie, etc.
  quantity INTEGER NOT NULL DEFAULT 1,
  item_revenue DECIMAL(10,2) NOT NULL,
  
  -- Collection mapping
  collection_key TEXT,         -- billiards, bowling, darts, fishing, other
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_oai_order ON order_attribution_items(order_attribution_id);
CREATE INDEX idx_oai_collection ON order_attribution_items(collection_key);
CREATE INDEX idx_oai_product ON order_attribution_items(shopify_product_id);
```

### Table: product_collection_cache

```sql
CREATE TABLE product_collection_cache (
  shopify_product_id TEXT PRIMARY KEY,
  profile_id UUID REFERENCES business_profiles(id),
  
  canonical_collection TEXT,   -- billiards, bowling, darts, fishing, other
  product_type TEXT,           -- T-Shirt, Hoodie, Hat
  tags TEXT[],
  
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Materialized View: collection_performance_mv

```sql
CREATE MATERIALIZED VIEW collection_performance_mv AS
SELECT
  oai.collection_key,
  oa.order_date,
  oa.utm_campaign,
  
  -- Revenue
  SUM(oai.item_revenue) AS collection_revenue,
  COUNT(DISTINCT oa.shopify_order_id) AS order_count,
  COUNT(oai.id) AS items_sold,
  
  -- Revenue share for spend allocation
  SUM(oai.item_revenue) / NULLIF(
    SUM(SUM(oai.item_revenue)) OVER (PARTITION BY oa.utm_campaign, oa.order_date), 0
  ) AS revenue_share_in_campaign

FROM order_attribution_items oai
JOIN order_attributions oa ON oa.id = oai.order_attribution_id
WHERE oa.attribution_type != 'unattributed'
GROUP BY oai.collection_key, oa.order_date, oa.utm_campaign;

CREATE UNIQUE INDEX idx_cpmv ON collection_performance_mv(collection_key, order_date, utm_campaign);
```

---

## 8. PHÂN PHA TRIỂN KHAI

### Phase 0: Data Quality Audit (0.5 ngày)

| # | Task | Output |
|---|------|--------|
| 0.1 | Script/endpoint audit 7 ngày orders | Report: % attributed, % UTM, % collection mapped |
| 0.2 | Owner confirm UTM convention | Documented UTM standard |
| 0.3 | Owner confirm product taxonomy | Collection mapping verified |
| 0.4 | **Gate**: attribution coverage > 50% | GO/NO-GO decision |

### Phase 1: Product Attribution (2-3 ngày)

| # | Task | File |
|---|------|------|
| 1.1 | Migration: 3 tables + materialized view | `supabase/migrate_product_attribution.sql` |
| 1.2 | Update ORDERS_QUERY: thêm customerJourneySummary + product collections | `src/lib/shopify.ts` |
| 1.3 | UTM parser + attribution logic | `src/lib/attribution.ts` [NEW] |
| 1.4 | Collection mapper + cache | `src/lib/collection-mapper.ts` [NEW] |
| 1.5 | Tích hợp vào Shopify sync | `src/app/api/shopify/sync/route.ts` |
| 1.6 | API: Collection P&L | `src/app/api/shopify/collections/route.ts` [NEW] |
| 1.7 | UI: Collection Performance Dashboard | `src/app/dashboard/` |
| 1.8 | Feature flag: `enable_attribution` | Config |

### Phase 2: Customer LTV (3-5 ngày, sau Phase 1 proven)

| # | Task |
|---|------|
| 2.1 | customer_ltv table + aggregation |
| 2.2 | First-touch campaign attribution |
| 2.3 | LTV/CAC ratio calculation |
| 2.4 | Customer cohort dashboard |
| 2.5 | AI budget allocation suggestions |

---

## 9. VERIFY

### Automated Tests
- [ ] UTM parser: extract campaign_id, ad_id from customerJourneySummary
- [ ] Collection mapper: product → collection_key
- [ ] Spend allocation: no double-count in multi-product orders
- [ ] Attribution status: unattributed orders handled gracefully
- [ ] Build passes: `npm run build`

### Manual Verification
- [ ] Phase 0 audit report generates correctly
- [ ] Test order with UTM → verify attribution record
- [ ] Collection P&L dashboard shows correct revenue/spend split
- [ ] Organic orders marked as `unattributed`

---

## 10. ROLLBACK

```sql
DROP MATERIALIZED VIEW IF EXISTS collection_performance_mv;
DROP TABLE IF EXISTS order_attribution_items;
DROP TABLE IF EXISTS order_attributions;
DROP TABLE IF EXISTS product_collection_cache;
```

Feature flag OFF → sync runs without attribution, no side effects on existing flow.

---

## PHỤ LỤC A: UTM Strategy

### Ads đang chạy (6 campaigns active)

**KHÔNG ĐỤNG.** Dùng UTM hiện tại:
```
utm_source={{campaign.name}}
```

AdPilot sẽ match `utm_source` value với `campaign_snapshots.campaign_name` để resolve campaign_id.

### Ads mới tạo sau này (khuyến nghị)

Khi tạo campaign mới, set UTM đầy đủ hơn để có ad-level attribution:
```
utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.id}}&utm_term={{adset.id}}
```

Parser sẽ tự detect và dùng format nào có sẵn.

### Campaign Name Convention

Để matching chính xác, campaign names trên Facebook Ads nên:
- Không đổi tên campaign sau khi tạo (sẽ break matching với orders cũ)
- Tên campaign PHẢI unique giữa các ad accounts
- Nếu đổi tên: AdPilot cần re-map (manual)

---

> **Status**: SRS v1.2 APPROVED (zero disruption to running ads, Phase 0 audit next)
