# Báo Cáo Audit Website frenzidea.com
> **Ngày**: 10/05/2026
> **Auditor**: AdPilot Engineering
> **Phạm vi**: SEO, Performance, Navigation, AI Commerce

---

## Tổng Quan

| Hạng mục | Điểm | Đánh giá |
|----------|------|----------|
| **SEO Collections** | 8/10 | 4 collections chính đã tối ưu tốt |
| **SEO Homepage** | 3/10 | Meta title và description rất yếu |
| **Navigation** | 5/10 | 2 broken links trong menu chính |
| **Performance Mobile** | 4/10 | PageSpeed 47/100, LCP 7.3s |
| **Performance Desktop** | 6/10 | GTmetrix D (61%), LCP 1.0s |
| **Accessibility** | 9/10 | 93/100 (tốt) |
| **AI Commerce** | 5/10 | Agentic Discovery sitemap có, nhưng MCP endpoint chưa hoạt động |

---

## 🔴 Vấn Đề Nghiêm Trọng (Sửa Ngay)

### 1. Homepage SEO thiếu hoàn toàn

**Hiện tại:**
- Title: `Frenzidea - Your Game, Your Style`
- Meta description: `Frenzidea`

**Vấn đề:** Homepage là trang quan trọng nhất cho SEO. Meta description chỉ có 1 từ "Frenzidea" = lãng phí hoàn toàn. Google sẽ tự lấy nội dung ngẫu nhiên từ trang để hiển thị, gây mất kiểm soát snippet.

**Cách sửa:**
1. Shopify Admin → **Online Store** → **Preferences**
2. Sửa **Homepage title** thành:
```
Frenzidea | Custom Billiard, Bowling & Sports Shirts — Free Personalization
```
3. Sửa **Homepage meta description** thành:
```
Shop custom billiard shirts, bowling jerseys & sports apparel at Frenzidea. Free personalization with your name, team logo & number. Premium 3D all-over print. Free shipping on orders $49+.
```

**Lưu ý:**
- Title nên dưới 60 ký tự
- Meta description nên 120-155 ký tự
- Phải có keyword chính (billiard shirts, bowling shirts) + USP (free personalization)

---

### 2. Broken Links trong Menu Navigation

Hai collections đang hiển thị trong menu nhưng trả về lỗi **404 Not Found**:

| Link | Status | Vị trí trong menu |
|------|--------|-------------------|
| `frenzidea.com/collections/pickleball-shirt-1` | ❌ 404 | Menu chính → Pickleball Shirt |
| `frenzidea.com/collections/golf-shirts` | ❌ 404 | Menu chính → Golf Shirts |

**Tác hại:**
- Khách click vào thấy lỗi → mất tin tưởng, tăng bounce rate
- Google crawl thấy 404 → ảnh hưởng tiêu cực đến SEO
- Broken links = tín hiệu chất lượng thấp

**Cách sửa (chọn 1 trong 2):**

**Phương án A: Tạo lại collections**
1. Shopify Admin → **Products** → **Collections**
2. Tạo collection mới cho Pickleball và Golf
3. Đảm bảo URL handle khớp với link trong menu

**Phương án B: Xóa khỏi menu**
1. Shopify Admin → **Online Store** → **Navigation**
2. Chọn menu chính
3. Xóa 2 menu items: "Pickleball Shirt" và "Golf Shirts"
4. Save

---

## 🟡 Vấn Đề Trung Bình (Sửa Trong Tuần)

### 3. Performance Mobile rất chậm

**Kết quả PageSpeed Insights (Mobile):**

| Metric | Giá trị | Chuẩn tốt | Trạng thái |
|--------|---------|-----------|------------|
| Performance Score | **47**/100 | >50 | 🔴 |
| First Contentful Paint | **2.5s** | <1.8s | 🟡 |
| Largest Contentful Paint | **7.3s** | <2.5s | 🔴 |
| Total Blocking Time | **1,030ms** | <200ms | 🔴 |
| Cumulative Layout Shift | **0** | <0.1 | 🟢 |
| Speed Index | **4.8s** | <3.4s | 🟡 |

**Kết quả GTmetrix (Desktop, test từ Seattle):**

| Metric | Giá trị | Trạng thái |
|--------|---------|------------|
| GTmetrix Grade | **D** | 🔴 |
| Performance | **61%** | 🟡 |
| Structure | **79%** | 🟡 |
| LCP | **1.0s** | 🟢 |
| TBT | **883ms** | 🔴 |
| CLS | **0** | 🟢 |

**Nguyên nhân chính:**

**a) Ảnh sản phẩm quá nặng (gây LCP 7.3s trên mobile)**
- Homepage load nhiều ảnh 3D mockup resolution cao cùng lúc
- Ảnh chưa được lazy load (load tất cả ảnh ngay khi mở trang)

**b) Quá nhiều JavaScript blocking render (gây TBT 1,030ms)**
- Mỗi Shopify app thêm JS file riêng
- Tracking scripts (Ahrefs, Custom Events, analytics)
- Theme JavaScript chưa được tối ưu

**Cách cải thiện:**

1. **Audit Shopify Apps** — Gỡ mọi app không dùng
   - Shopify Admin → Settings → Apps
   - Mỗi app bị gỡ = giảm ~100-200ms TBT
   - Hỏi Claude: `"Liệt kê tất cả apps đang cài trên store và đánh giá cái nào cần thiết, cái nào nên gỡ"`

2. **Giảm ảnh trên homepage**
   - Không cần hiển thị quá nhiều sản phẩm trên homepage
   - Hỏi Claude: `"Hướng dẫn tôi giảm số lượng products hiển thị trên homepage từ [X] xuống 8-12 để tăng tốc"`

