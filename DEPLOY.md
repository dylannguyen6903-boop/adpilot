# AdPilot — Hướng Dẫn Deploy Chi Tiết

> Hướng dẫn này dành cho người nhận source code AdPilot.
> Không cần kinh nghiệm DevOps — chỉ cần làm theo từng bước.

---

## 📋 Chuẩn bị trước

Bạn cần:
- [ ] Tài khoản **GitHub** (đăng ký tại [github.com](https://github.com))
- [ ] Tài khoản **Vercel** (đăng ký tại [vercel.com](https://vercel.com) — liên kết với GitHub)
- [ ] Folder source code `adpilot/` (đã nhận từ developer)
- [ ] File `.env.local` (chứa API keys — nhận riêng, KHÔNG có trong source code)

---

## Bước 1: Đưa code lên GitHub

### 1.1 — Tạo Repository mới trên GitHub

1. Đăng nhập GitHub → vào [github.com/new](https://github.com/new)
2. Điền thông tin:
   - **Repository name**: `adpilot`
   - **Description**: `AdPilot — AI-Powered Ad Budget Optimizer`
   - **Visibility**: chọn **Private** (bảo mật)
   - ⚠️ **KHÔNG tick** bất kỳ checkbox nào (No README, No .gitignore, No license)
3. Bấm **"Create repository"**
4. GitHub sẽ hiện trang hướng dẫn — **giữ trang này mở** (cần link ở bước sau)

### 1.2 — Cài Git (nếu chưa có)

- **Windows**: Tải [git-scm.com/download/win](https://git-scm.com/download/win) → cài mặc định
- **Mac**: Mở Terminal gõ `git --version` (sẽ tự cài)
- Kiểm tra: mở Terminal/PowerShell gõ `git --version` → phải hiện version

### 1.3 — Push code lên GitHub

Mở **Terminal** (hoặc **PowerShell** trên Windows), chạy từng lệnh:

```bash
# 1. Di chuyển vào thư mục adpilot
cd đường/dẫn/tới/adpilot

# 2. Khởi tạo Git repo mới
git init

# 3. Thêm tất cả file vào Git
git add .

# 4. Tạo commit đầu tiên
git commit -m "Initial commit: AdPilot v2.0"

# 5. Kết nối với GitHub repo vừa tạo
#    ⚠️ THAY <USERNAME> bằng tên GitHub của bạn
git remote add origin https://github.com/<USERNAME>/adpilot.git

# 6. Đổi tên branch thành main
git branch -M main

# 7. Push code lên GitHub
git push -u origin main
```

> **Lưu ý**: Lần đầu push, Git sẽ hỏi đăng nhập GitHub.
> Nếu dùng 2FA, cần tạo **Personal Access Token** tại:
> GitHub → Settings → Developer settings → Personal access tokens → Generate new token
> Dùng token thay cho password khi Git hỏi.

### 1.4 — Kiểm tra

Vào `https://github.com/<USERNAME>/adpilot` — phải thấy toàn bộ files:
- `src/` folder
- `package.json`
- `next.config.ts`
- `.gitignore`

✅ **Bước 1 hoàn tất** khi thấy code trên GitHub.

---

## Bước 2: Deploy lên Vercel

### 2.1 — Import project

1. Đăng nhập [vercel.com](https://vercel.com)
2. Bấm nút **"Add New..."** → **"Project"**
3. Tìm repo `adpilot` trong danh sách GitHub repos
   - Nếu không thấy: bấm **"Adjust GitHub App Permissions"** → cho phép Vercel truy cập repo `adpilot`
4. Bấm **"Import"** bên cạnh repo `adpilot`

### 2.2 — Cấu hình project

Sau khi import, Vercel hiện màn hình cấu hình:

1. **Framework Preset**: tự động chọn **Next.js** ✅ (không cần đổi)
2. **Root Directory**: để trống (mặc định `./`) ✅
3. **Build Command**: tự động `next build` ✅
4. **Output Directory**: tự động ✅

### 2.3 — Thêm Environment Variables (QUAN TRỌNG)

Kéo xuống phần **"Environment Variables"**, thêm từng biến:

| Name | Value | Ghi chú |
|------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vtgsziordglvxbxudsfr.supabase.co` | Copy chính xác |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(lấy từ file .env.local)* | Bắt đầu bằng `eyJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | *(lấy từ file .env.local)* | Bắt đầu bằng `eyJ...` |
| `SHOPIFY_STORE_DOMAIN` | `tkww3m-6u.myshopify.com` | Domain Shopify |
| `SHOPIFY_ACCESS_TOKEN` | *(lấy từ file .env.local)* | Bắt đầu bằng `shpat_` |

**Cách thêm mỗi biến:**
1. Gõ tên biến vào ô **"Name"**
2. Paste giá trị vào ô **"Value"**
3. Để checkbox **Production, Preview, Development** đều tick ✅
4. Bấm **"Add"**
5. Lặp lại cho biến tiếp theo

> ⚠️ **QUAN TRỌNG**: Không thêm sẽ khiến app lỗi 500. Phải thêm đủ 5 biến.

### 2.4 — Deploy

1. Bấm nút **"Deploy"** (nút xanh to)
2. Đợi **~2-3 phút** — Vercel sẽ build và deploy
3. Khi hoàn tất, bạn sẽ thấy **"Congratulations!"** + preview screenshot
4. Bấm **"Continue to Dashboard"**

### 2.5 — Lấy URL production

1. Trong Vercel Dashboard, bạn sẽ thấy URL dạng:
   ```
   https://adpilot-xxxx.vercel.app
   ```
2. Bấm **"Visit"** để mở app
3. **Bookmark URL này** — đây là địa chỉ truy cập app

---

## Bước 3: Kiểm tra sau deploy

### 3.1 — Dashboard
- Vào `https://your-url.vercel.app/dashboard`
- Nếu không có data: bấm **"🔄 Refresh Now"** ở góc phải trên
- Đợi ~30 giây cho sync hoàn tất → trang sẽ tự reload

### 3.2 — Settings
- Vào `https://your-url.vercel.app/settings`
- Kiểm tra Facebook và Shopify hiện **"Connected"** (badge xanh)
- Nếu Facebook hiện **"Disconnected"**: paste Facebook Access Token mới vào form

### 3.3 — AI (Tùy chọn)
- Trong Settings → AI Configuration
- Paste OpenAI API key (bắt đầu bằng `sk-proj-...`)
- Bấm **"🧪 Test Connection"** → phải hiện "✅ Connection successful!"
- Bấm **"💾 Save AI Config"**

---

## 🔧 Xử lý lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách fix |
|------------|-------------|----------|
| Trang trắng / lỗi 500 | Thiếu env vars | Vercel → Settings → Environment Variables → kiểm tra đủ 5 biến |
| Dashboard trống | Chưa sync data | Bấm "Refresh Now" trên dashboard |
| Facebook "Disconnected" | Token hết hạn | Settings → paste token FB mới |
| Shopify Revenue = $0 | Token Shopify sai | Kiểm tra `SHOPIFY_ACCESS_TOKEN` trên Vercel |
| Build failed | Lỗi code | Chạy `npm run build` local để debug |
| "Sync failed" banner đỏ | API token chết | Cập nhật token tại Settings |

---

## 🔄 Cập nhật code sau này

Khi developer gửi code mới:

```bash
cd đường/dẫn/tới/adpilot
git add .
git commit -m "update: mô tả thay đổi"
git push
```

Vercel sẽ **tự động deploy** phiên bản mới trong ~2 phút.

---

## 📞 Liên hệ hỗ trợ

Nếu gặp vấn đề không tự xử lý được, gửi **screenshot lỗi** kèm:
1. URL trang đang bị lỗi
2. Thời gian xảy ra lỗi
3. Console log (bấm F12 → tab Console → screenshot)
