# SRS: Product-Level Attribution Engine cho AdPilot

> **Ticket ID**: ADPILOT-PA-001
> **Ngày tạo**: 2026-05-10
> **Tạo bởi**: Antigravity (Windows Agent)
> **Gửi đến**: May (Mac Pro Agent) — thảo luận & đưa ra phiên bản tối ưu
> **Priority**: P1
> **Estimated Effort**: 2-3 ngày (Phase 1), 3-5 ngày (Phase 2)

---

## 1. WHAT — Yêu cầu

### Mô tả ngắn
Xây dựng hệ thống Product-Level Attribution cho AdPilot, kết nối dữ liệu Facebook Ads (campaign/adset/ad) với dữ liệu Shopify Orders (products/collections/customers) để:
- Biết **ad nào bán được product nào**
- Biết **collection nào (billiard/bowling/darts/fishing) đang lãi/lỗ** khi tính cả ad spend
- Biết **customer nào từ paid ads có giá trị cao** (LTV tracking)

### Context
Store frenzidea.com có 5-7k products POD, chạy Facebook Ads. Hiện tại AdPilot chỉ link được:
```
Facebook Ads (spend) + Shopify Orders (total revenue) = ROAS tổng
```
Thiếu hoàn toàn layer giữa: **product-level** và **customer-level** attribution.

---

## 2. WHY — Tại sao cần

### Business Case
- **5-7k products** → không thể chạy ads cho tất cả, phải chọn đúng product
- **POD margin mỏng** (~40-50%) → mỗi $ budget đặt sai = lỗ thật
- **Competitor advantage**: Đối thủ POD chỉ nhìn ROAS tổng. Ai có product-level data sẽ biết đổ budget vào đâu chính xác hơn

### Current Pain Points
1. Owner không biết campaign X bán được product A hay product B
2. Không biết collection nào (billiard vs bowling) có ROI cao hơn
3. Không phân biệt được "traffic rẻ" (mua 1 lần) vs "traffic chất" (mua lại)
4. Ra quyết định budget allocation bằng cảm tính thay vì data

---

## 3. STRUCTURE — Kiến trúc

### Current State (AS-IS)

```
┌──────────────────┐       ┌──────────────────┐
│  Facebook Ads    │       │  Shopify Orders   │
│  campaign_       │       │  daily_financials │
│  snapshots       │       │                   │
│  ─────────────   │       │  ─────────────    │
│  campaign_id     │       │  date             │
│  spend           │       │  shopify_revenue  │
│  impressions     │       │  shopify_orders   │
│  clicks          │       │  shopify_aov      │
│  purchases       │       │                   │
│  roas            │       │                   │
└────────┬─────────┘       └────────┬──────────┘
         │                          │
         └──────────┬───────────────┘
                    │ JOIN on: date only (LOOSE)
                    ▼
              ┌──────────┐
              │ Dashboard │
              │ ROAS tổng │
              └──────────┘
```

**Vấn đề**: Join chỉ bằng date → không biết campaign nào tạo ra order nào.

### Target State (TO-BE)

```
┌──────────────────┐       ┌───────────────────┐       ┌──────────────────┐
│  Facebook Ads    │       │  ORDER_ATTRIBUTION │       │  Shopify Orders  │
│  campaign_       │       │  (NEW TABLE)       │       │  + Line Items    │
│  snapshots       │       │  ─────────────     │       │  ─────────────   │
│  ─────────────   │       │  order_id          │       │  order_id        │
│  campaign_id     │◄──────│  campaign_id       │──────►│  product_title   │
│  adset_id        │       │  adset_id          │       │  product_type    │
│  ad_id           │       │  ad_id             │       │  collection      │
│  spend           │       │  utm_source        │       │  sku             │
│  clicks          │       │  utm_medium        │       │  price           │
│  purchases       │       │  utm_campaign      │       │  quantity        │
│                  │       │  utm_content       │       │  customer_email  │
│                  │       │  customer_email     │       │  customer_ltv    │
│                  │       │  revenue            │       │                  │
│                  │       │  product_ids[]      │       │                  │
└──────────────────┘       └───────────────────┘       └──────────────────┘
         │                          │                           │
         └──────────────────────────┼───────────────────────────┘
                                    ▼
                    ┌────────────────────────────┐
                    │  COLLECTION P&L VIEW (NEW) │
                    │  ─────────────────────     │
                    │  collection_name           │
                    │  total_revenue             │
                    │  attributed_ad_spend       │
                    │  profit                    │
                    │  roas_per_collection       │
                    │  top_products              │
                    │  customer_ltv_avg          │
                    └────────────────────────────┘
```

