# InnoOrder

SaaS gọi món theo bàn cho quán ăn/cà phê/trà sữa: 1 nền tảng, nhiều quán (multi-tenant).

> BRD: [`202609162104.md`](./202609162104.md) · Review: [`docs/review/`](./docs/review)

## Stack

| Tầng | Công nghệ |
|---|---|
| Backend | Node.js >= 20 (khuyến nghị 24 LTS), NestJS 12, TypeScript |
| ORM | Prisma 6 |
| DB | PostgreSQL 16 (Docker) |
| Cache/PubSub | Redis 7 (Docker, đã khai báo `REDIS_URL`; realtime SSE hiện chạy trong tiến trình API, 1 instance) |
| Admin UI | React 18 + Vite + TypeScript (`apps/admin`) |
| Khách gọi món | Zalo Mini App (`apps/miniapp`): React 18 + TypeScript + zmp-sdk/zmp-ui, build bằng `zmp` CLI (Vite) |

## Cấu trúc

```
inno-order/
├── docker-compose.yml      # PostgreSQL + Redis
├── .env                    # biến môi trường (không commit, mẫu: .env.example)
├── docs/review/            # báo cáo review PM / QA / dev
├── ui-html-v5/             # bộ HTML thiết kế tham chiếu
└── apps/
    ├── api/                # NestJS backend (REST /api/v1 + SSE realtime)
    │   ├── prisma/         # schema.prisma, migrations, seed.ts
    │   └── src/            # auth, stores, tables, menu, orders, pos, kitchen,
    │                       # printers, reports, reviews, table-calls, public, realtime
    ├── admin/              # Admin UI (POS, KDS, phục vụ, menu, đơn, báo cáo)
    └── miniapp/            # Zalo Mini App cho khách (quét QR -> gọi món -> theo dõi đơn)
```

## Chạy dự án

Yêu cầu: Docker, Node.js >= 20.

```bash
# 1. Chạy DB + Redis
npm run db:up

# 2. Cài dependencies (lần đầu, chạy ở thư mục gốc)
npm install

# 3. Tạo file .env từ mẫu rồi chỉnh giá trị (JWT_SECRET, QR_BASE_URL...)
cp .env.example .env

# 4. Tạo bảng (migrate) + generate Prisma client + seed dữ liệu demo
npm run db:migrate
npm run db:generate
npm run db:seed

# 5. API (dev, watch) - terminal 1
npm run dev

# 6. Admin UI (dev, hot reload) - terminal 2
npm run admin:dev

# 7. Mini app khách - terminal 3 (zmp CLI, cần đăng nhập Zalo: `npm run login` trong apps/miniapp)
cd apps/miniapp
npm start            # = zmp start --port 3002
```

Cổng dev và kiểm tra:

| Thành phần | Địa chỉ | Ghi chú |
|---|---|---|
| API | `http://localhost:3000/api/v1/health` | prefix `/api/v1` |
| Admin | `http://localhost:5173` | proxy `/api` -> `localhost:3000` |
| Mini app | `http://localhost:3002` | `zmp start --port 3002` |

Luồng QR của khách: `http://localhost:3002/s/{slug}/t/{mã bàn}` (vd. `/s/bunbohuong/t/B01`).

Không cần đăng nhập Zalo để xem giao diện trên trình duyệt: có thể chạy mini app bằng Vite với một file cấu hình tạm đặt trong `apps/miniapp` (root là thư mục app, alias `@` -> `src`, proxy `/api` -> `localhost:3000`) và xóa sau khi dùng. Ngoài Zalo, các tính năng phụ thuộc `zmp-sdk` (đăng nhập Zalo, thông báo) không dùng được.

## Biến môi trường chính

Khai báo trong `.env` (xem `.env.example`):

| Biến | Ý nghĩa |
|---|---|
| `PORT` | Cổng API (mặc định 3000) |
| `DATABASE_URL`, `REDIS_URL` | Kết nối PostgreSQL / Redis |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Khóa và hạn token (đặt khóa mạnh khi triển khai) |
| `QR_BASE_URL` | Địa chỉ gốc **của mini app khách**; QR bàn có dạng `{QR_BASE_URL}/s/{slug}/t/{mã bàn}` |
| `CORS_ORIGINS` | Danh sách origin frontend, phân tách bằng dấu phẩy |

