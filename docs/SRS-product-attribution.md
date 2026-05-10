# SRS v1.1: Product-Level Attribution Engine cho AdPilot

> **Ticket ID**: ADPILOT-PA-001
> **Version**: 1.1 (updated theo May review TKT-00233)
> **Ngày tạo**: 2026-05-10
> **Ngày cập nhật**: 2026-05-11
> **Tạo bởi**: Antigravity (Windows Agent)
> **Review bởi**: May (Mac Pro Agent)
> **Priority**: P1

---

## Changelog v1.0 → v1.1

- ✅ Sửa data source: `customerJourneySummary` thay vì `order.landingSite` (May P1)
- ✅ Tách `order_attribution` thành 2 tables: order-level + line-item level (May P2)
- ✅ `collection_performance` → materialized view (May P3)
- ✅ Thêm spend allocation logic (revenue share) (May P4)
- ✅ Thêm Phase 0: Data Quality Audit
- ✅ Thêm UTM Setup Guide cho Facebook Ads
- ✅ Thêm cost analysis

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
- % orders có UTM facebook
- % products có collection mapping
- % orders "unattributed" (không UTM, không referrer)
→ Nếu attribution coverage < 30% → STOP, fix UTM trước
→ Nếu > 50% → GO, proceed Phase 1
```

### Phase 1: Product Attribution (sau Phase 0 pass)

```
Step 1: Shopify sync fetches orders + customerJourneySummary
        GraphQL query: customerJourneySummary {
          ready
          firstVisit { landingPage, referrerUrl, source, utmParameters { source, medium, campaign, content, term } }
          lastVisit { ... }
        }

Step 2: Parse UTM from customerJourneySummary (NOT raw URL)
        utm_campaign → campaign_id
        utm_content → ad_id
        utm_term → adset_id

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
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,           -- → campaign_id
  utm_content TEXT,            -- → ad_id
  utm_term TEXT,               -- → adset_id
  attribution_type TEXT DEFAULT 'unattributed',
    -- 'utm_first_visit', 'utm_last_visit', 'referrer', 'unattributed'
  attribution_source TEXT,     -- raw source from customerJourneySummary
  
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

## PHỤ LỤC A: Hướng Dẫn Setup UTM cho Facebook Ads

> **QUAN TRỌNG**: Feature Attribution SẼ KHÔNG HOẠT ĐỘNG nếu Facebook Ads không có UTM parameters đúng.

### Bước 1: Vào Facebook Ads Manager

1. Mở https://business.facebook.com
2. Chọn Ad Account của Frenzidea
3. Vào **Campaigns** → chọn campaign đang chạy

### Bước 2: Edit Ad — URL Parameters

Với MỖI ad đang chạy:

1. Click **Edit** trên ad
2. Scroll xuống phần **Tracking**
3. Tìm ô **URL Parameters**
4. Dán đoạn sau vào:

```
utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}
```

**Giải thích:**
- `{{campaign.id}}` → Facebook tự điền campaign ID
- `{{ad.id}}` → Facebook tự điền ad ID
- `{{adset.id}}` → Facebook tự điền ad set ID
- Đây là dynamic parameters, Facebook tự thay thế khi hiển thị ad

### Bước 3: Áp dụng cho tất cả ads

- **Cách nhanh**: Edit ở **Campaign level** → "URL Parameters" sẽ apply cho tất cả ads trong campaign
- **Cách chắc**: Edit từng ad set hoặc ad

### Bước 4: Verify

Sau khi set xong, click **Preview** trên ad:
1. Copy link preview
2. Kiểm tra URL có dạng: `https://frenzidea.com/products/xxx?utm_source=facebook&utm_campaign=12345&utm_content=67890`
3. Nếu thấy UTM params → ✅ Đúng
4. Nếu không thấy → kiểm tra lại bước 2

### Lưu ý quan trọng:

- UTM parameters **KHÔNG ảnh hưởng** đến performance ads
- Chỉ cần set **1 lần** cho mỗi campaign (dynamic params tự update)
- Ads cũ (đang chạy) cần edit thêm UTM vào
- Ads mới tạo SAU khi set → tự động có UTM nếu set ở campaign level

---

> **Status**: SRS v1.1 APPROVED (pending Owner UTM setup + Phase 0 audit)