---

## 4. FLOW — Luồng dữ liệu

### Phase 1: UTM-Based Attribution

```
Step 1: Facebook Ad URLs đã có UTM params
        https://frenzidea.com/products/xxx?utm_source=facebook&utm_campaign={campaign_id}&utm_content={ad_id}

Step 2: Shopify Order → có `landingPage` chứa UTM params (qua GraphQL)
        Hoặc: Shopify Order → `referringSite` field

Step 3: Khi sync orders, parse UTM → extract campaign_id, ad_id

Step 4: Lưu vào order_attribution table với:
        - order_id
        - campaign_id (from UTM)
        - ad_id (from UTM)
        - product_ids[] (from lineItems)
        - collection tags (from product tags/type)
        - customer_email
        - revenue

Step 5: Aggregate → Collection P&L view
```

### Phase 2: Customer LTV Tracking

```
Step 1: Từ order_attribution, group by customer_email
Step 2: Tính: total_orders, total_revenue, first_order_campaign
Step 3: LTV = total_revenue / first_acquisition_cost
Step 4: Attribution: campaign đầu tiên "sở hữu" customer đó
Step 5: Dashboard hiển thị: Campaign A acquired 50 customers, avg LTV $120
```

---

## 5. DEPENDENCIES — Phụ thuộc

### Shopify API Requirements
| Field cần | API | Available? | Scope cần |
|-----------|-----|-----------|-----------|
| `order.landingSite` | GraphQL Admin | ✅ | `read_orders` (đã có) |
| `order.referringSite` | GraphQL Admin | ✅ | `read_orders` (đã có) |
| `order.lineItems` | GraphQL Admin | ✅ Đã fetch (shopify.ts L196-199) | `read_orders` |
| `order.lineItems.product.productType` | GraphQL Admin | ✅ Cần thêm vào query | `read_products` (có thể cần thêm) |
| `order.lineItems.product.collections` | GraphQL Admin | ✅ Cần thêm vào query | `read_products` |
| `order.customer.email` | GraphQL Admin | ✅ Đã fetch (shopify.ts L278-280) | `read_customers` (đã có) |

### Facebook Ads API Requirements
| Field cần | Available? | Notes |
|-----------|-----------|-------|
| Campaign ID | ✅ Đã có trong `campaign_snapshots` | |
| Ad Set ID | ⚠️ Có thể cần thêm vào sync | Hiện sync ở campaign level |
| Ad ID | ⚠️ Cần thêm breakdown | Để match UTM content |
| UTM parameters | ✅ Phải set đúng trong Facebook Ads Manager | Owner phải config |

### Database (Supabase)
| Table | Status | Notes |
|-------|--------|-------|
| `campaign_snapshots` | ✅ Exists | Thêm adset_id, ad_id columns |
| `daily_financials` | ✅ Exists | Thêm product breakdown |
| `order_attribution` | 🆕 NEW | Core table cho feature này |
| `collection_performance` | 🆕 NEW | Aggregated view/materialized |
| `customer_ltv` | 🆕 NEW | Phase 2 |

### External Prerequisites (Owner phải làm)
1. **Facebook Ads UTM setup**: Mỗi ad URL PHẢI có `utm_campaign={campaign_id}&utm_content={ad_id}`
2. **Shopify product tagging**: Products cần có `product_type` hoặc tags rõ ràng (billiard, bowling, darts, fishing)

---

## 6. THREAT MODEL — Rủi ro

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| UTM params bị mất (redirect, browser) | Medium | High | Fallback: match by date + revenue range |
| Shopify `landingSite` không chứa UTM | Medium | High | Test trước, nếu không có dùng `referringSite` |
| Order có nhiều products từ nhiều campaigns | Low | Medium | Attribute theo first-touch (landing page) |
| Rate limit Shopify API khi fetch product details | Low | Medium | Batch requests, cache product→collection mapping |
| Vercel timeout khi sync nhiều orders | Medium | Medium | Pagination, maxDuration 300s đã set |