Biến của frontend (Vite, tùy chọn):

| Biến | App | Ý nghĩa |
|---|---|---|
| `VITE_MINIAPP_BASE_URL` | admin | Địa chỉ gốc mini app dùng để tạo link/QR bàn trong trang Bàn. Không đặt: dev dùng `http://{host}:3002`, production lấy theo `QR_BASE_URL` của bàn |
| `VITE_API_BASE` | miniapp | Chỉ đặt khi mini app và API khác domain |

## Tài khoản demo (sau khi seed, chỉ dùng môi trường phát triển)

Seed tạo Super Admin `admin@innoorder.com` và quán demo `Quán Bún Bò Hương` (slug `bunbohuong`, bàn B01-B06) với các tài khoản `owner@`, `cashier@`, `waiter@`, `kitchen@bunbohuong.com`. Mật khẩu xem trong `apps/api/prisma/seed.ts`; phải đổi hoặc không seed khi triển khai thật. Trang đăng nhập admin chỉ hiện gợi ý demo ở chế độ dev.

## Lệnh thường dùng

| Lệnh | Tác dụng |
|---|---|
| `npm run db:up` / `db:down` | Bật/tắt Postgres + Redis |
| `npm run db:psql` | Vào psql |
| `npm run db:migrate` | Tạo/áp dụng migration (dev) |
| `npm run db:deploy` | Áp dụng migration (prod) |
| `npm run db:seed` | Seed dữ liệu demo |
| `npm run db:studio` | Prisma Studio |
| `npm run dev` | API dev (`nest start --watch`) |
| `npm run build` / `npm start` | Build / chạy API |
| `npm run admin:dev` | Admin dev (cổng 5173) |
| `npm run admin:build` | Build Admin (typecheck + bundle) |
| `npm start` trong `apps/miniapp` | Mini app dev (`zmp start --port 3002`) |
| `npm run deploy` trong `apps/miniapp` | Triển khai mini app (`zmp deploy`) |

Kiểm tra kiểu mini app: `npx tsc --noEmit -p tsconfig.json` trong `apps/miniapp`.

## Data model

`stores`, `areas`, `tables`, `menu_categories`, `menu_items`, `menu_options`, `orders`, `order_items`, `order_item_options`, `payments`, `users`, `printers`, `print_jobs`, `customers`, `audit_logs` cùng các bảng mở rộng (đánh giá, yêu cầu gọi bàn); xem `apps/api/prisma/schema.prisma`.

Quy tắc quan trọng:
- Mọi record nghiệp vụ gắn `storeId` (tách tenant, BRD 10.1).
- `order_items` giữ `nameSnapshot` + `priceSnapshot`: đơn không đổi khi menu đổi.
- Trạng thái bàn: `AVAILABLE -> OCCUPIED -> NEED_CLEAN -> AVAILABLE` (+ `LOCKED`).
- Trạng thái đơn: `PENDING -> ACCEPTED -> PREPARING -> READY -> COMPLETED` (+ `CANCELLED`, `REFUNDED`, `PARTIAL_REFUND`).
- `print_jobs` log mọi lần in; in lại có loại `REPRINT`.

## API

Global prefix `/api/v1`. Nhóm chính: `auth`, `stores`, `tables`, `menu`, `orders`, `pos`, `kitchen`, `printers`, `reports`, `reviews`, `table-calls`, `realtime` (SSE), và nhóm công khai cho khách `public/*` (xác nhận bàn, thực đơn, tạo đơn, theo dõi đơn, đánh giá, gọi nhân viên). Tạo đơn công khai nhận thêm `clientRequestId` để chống gửi trùng.

## Tiến độ

- [x] Phase 0: BRD, data model, setup
- [x] Phase 1: Backend core (auth, store, bàn, menu, đơn, thanh toán, báo cáo, audit)
- [x] Phase 2: Kênh khách bằng Zalo Mini App (bàn, menu, giỏ, đơn, theo dõi, gọi nhân viên, đánh giá); còn thiếu đăng nhập/thông báo Zalo thật và ưu đãi
- [x] Phase 3: POS + KDS + realtime (SSE)
- [ ] Phase 4: In phiếu thật (ESC/POS qua LAN/USB; hiện mới ghi job, chưa gửi máy in)
- [ ] Phase 5: Pilot và hardening (xem các việc còn lại trong `docs/review/`)