3. **Bật lazy loading ảnh**
   - Kiểm tra theme có hỗ trợ lazy loading không
   - Hỏi Claude: `"Kiểm tra xem theme hiện tại có bật lazy loading cho product images không. Nếu chưa, hướng dẫn tôi bật"`

4. **Nén ảnh**
   - Shopify tự chuyển sang WebP nếu theme hỗ trợ
   - Hỏi Claude: `"Hướng dẫn tôi kiểm tra ảnh products có đang serve dưới dạng WebP không"`

**Lưu ý quan trọng:** Score 47 mobile là phổ biến cho Shopify stores (trung bình ngành 35-55). Đây không phải emergency nhưng nên cải thiện dần. Google dùng Mobile-First Indexing, nên mobile score quan trọng hơn desktop.

---

### 4. Storefront MCP chưa hoạt động

**Kiểm tra:** `https://frenzidea.com/api/mcp` → trả về 404

**Ý nghĩa:** AI shopping agents (ChatGPT, Claude, Gemini) chưa thể trực tiếp tìm và mua sản phẩm trên store.

**Tín hiệu tích cực:** Sitemap đã có `sitemap_agentic_discovery.xml` → Shopify đã bắt đầu bật tính năng AI discovery.

**Cách kiểm tra và bật:**
1. Shopify Admin → **Settings** → **Apps and sales channels**
2. Tìm mục **Agentic commerce** hoặc **Storefront MCP**
3. Nếu có → bật tất cả endpoints
4. Nếu không thấy → tính năng chưa available cho plan hiện tại, chờ Shopify rollout

**Hỏi Claude:** `"Hướng dẫn tôi kiểm tra và bật Storefront MCP endpoint cho store. Khi tôi truy cập frenzidea.com/api/mcp thì bị 404."`

---

## 🟢 Đã Làm Tốt (Giữ Nguyên)

### 5. Collections SEO — Tốt

4 collections chính đã có meta title + description chuẩn SEO:

| Collection | Meta Title | Meta Description |
|-----------|-----------|-----------------|
| **Billiards** | Billiard Shirts for Pool Players \| Frenzidea | ✅ Shop billiard shirts & pool player tees... Free shipping $49+ |
| **Bowling** | Bowling Shirts for League Players & Teams \| Frenzidea | ✅ Shop bowling shirts & team apparel... Free shipping $49+ |
| **Darts** | Darts Shirts for Players, Leagues & Teams \| Frenzidea | ✅ Shop darts shirts & dart player apparel... Free shipping $49+ |
| **Fishing** | Fishing Shirts for Anglers & Fishing Lovers \| Frenzidea | ✅ Shop fishing shirts & angler apparel... Free shipping $49+ |

**Nhận xét:** Format nhất quán, có keyword target, có CTA (Free shipping), độ dài phù hợp. Đúng template khuyến nghị.

### 6. Google Search Console + Ahrefs — Đã setup

- GSC đã verify + sitemap submitted
- Ahrefs Webmaster Tools đã kết nối
- Data bắt đầu thu thập sau 24-48h

### 7. CLS = 0 — Tuyệt vời

Layout không bị giật khi load. Đây là metric khó đạt 0 và rất quan trọng cho UX.

### 8. Accessibility 93/100 — Tốt

Gần như không cần can thiệp.

---

## Checklist Hành Động (Theo Thứ Tự Ưu Tiên)

| # | Việc cần làm | Độ khó | Impact | Thời gian |
|---|-------------|--------|--------|-----------|
| 1 | Sửa Homepage meta title + description | ⭐ Dễ | 🔴 Cao | 5 phút |
| 2 | Fix/xóa 2 broken links (Pickleball, Golf) | ⭐ Dễ | 🔴 Cao | 10 phút |
| 3 | Audit và gỡ apps không cần thiết | ⭐⭐ Trung bình | 🟡 Trung bình | 30 phút |
| 4 | Giảm số products trên homepage | ⭐⭐ Trung bình | 🟡 Trung bình | 15 phút |
| 5 | Bật lazy loading cho ảnh | ⭐⭐ Trung bình | 🟡 Trung bình | 20 phút |
| 6 | Kiểm tra/bật Storefront MCP | ⭐ Dễ | 🟡 Trung bình | 10 phút |
| 7 | Nén ảnh products | ⭐⭐⭐ Khó | 🟡 Trung bình | Ongoing |

**Mục tiêu sau khi fix #1-#5:**
- Homepage SEO: meta title + description đầy đủ keyword
- Navigation: 0 broken links
- PageSpeed Mobile: 55-65 (từ 47)
- GTmetrix: C+ (từ D)

---

## Bước Tiếp Theo Sau Audit

Sau khi fix hết các vấn đề trên, nên chuyển sang:
1. **SEO cho sub-collections** (Billiards 8ball, 9ball, Eagle, Flag... mỗi cái cần meta title/desc riêng)
2. **Blog content** (1 bài/tuần, target long-tail keywords)
3. **Product SEO** cho top 20 sản phẩm bán chạy
4. **Cài Judge.me** (app review miễn phí) để có social proof

Dùng Claude Agent trong project "Frenzidea Shopify" để thực hiện từng bước. Paste câu hỏi gợi ý trong mỗi phần ở trên.

---

> **Ghi chú**: Báo cáo này được tạo tự động bằng công cụ audit. Mọi chỉ số performance có thể dao động ±5 điểm tùy thời điểm test. Khuyến nghị re-test sau khi fix để so sánh.