### Data Quality Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Owner không set UTM đúng | ❌ Feature vô dụng | Validation check + alert trên dashboard |
| Products không có tags/type | Collection P&L sai | Product audit step trước khi bật feature |
| Organic orders (không qua ads) | Inflate organic revenue | Filter: chỉ attribute orders CÓ UTM |

### Cost/Abuse Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Supabase storage tăng | Thấp | order_attribution ~200 bytes/row, 1000 orders/month = ~200KB |
| API calls tăng | Thấp | Chỉ thêm 1-2 fields vào query đã có |

---

## 7. VERIFY — Kế hoạch kiểm tra

### Automated Tests
- [ ] Unit test: UTM parser (extract campaign_id, ad_id from URL)
- [ ] Unit test: Collection mapper (product tags → collection name)
- [ ] Integration test: Full flow (mock Shopify order with UTM → verify attribution record)
- [ ] Build passes: `npm run build`

### Manual Verification
- [ ] Tạo test order qua Shopify với UTM link → verify attribution đúng
- [ ] Verify Collection P&L dashboard hiển thị đúng
- [ ] Verify organic orders (không UTM) KHÔNG bị attribute sai

### Adversarial Tests
- [ ] Order không có UTM → phải ghi `unattributed`
- [ ] Order có UTM nhưng campaign_id không tồn tại trong FB data → graceful handle
- [ ] Customer email null → LTV tracking skip, không crash

---

## 8. ROLLBACK — Kế hoạch khôi phục

### Database
```sql
-- Rollback: xóa tables mới (không ảnh hưởng data cũ)
DROP TABLE IF EXISTS order_attribution;
DROP TABLE IF EXISTS collection_performance;
DROP TABLE IF EXISTS customer_ltv;

-- Rollback: xóa columns thêm vào existing tables
ALTER TABLE campaign_snapshots DROP COLUMN IF EXISTS adset_id;
ALTER TABLE campaign_snapshots DROP COLUMN IF EXISTS ad_id;
```

### Code
- Tất cả code mới nằm trong files mới (không sửa existing logic)
- Ngoại trừ `shopify.ts` ORDERS_QUERY cần thêm fields → rollback = revert query
- Feature flag: có thể disable attribution sync mà không ảnh hưởng core sync

---

## Phân Pha Triển Khai

### Phase 1: Product Attribution (2-3 ngày)

| # | Task | File | Effort |
|---|------|------|--------|
| 1.1 | Tạo Supabase migration: `order_attribution` + `collection_performance` tables | `supabase/migrate_product_attribution.sql` | 0.5 ngày |
| 1.2 | Thêm `landingSite`, `productType`, `collections` vào ORDERS_QUERY | `src/lib/shopify.ts` | 0.5 ngày |
| 1.3 | Viết UTM parser + attribution logic | `src/lib/attribution.ts` [NEW] | 0.5 ngày |
| 1.4 | Tích hợp vào Shopify sync flow | `src/app/api/shopify/sync/route.ts` | 0.5 ngày |
| 1.5 | API endpoint: Collection P&L | `src/app/api/shopify/collections/route.ts` [NEW] | 0.5 ngày |
| 1.6 | UI: Collection Performance Dashboard | `src/app/dashboard/collections/` [NEW] | 0.5 ngày |

### Phase 2: Customer LTV (3-5 ngày)

| # | Task | File | Effort |
|---|------|------|--------|
| 2.1 | Tạo `customer_ltv` table | Migration | 0.5 ngày |
| 2.2 | LTV calculation engine | `src/lib/ltv.ts` [NEW] | 1 ngày |
| 2.3 | First-touch campaign attribution | `src/lib/attribution.ts` (extend) | 0.5 ngày |
| 2.4 | API: Customer cohort analysis | `src/app/api/shopify/customers/ltv/route.ts` [NEW] | 0.5 ngày |
| 2.5 | UI: Customer LTV dashboard | UI component | 1 ngày |
| 2.6 | Budget allocation suggestions (AI) | `src/app/api/engine/allocate/route.ts` [NEW] | 1 ngày |

