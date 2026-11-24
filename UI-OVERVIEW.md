# InnoOrder — Tổng quan giao diện

> Tham chiếu nhanh cho thiết kế và phát triển giao diện. Bộ HTML thiết kế (prototype) nằm ở `ui-html-v5/ui-html/` (mở `index.html`). Mã nguồn thật: `apps/admin/src` và `apps/miniapp/src`.

## 1. Dự án

**InnoOrder**: nền tảng SaaS gọi món theo bàn cho quán ăn, đa quán (multi-tenant).
Stack: Node.js >= 20 · NestJS 12 · Prisma 6 · PostgreSQL 16 · Redis 7 · React 18 + TypeScript.

| App | Đường dẫn | Người dùng | Nền tảng | Cổng dev |
|---|---|---|---|---|
| API | `apps/api` | (backend) | NestJS, REST `/api/v1` + SSE | 3000 |
| **Admin** | `apps/admin` | Chủ quán, thu ngân, bếp, phục vụ, quản trị nền tảng | Web desktop/tablet, sidebar bên trái (thu gọn trên mobile) | 5173 |
| **Mini app khách** | `apps/miniapp` | Khách ăn tại quán | Zalo Mini App (zmp-sdk + zmp-ui), mobile-first, khung tối đa 440px | 3002 (`zmp start --port 3002`) |

Luồng tổng thể: khách quét QR tại bàn (`/s/{slug}/t/{mã bàn}`) → xác nhận bàn → xem thực đơn → giỏ → gửi đơn → theo dõi đơn → thanh toán tại quầy → đánh giá phục vụ. Nhân viên dùng Admin: POS tạo đơn/thanh toán, KDS cho bếp, màn Phục vụ mang món/dọn bàn/nhận yêu cầu gọi bàn, báo cáo.

## 2. Mini app khách (`apps/miniapp`)

Giao diện theo bộ thiết kế v2 (tiêu đề, thẻ bo tròn, màu chủ đạo đỏ `--red` mặc định, màu nhấn xanh navy). CSS tập trung ở `src/css/app.scss`; các khối bổ sung cho bản React nằm ở cuối file. Theme theo quán: `themeColor` của quán được áp dụng bởi `src/theme.ts`.

Thành phần chung (`src/components`): `Shell` (thanh trên + nội dung + thanh điều hướng 3 tab hoặc dock cố định), `FoodSheet` (bottom sheet chi tiết món, chọn option, ghi chú, số lượng), `StateView` (trạng thái rỗng/lỗi), `ui` (toast + hộp thoại), `Icon`, `Img`.

| Route | Màn hình | Ghi chú |
|---|---|---|
| `/s/:slug/t/:tableCode` | Chào mừng | Xác nhận bàn qua API; bàn sai/khóa hiện trạng thái tương ứng |
| `/s/:slug?t=B01` | Thực đơn | Xác nhận bàn khi mở; tìm kiếm không dấu, danh mục, thanh giỏ nổi, "Trong giỏ: N" |
| `/s/:slug/cart` | Giỏ món | Mỗi biến thể món (option + ghi chú) là một dòng riêng; lỗi gửi đơn hiện ngay trên nút trong dock; gửi kèm `clientRequestId` chống trùng |
| `/s/:slug/order/:id/sent` | Đã gửi đơn | |
| `/s/:slug/order/:id` | Theo dõi đơn / chi tiết đơn hoàn tất | Poll 3 giây; hiện option từng món, món đã hủy (gạch ngang + nhãn "Đã hủy"), ghi chú đơn |
| `/s/:slug/order/:id/review` | Đánh giá phục vụ | Sau khi thanh toán |
| `/s/:slug/orders` | Lịch sử đơn (lưu trên thiết bị) | |
| `/s/:slug/support` | Gọi nhân viên (nước, khăn, tính tiền...) | |
| `/s/:slug/voucher` | Ưu đãi | Mới là trạng thái "đang chuẩn bị" |
| `/s/:slug/profile` | Cá nhân | Đăng nhập Zalo, xóa dữ liệu trên thiết bị |

