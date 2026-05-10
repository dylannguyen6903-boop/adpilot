# Hướng Dẫn Shopify MCP + SEO + AI Sales cho Frenzidea

> **Dành cho**: Store Manager của frenzidea.com
> **Yêu cầu**: Tài khoản Claude Pro + quyền Admin Shopify
> **Mục tiêu**: Tối ưu SEO, tăng organic traffic, và kích hoạt AI bán hàng cho store

---

## Mục Lục

1. [Cài đặt MCP trên Claude](#phần-1-cài-đặt-mcp-trên-claude)
2. [System Prompt cho Claude Agent](#phần-2-system-prompt-cho-claude-agent)
3. [Quy trình SEO Audit](#phần-3-quy-trình-seo-audit)
4. [AI bán hàng (Storefront MCP)](#phần-4-storefront-mcp--ai-bán-hàng)
5. [Tối ưu chuyển đổi (Conversion)](#phần-5-tối-ưu-chuyển-đổi)
6. [Lịch vận hành hàng tuần](#phần-6-lịch-vận-hành-hàng-tuần)
7. [Câu hỏi thường gặp](#phần-7-faq)

---

## Phần 1: Cài Đặt MCP trên Claude

MCP (Model Context Protocol) cho phép Claude truy cập trực tiếp vào tài liệu và API của Shopify. Khi bật MCP, Claude sẽ viết code và đưa ra gợi ý chính xác hơn vì nó đọc schema thật của Shopify thay vì đoán.

### Bước 1: Mở Claude Desktop App

- Tải Claude Desktop tại: https://claude.ai/download
- Đăng nhập bằng tài khoản Claude Pro
- **Lưu ý**: MCP chỉ hoạt động trên Claude Desktop App, KHÔNG hoạt động trên claude.ai (web)

### Bước 2: Mở Settings

- Nhấn vào biểu tượng **tên bạn** (góc trái dưới)
- Chọn **Settings**
- Chọn tab **Developer**

### Bước 3: Thêm MCP Server

- Nhấn nút **Edit Config**
- Nó sẽ mở file `claude_desktop_config.json`
- **Xóa toàn bộ nội dung cũ** trong file, dán đoạn sau vào:

```json
{
  "mcpServers": {
    "shopify-dev-mcp": {
      "command": "npx",
      "args": ["-y", "@shopify/dev-mcp@latest"]
    }
  }
}
```

- Lưu file (Ctrl+S)
- **Đóng hoàn toàn** Claude Desktop (tắt trong system tray nữa)
- Mở lại Claude Desktop

### Bước 4: Kiểm tra kết nối

- Mở một conversation mới
- Gõ: `Hãy dùng tool learn_shopify_api để cho tôi biết các API Shopify hỗ trợ`
- Nếu Claude trả lời với thông tin chi tiết về Shopify APIs → **thành công**
- Nếu báo lỗi → xem phần [Troubleshooting](#troubleshooting-mcp)

### Bước 5 (Tùy chọn): Thêm Data MCP

Nếu muốn Claude truy cập **dữ liệu thật** của store (orders, products, analytics), thêm connector từ bên thứ ba:

1. Vào https://portermetrics.com hoặc https://adzviser.com
2. Tạo tài khoản, kết nối Shopify store
3. Copy MCP URL được cung cấp
4. Trong Claude Desktop: Settings → Connectors → "+" → Paste URL
5. Authorize kết nối

> **Cảnh báo bảo mật**: Data MCP cho Claude truy cập dữ liệu thật (đơn hàng, khách hàng). Chỉ dùng provider uy tín.

### Troubleshooting MCP

| Vấn đề | Cách xử lý |
|--------|------------|
| Claude không nhận MCP | Đảm bảo đã tắt hoàn toàn và mở lại app (check system tray) |
| Lỗi "npx not found" | Cần cài Node.js trước: https://nodejs.org (chọn LTS, cài mặc định) |
| File config không mở | Tìm thủ công: `%APPDATA%\Claude\claude_desktop_config.json` (Windows) hoặc `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) |

---

## Phần 2: System Prompt cho Claude Agent

**Cách sử dụng**: Copy toàn bộ nội dung trong khung bên dưới, paste vào **tin nhắn đầu tiên** của một conversation mới trên Claude. Từ đó Claude sẽ trở thành Shopify SEO & Sales Consultant chuyên biệt cho Frenzidea.

---

### BẮT ĐẦU SYSTEM PROMPT (COPY TỪ ĐÂY)

```
Bạn là Shopify SEO & Sales Consultant chuyên biệt cho store Frenzidea.

## Thông tin Store
- Domain: frenzidea.com (Shopify)
- Ngành hàng: POD (Print on Demand) apparel
- Tệp khách hàng chính: người chơi billiard, pool, snooker, và các môn cuesports
- Mở rộng: có thể cover thêm các môn thể thao tương tự (bowling, darts, table tennis)
- Thị trường: US (Mỹ) là chính
- Số lượng sản phẩm: ~5,000-7,000 SKU
- Google Search Console: chưa setup

## Vai trò của bạn
1. Hướng dẫn owner từng bước để tối ưu SEO cho store
2. Đề xuất chiến lược content và keyword cho niche billiard/cuesports
3. Tư vấn cách tối ưu conversion rate
4. Giúp owner hiểu và tận dụng Storefront MCP (AI bán hàng)
5. Đưa ra khuyến nghị apps và tools phù hợp

## Quy tắc làm việc
- Luôn giải thích bằng tiếng Việt, đơn giản, dễ hiểu
- Khi hướng dẫn thao tác trên Shopify Admin, mô tả chi tiết từng bước click
- Không giả định owner biết code, luôn cung cấp hướng dẫn UI-based
- Khi suggest thay đổi, luôn giải thích TẠI SAO (lý do SEO/conversion)
- Ưu tiên những thay đổi có impact cao nhất trước (80/20)
- Với 5-7k products, luôn suggest giải pháp batch/template thay vì sửa từng cái

## Workflow ưu tiên
Khi owner bắt đầu phiên làm việc, hỏi owner muốn làm gì hôm nay:
1. SEO Audit (kiểm tra và sửa SEO)
2. Content (viết blog, mô tả sản phẩm)
3. Conversion (tối ưu tỷ lệ mua hàng)
4. Analytics (phân tích dữ liệu)
5. Storefront MCP (cấu hình AI bán hàng)

## Keyword Framework cho Frenzidea
Các nhóm keyword chính cần target:

### Nhóm 1: Product Keywords (High Intent)
- billiard shirts, pool player t-shirts, snooker apparel
- funny billiard t-shirt, pool player gift
- custom billiard jersey, personalized pool shirt

### Nhóm 2: Niche Keywords (Medium Intent)
- billiard clothing, cuesports fashion
- pool league shirts, billiard team jerseys
- APA league shirts, BCA pool apparel

### Nhóm 3: Long-tail Keywords (Low Competition)
- funny pool player quotes shirt
- retired billiard player gift
- billiard dad shirt, pool mom t-shirt
- 8-ball pool lover clothing

### Nhóm 4: Seasonal / Event
- Father's Day billiard gift
- Christmas pool player present
- billiard tournament team shirt

## SEO Template cho Products (5-7k SKU)
Vì store có quá nhiều sản phẩm, dùng template-based approach:

### Meta Title Template:
{Product Name} - {Niche} | Frenzidea
Ví dụ: "Funny 8-Ball Quote Tee - Billiard Apparel | Frenzidea"

### Meta Description Template:
Shop {product name} for {target audience}. {Key feature/benefit}. Free shipping on orders over $X. Premium quality, designed for {niche} lovers.
Ví dụ: "Shop our Funny 8-Ball Quote Tee designed for pool players. Soft cotton blend, vibrant print that lasts. Free shipping over $49. Perfect gift for billiard enthusiasts."

### URL Handle Best Practice:
- Ngắn gọn, có keyword chính
- Dùng dấu gạch ngang, không dấu gạch dưới
- Ví dụ: funny-8ball-billiard-tee (tốt) vs product-12345 (xấu)

## Khi owner paste prompt này, hãy:
1. Chào owner và giới thiệu ngắn gọn vai trò
2. Hỏi owner muốn bắt đầu từ đâu hôm nay
3. Nếu là lần đầu, khuyến nghị bắt đầu từ: Setup Google Search Console → Collection SEO → Top 20 products SEO
```

### KẾT THÚC SYSTEM PROMPT (COPY ĐẾN ĐÂY)

---

## Phần 3: Quy Trình SEO Audit

Dưới đây là checklist SEO theo thứ tự ưu tiên. Paste prompt ở Phần 2 trước, rồi làm việc với Claude Agent theo từng mục.

### 3.0 Setup Google Search Console (Làm đầu tiên)

Đây là bước BẮT BUỘC để theo dõi SEO. Không có Search Console = không biết ai tìm thấy store.

**Hỏi Claude Agent:**
> "Hướng dẫn tôi từng bước setup Google Search Console cho frenzidea.com. Tôi chưa từng làm."

Claude sẽ hướng dẫn:
1. Vào https://search.google.com/search-console
2. Đăng nhập Google Account
3. Thêm property `frenzidea.com`
4. Verify bằng DNS (Claude sẽ hướng dẫn chi tiết cách thêm TXT record vào domain)
5. Submit sitemap: `https://frenzidea.com/sitemap.xml`

### 3.1 Collection SEO (Impact cao nhất)

Với 5-7k products, tối ưu **Collections** mang lại ROI cao hơn nhiều so với sửa từng product.

**Hỏi Claude Agent:**
> "Hãy đề xuất cấu trúc Collections tối ưu SEO cho store billiard apparel. Hiện tại tôi có [mô tả collections hiện tại]."

**Gợi ý cấu trúc Collections:**
```
Tất cả sản phẩm
├── Billiard & Pool
│   ├── Billiard T-Shirts
│   ├── Pool Player Hoodies
│   ├── Billiard Tank Tops
│   └── Billiard Accessories
├── Snooker
│   ├── Snooker T-Shirts
│   └── Snooker Hoodies
├── Theo Chủ Đề
│   ├── Funny Billiard Quotes
│   ├── Vintage Pool Designs
│   └── Billiard Dad/Mom
├── Quà Tặng
│   ├── Gifts for Pool Players
│   ├── Father's Day Billiard
│   └── Christmas Billiard Gifts
└── Theo Giải Đấu
    ├── APA League Apparel
    └── BCA Pool Shirts
```

**Mỗi Collection cần có:**
- [ ] Meta title (50-60 ký tự, có keyword)
- [ ] Meta description (120-155 ký tự, có CTA)
- [ ] Collection description (250+ từ, keyword-rich, có H2/H3)
- [ ] Collection image với alt text

### 3.2 Product SEO (Batch Approach)

Không sửa từng sản phẩm. Thay vào đó:

**Hỏi Claude Agent:**
> "Tôi có 5000+ products. Hướng dẫn tôi cách dùng Shopify bulk editor để cập nhật SEO title và description theo template cho nhiều sản phẩm cùng lúc."

**Ưu tiên sửa trước:**
1. Top 20 products bán chạy nhất
2. Products có traffic từ Google (xem trong Search Console sau 2-4 tuần)
3. Products có meta description trống

### 3.3 Image SEO

Với store POD, hình ảnh RẤT quan trọng (Google Images = nguồn traffic lớn).

**Hỏi Claude Agent:**
> "Hướng dẫn tôi cách tối ưu alt text cho product images hàng loạt. Store tôi có ~5000 sản phẩm billiard apparel."

**Template alt text:**
```
{Product Name} - {Product Type} for {Target Audience}
Ví dụ: "Funny 8-Ball Quote T-Shirt - Billiard Apparel for Pool Players"
```

### 3.4 Blog / Content Strategy

Blog là cách #1 để kéo organic traffic cho POD store.

**Hỏi Claude Agent:**
> "Lên kế hoạch content blog 1 tháng cho store billiard apparel, target thị trường US. Mỗi bài viết cần có keyword target, outline, và estimated search volume."

**Gợi ý topics:**
| Tuần | Topic | Target Keyword |
|------|-------|---------------|
| 1 | "Best Gifts for Pool Players in 2026" | gifts for pool players |
| 2 | "What to Wear to a Billiard Tournament" | billiard tournament outfit |
| 3 | "APA Pool League: Everything You Need to Know" | APA pool league |
| 4 | "Funny Pool Quotes Every Billiard Player Will Love" | funny pool quotes |

**Khi viết blog, hỏi Claude:**
> "Viết cho tôi bài blog SEO-optimized về [topic]. Target keyword: [keyword]. Bài viết 1500 từ, tiếng Anh, tone casual và engaging cho pool players US."

### 3.5 Technical SEO Checklist

**Hỏi Claude Agent lần lượt:**

- [ ] `"Kiểm tra sitemap của frenzidea.com có hoạt động không. Hướng dẫn tôi submit lên Google Search Console."`
- [ ] `"Hướng dẫn tôi cách kiểm tra page speed của frenzidea.com và cách cải thiện."`
- [ ] `"Hướng dẫn tôi kiểm tra structured data (product schema) trên store Shopify."`
- [ ] `"Store tôi có cần file robots.txt tùy chỉnh không? Shopify tự tạo hay tôi cần sửa?"`

---

## Phần 4: Storefront MCP - AI Bán Hàng

### 4.1 Storefront MCP là gì?

Shopify đã tự động bật MCP endpoint trên MỌI store. Endpoint này cho phép các AI agent (ChatGPT, Claude, Gemini, và các AI khác) tìm kiếm sản phẩm, tạo giỏ hàng, và mua hàng trên store của bạn.

**Endpoint của Frenzidea:**
```
https://frenzidea.com/api/mcp
```

Điều này có nghĩa: khi ai đó hỏi ChatGPT "Tìm cho tôi áo billiard dưới $30", ChatGPT CÓ THỂ tìm trực tiếp trên store của bạn.

### 4.2 Kiểm tra Storefront MCP

**Hỏi Claude Agent:**
> "Giúp tôi kiểm tra xem Storefront MCP endpoint tại frenzidea.com/api/mcp có hoạt động không. Hướng dẫn tôi cách test."

### 4.3 Bật Agentic Commerce (nếu có)

1. Vào Shopify Admin → **Settings** → **Apps and sales channels**
2. Tìm mục **Agentic commerce** (nếu có)
3. Bật endpoint cho Storefront, Customer Account, Checkout

> **Lưu ý**: Tính năng này có thể chưa available cho tất cả plan. Nếu không thấy, hỏi Claude Agent cách kiểm tra.

### 4.4 Tối ưu Store cho AI Discovery

Khi AI agents tìm sản phẩm, chúng dựa vào product data. Data càng tốt = sản phẩm được AI recommend càng nhiều.

**Checklist tối ưu cho AI:**

- [ ] **Product titles** rõ ràng, mô tả đúng sản phẩm (tránh title quá sáng tạo mà AI không hiểu)
  - Tốt: "Funny 8-Ball Pool Player T-Shirt - Black Cotton Tee"
  - Xấu: "The Hustler Vibes #8BallLife"
- [ ] **Product descriptions** có đầy đủ: chất liệu, kích thước, dịp sử dụng
- [ ] **Tags** phong phú: billiard, pool, 8-ball, gift, funny, t-shirt, mens, womens
- [ ] **Product type** chính xác: T-Shirt, Hoodie, Tank Top (không để trống)
- [ ] **Vendor**: Frenzidea (nhất quán)

**Hỏi Claude Agent:**
> "Review 5 sản phẩm bán chạy nhất của tôi và cho tôi biết product data đã tối ưu cho AI agents chưa. Đây là link store: frenzidea.com"

---

## Phần 5: Tối Ưu Chuyển Đổi

### 5.1 Product Page Checklist

**Hỏi Claude Agent:**
> "Hãy review product page của frenzidea.com và cho tôi biết cần cải thiện gì để tăng conversion rate. Focus vào: trust signals, CTA, urgency, social proof."

**Checklist cần có trên mỗi product page:**
- [ ] Ảnh sản phẩm chất lượng cao (nhiều góc)
- [ ] Size chart rõ ràng
- [ ] Reviews/ratings
- [ ] Trust badges (Secure Checkout, Free Shipping threshold)
- [ ] Shipping info rõ ràng (thời gian giao, miễn phí từ bao nhiêu)
- [ ] Return policy link
- [ ] "Frequently Bought Together" hoặc related products

### 5.2 Apps Khuyến Nghị

Thảo luận với Claude Agent về từng app trước khi cài:

| App | Chức năng | Giá | Khi nào cần |
|-----|-----------|-----|-------------|
| **Judge.me** | Product reviews | Free plan | Ngay bây giờ |
| **Vitals** | 40+ tools (countdown, trust badges, upsell) | $29.99/mo | Khi muốn all-in-one |
| **ReConvert** | Post-purchase upsell | $7.99/mo | Khi có traffic ổn định |
| **Rebuy** | AI product recommendations | $99/mo | Khi revenue > $5k/mo |
| **Zipchat** | AI chat hỗ trợ khách | $49/mo | Khi có 100+ orders/mo |

**Hỏi Claude Agent trước khi cài bất kỳ app nào:**
> "Tôi đang cân nhắc cài app [tên app] cho store POD billiard apparel. Revenue hiện tại khoảng [số]/tháng. App này có xứng đáng không? Ưu nhược điểm?"

### 5.3 Checkout & Cart Optimization

**Hỏi Claude Agent:**
> "Hướng dẫn tôi setup free shipping threshold tối ưu cho store POD. AOV hiện tại khoảng $[X]. Tôi nên đặt free shipping ở mức nào?"

**Gợi ý:**
- Nếu AOV = $25-30 → Free shipping từ $49 (khuyến khích mua thêm 1 item)
- Nếu AOV = $35-45 → Free shipping từ $59

### 5.4 Email Marketing

**Hỏi Claude Agent:**
> "Hướng dẫn tôi setup email automation cơ bản cho Shopify. Tôi muốn: welcome email, abandoned cart, post-purchase follow-up."

---

## Phần 6: Lịch Vận Hành Hàng Tuần

Sau khi setup xong (Phần 1-5), duy trì theo lịch này:

### Tuần 1-4 (Tháng đầu): Foundation

| Tuần | Việc cần làm | Hỏi Claude Agent |
|------|-------------|------------------|
| 1 | Setup Google Search Console + Submit sitemap | "Hướng dẫn setup GSC cho frenzidea.com" |
| 1 | Tạo/sửa 5-10 Collections chính | "Đề xuất cấu trúc Collections cho billiard store" |
| 2 | Viết descriptions cho top Collections | "Viết collection description SEO cho [collection name]" |
| 2 | Audit + sửa SEO cho top 20 products | "Review SEO cho [product URL]" |
| 3 | Setup blog, viết 2 bài đầu tiên | "Viết blog post về [topic]" |
| 3 | Kiểm tra Storefront MCP | "Kiểm tra AI shopping endpoint" |
| 4 | Review kết quả Search Console | "Phân tích dữ liệu GSC tuần đầu" |
| 4 | Cài Judge.me (reviews) | "Hướng dẫn setup Judge.me" |

### Tháng 2+: Ongoing Weekly

| Ngày | Việc | Thời gian | Claude? |
|------|------|-----------|---------|
| **Thứ 2** | Kiểm tra Search Console: impressions, clicks, positions | 15 phút | Phân tích data |
| **Thứ 3** | Viết/đăng 1 blog post | 45 phút | Claude viết draft |
| **Thứ 4** | Audit SEO cho 10 products (batch) | 30 phút | Claude suggest fixes |
| **Thứ 5** | Kiểm tra conversion metrics trong Shopify Analytics | 15 phút | Phân tích + suggest |
| **Thứ 6** | Review apps performance, test new ideas | 20 phút | Thảo luận strategy |

### KPI theo dõi hàng tháng

| Metric | Tool | Mục tiêu tháng 1 | Mục tiêu tháng 3 |
|--------|------|-------------------|-------------------|
| Organic impressions | Google Search Console | Baseline | +50% |
| Organic clicks | Google Search Console | Baseline | +100% |
| Avg. position | Google Search Console | Ghi nhận | Top 30 cho target keywords |
| Organic traffic | Shopify Analytics | Baseline | +30% |
| Conversion rate | Shopify Analytics | Ghi nhận | Cải thiện 0.5% |

---

## Phần 7: FAQ

### Q: Tôi phải cài Node.js à? Tôi không biết code.
Node.js chỉ cần để chạy MCP. Bạn chỉ cần tải và cài đặt bình thường (bấm Next, Next, Next), không cần viết code gì cả.

### Q: MCP có truy cập được dữ liệu khách hàng của tôi không?
**Dev MCP** (`@shopify/dev-mcp`): KHÔNG. Nó chỉ đọc tài liệu và schema công khai của Shopify.
**Data MCP** (Porter Metrics...): CÓ, nếu bạn cấp quyền. Chỉ dùng khi thực sự cần.

### Q: Storefront MCP có để lộ thông tin nhạy cảm không?
KHÔNG. Storefront MCP chỉ expose thông tin công khai (sản phẩm, giá, policies) giống như khách vào website thấy. Không có thông tin đơn hàng hay khách hàng.

### Q: Tôi có 5-7k sản phẩm, làm SEO hết thì bao lâu?
Không cần làm hết. Chiến lược:
1. **Tuần 1-2**: Làm Collections (10-15 collections, impact cao nhất)
2. **Tuần 3-4**: Top 20 products bán chạy
3. **Ongoing**: Mỗi tuần audit thêm 10 products
4. **Blog**: 1 bài/tuần, tích lũy dần

### Q: Tôi nên dùng Claude Cowork hay Claude Code?
**Claude Cowork** (Desktop App với MCP). Bạn không cần Code vì không viết code. Cowork cho phép bạn chat và nhận hướng dẫn từng bước.

### Q: Tôi đã paste System Prompt nhưng Claude không nhớ context?
Mỗi conversation mới cần paste lại System Prompt. Hoặc bạn có thể tạo một **Project** trong Claude và đặt System Prompt vào phần Project Instructions để không cần paste lại mỗi lần.

### Q: Khi nào nên cài app trả phí?
Khi store đã có traffic ổn định (100+ sessions/ngày) và conversion rate cần cải thiện. Đừng cài app trước khi có traffic, vì lúc đó chưa có data để app tối ưu.

---

## Tài Liệu Tham Khảo

- Shopify SEO Guide: https://shopify.dev/docs/apps/build/marketing-analytics/optimize-storefront-seo
- Shopify Dev MCP: https://shopify.dev/docs/apps/build/ai-toolkit
- Google Search Console: https://search.google.com/search-console
- PageSpeed Insights: https://pagespeed.web.dev/

---

> **Cập nhật lần cuối**: 2026-05-10
> **Tạo bởi**: AdPilot Engineering Team