---

## Database Schema

### Table: order_attribution

```sql
CREATE TABLE order_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES business_profiles(id),
  
  -- Shopify data
  shopify_order_id TEXT NOT NULL,
  shopify_order_name TEXT,             -- #1042
  order_date DATE NOT NULL,
  revenue DECIMAL(10,2) NOT NULL,
  
  -- Attribution data (from UTM)
  utm_source TEXT,                     -- facebook, google, organic
  utm_medium TEXT,                     -- cpc, social, email
  utm_campaign TEXT,                   -- campaign_id
  utm_content TEXT,                    -- ad_id
  utm_term TEXT,                       -- adset_id
  attribution_type TEXT DEFAULT 'utm', -- utm, referrer, unattributed
  
  -- Product data
  product_ids TEXT[],                  -- array of product IDs in this order
  product_titles TEXT[],               -- array of product titles
  product_types TEXT[],                -- T-Shirt, Hoodie, etc.
  collections TEXT[],                  -- billiards, bowling, darts, etc.
  
  -- Customer data
  customer_email TEXT,
  is_returning_customer BOOLEAN DEFAULT false,
  
  -- Metadata
  raw_landing_site TEXT,               -- original URL for debugging
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(profile_id, shopify_order_id)
);

CREATE INDEX idx_oa_profile_date ON order_attribution(profile_id, order_date);
CREATE INDEX idx_oa_campaign ON order_attribution(utm_campaign);
CREATE INDEX idx_oa_collections ON order_attribution USING GIN(collections);
CREATE INDEX idx_oa_customer ON order_attribution(customer_email);
```

### Table: customer_ltv (Phase 2)

```sql
CREATE TABLE customer_ltv (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES business_profiles(id),
  customer_email TEXT NOT NULL,
  
  total_orders INTEGER DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0,
  first_order_date DATE,
  last_order_date DATE,
  
  -- Attribution
  first_touch_campaign TEXT,           -- campaign that acquired this customer
  first_touch_source TEXT,             -- utm_source of first order
  acquisition_cost DECIMAL(10,2),      -- estimated CPA from that campaign
  
  -- Computed
  ltv_to_cac_ratio DECIMAL(5,2),       -- LTV / CAC
  avg_order_value DECIMAL(10,2),
  purchase_frequency DECIMAL(5,2),     -- orders per month
  
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(profile_id, customer_email)
);
```

---

## Câu Hỏi Mở Cho May

> [!IMPORTANT]
> Những điểm dưới đây cần May review và đưa ra phiên bản tối ưu:

### 1. UTM vs Shopify Order Attribution App
Có nên dùng Shopify native "Order attribution" (nếu plan hỗ trợ) thay vì tự parse UTM? Ưu/nhược?

### 2. Facebook CAPI (Conversions API)
Facebook CAPI gửi event mua hàng kèm product data. Có nên tận dụng data từ CAPI thay vì match UTM? Có thể reliable hơn không?

### 3. Ad-level vs Campaign-level sync
Hiện AdPilot sync ở campaign level. Feature này cần ad-level data để match UTM content. Sync ad-level sẽ tăng API calls ~10-50x. Acceptable cho Frenzidea scale không?

### 4. Collection mapping strategy
Store có 5-7k products. Cách nào tốt nhất để map product → collection?
- Option A: Dùng `product_type` field (Shopify native)
- Option B: Dùng product tags (flexible nhưng messy)
- Option C: Dùng collection membership (chính xác nhất nhưng cần thêm API call)

### 5. Phase 1 trước hay cả 2 phase cùng lúc?
Phase 1 (product attribution) có giá trị standalone không? Hay phải có Phase 2 (LTV) mới thực sự useful?

### 6. UI Dashboard priority
Dashboard nào build trước?
- A) Collection P&L (billiard: revenue $X, spend $Y, profit $Z)
- B) Product Top 10 per campaign
- C) Customer LTV cohort

---

> **Action**: May đọc SRS này, review architecture, trả lời 6 câu hỏi mở, và đề xuất phiên bản tối ưu trước khi bắt đầu code.