Quy ước giao diện mobile: vùng bấm tối thiểu 44x44px, chữ phụ dùng `--muted` đạt tương phản 4.5:1, lỗi hiển thị trong vùng nhìn thấy cạnh nút hành động với `role="alert"`, nội dung cuối trang chừa padding cho thanh cố định. Kiểm tra ở 360x740 và 390x844.

Thông báo lỗi cho khách luôn bằng tiếng Việt có dấu (`errMsg` trong `src/api.ts` ánh xạ mất mạng/429/404/5xx sang câu thân thiện).

## 3. Admin (`apps/admin`)

Sidebar trái theo bộ phận/vai trò (`Layout.tsx`), nội dung ở `src/pages`. Màu chủ đạo xanh lục `--green: #137d69`, nền `#f5f7fa`, font hệ thống 14px (token ở đầu `src/styles.css`).

| Route | Trang | Vai trò |
|---|---|---|
| `/login` | Đăng nhập (gợi ý demo chỉ hiện khi chạy dev) | tất cả |
| `/` | Tổng quan vận hành | mọi vai trò |
| `/pos` | Bán hàng / thu ngân: lưới bàn, tạo đơn, thanh toán | chủ quán, quản lý, thu ngân, phục vụ |
| `/kitchen` | Bếp / Bar (KDS): 3 cột Chờ nhận · Đang chế biến · Chờ mang ra; làm mới ngầm mỗi 15 giây | mọi vai trò |
| `/service` | Phục vụ: món sẵn sàng, yêu cầu gọi bàn (kèm lý do, ghi chú, tuổi yêu cầu), dọn bàn | chủ quán, quản lý, thu ngân, phục vụ |
| `/orders` | Lịch sử đơn, hủy/hoàn tiền | mọi vai trò (thao tác theo quyền) |
| `/menu` | Thực đơn, option, bật/tắt món | mọi vai trò xem; chủ quán, quản lý sửa |
| `/tables` | Khu vực & bàn, link và mã QR theo bàn | mọi vai trò xem; chủ quán, quản lý sửa |
| `/users` | Nhân sự & vai trò | chủ quán, quản lý |
| `/printers` | Máy in & hàng đợi in | chủ quán, quản lý |
| `/reports` | Báo cáo ngày, top món, theo phương thức | chủ quán, quản lý, thu ngân |
| `/stores` | Quản lý quán trên nền tảng | quản trị nền tảng |

Trạng thái chính (dùng nhất quán giữa Admin, API và mini app):
- Đơn: `PENDING → ACCEPTED → PREPARING → READY → COMPLETED` (+ `CANCELLED`, `REFUNDED`, `PARTIAL_REFUND`).
- Món: Chờ · Đã nhận · Đang làm · Sẵn sàng · Đã phục vụ · Đã hủy.
- Bàn: `AVAILABLE` (Trống) · `OCCUPIED` (Đang dùng) · `NEED_CLEAN` (Cần dọn) · `LOCKED` (Khóa).

## 4. Quy ước cho người thiết kế / phát triển giao diện

1. Giữ 100% tiếng Việt có dấu trên giao diện; chuỗi trong code và comment tiếng Việt không dấu theo phong cách hiện có.
2. Mini app: thay diện mạo bằng cách sửa token/khối CSS trong `app.scss`, không phá cấu trúc class; mỗi quán một màu chủ đạo qua theme.
3. Mini app phải dùng tốt ở chiều rộng 360-440px: thanh điều hướng/dock cố định, thanh giỏ nổi phía trên, popup là bottom sheet.
4. Các trạng thái biên (rỗng, lỗi, đang tải, mất mạng, bàn sai/khóa, đơn trễ) phải có thiết kế rõ ràng.
5. Link/QR bàn trỏ về địa chỉ mini app (`QR_BASE_URL` ở API hoặc `VITE_MINIAPP_BASE_URL` ở Admin), không phải địa chỉ Admin.
