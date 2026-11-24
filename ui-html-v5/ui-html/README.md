# InnoOrder — Bộ giao diện: Customer v4 + Admin v5

Bộ prototype HTML tương tác dùng để trình bày và duyệt thiết kế. Mở **`index.html`** để bắt đầu.

| App | File | Mô tả |
|---|---|---|
| Admin v5 | `js/admin-v5.js` + `admin-v5.css` | Không gian vận hành theo bộ phận: Chủ quán, Thu ngân, Bếp/Bar, Phục vụ, Quản trị nền tảng |
| Customer v4 | `js/customer-v3.js` + `customer-v3.css` | Trải nghiệm tại bàn của khách (menu, giỏ, theo dõi đơn, voucher, cá nhân) |

## Chạy

Mở `index.html` trực tiếp. Nếu trình duyệt không chia sẻ `localStorage` giữa các trang `file://`, hãy phục vụ qua HTTP:

```
python -m http.server 8080
# mở http://localhost:8080
```

## Admin v5

Mở `admin/login.html` để đăng nhập bằng email + mật khẩu demo (5 tài khoản, mật khẩu in sẵn; bấm thẳng vào tài khoản để vào nhanh). Chi tiết luồng thao tác và giới hạn: **`ADMIN-UX.md`**.

- 12 trang: Tổng quan · Bán hàng/POS · Bếp/Bar · Phục vụ · Lịch sử đơn · Thực đơn · Khu vực & bàn · Nhân sự · Máy in · Báo cáo · Quán trên nền tảng · Chọn không gian.
- Luồng demo xuyên suốt: tạo đơn tại bàn → bếp nhận/hoàn tất (Bếp & Bar) → phục vụ mang món → thanh toán (tiền mặt có tính tiền trả lại, chặn tiền thiếu) → bàn chuyển "Cần dọn" → dọn bàn → doanh thu tăng.
- Dữ liệu lưu `localStorage` (key `inno-admin-v5`), dùng chung giữa các màn; có nút **Khôi phục dữ liệu demo ban đầu** trong Hướng dẫn và màn chọn không gian.
- Có xuất CSV, in bill qua hộp thoại trình duyệt, chế độ tập trung cho bếp, cảnh báo đơn chờ từ 15 phút, bảo vệ "chủ quán hoạt động cuối cùng".

## Customer v4

Mở `customer/menu.html` (hoặc `customer/home.html` cho màn chào). 8 trang: trang chủ · xác nhận bàn · menu · tùy chọn món (bottom sheet) · giỏ · theo dõi đơn · voucher · cá nhân.

- Bố cục menu: ảnh món bên trái, tên/mô tả/giá/nút thêm bên phải; tìm kiếm + danh mục cố định khi cuộn, có xóa từ khóa và khôi phục khi không có kết quả.
- Thanh điều hướng 3 mục: Thực đơn · Đơn của bạn · Cá nhân. Voucher/thành viên là màn tham chiếu giai đoạn sau MVP.
- Giỏ nổi chỉ hiện khi có món; sửa lại tùy chọn món ngay trong giỏ; số lượng phản hồi trên menu.
- Bàn, giỏ, đơn lưu `localStorage` (key `inno-v3-cart`, `inno-v3-order`, `inno-v3-table`); nút "Xóa giỏ và đơn minh họa" trong trang Cá nhân.

## Giới hạn chung

Prototype HTML cục bộ: chưa có backend, Zalo SDK, QR xác thực bàn thật, realtime, thanh toán ngân hàng, kết nối máy in LAN/USB. Admin và customer chạy hai kho demo riêng, chưa đồng bộ. Mọi số liệu, phiếu in, trạng thái là minh họa — không gửi đơn thật, không thu thập dữ liệu cá nhân.

## Ảnh

Ảnh món tạo bằng công cụ AI (bún bò, phở bò, phở gà — WebP; món còn lại là SVG minh họa), không phải ảnh thật của quán. Thay bằng ảnh món của quán khi triển khai.

## Cấu trúc thư mục

```
ui-html/
├── index.html            # Trang tổng hợp
├── admin-v5.css          # CSS admin v5
├── customer-v3.css       # CSS customer v4 (tên file giữ từ phiên bản trước)
├── admin/                # 12 trang admin (mỗi trang là vỏ gọi admin-v5.js)
├── customer/             # 8 trang customer (mỗi trang là vỏ gọi customer-v3.js)
├── js/
│   ├── admin-v5.js       # Toàn bộ logic + dữ liệu demo admin
│   └── customer-v3.js    # Toàn bộ logic + dữ liệu demo customer
├── assets/               # Ảnh món (webp/png/svg)
└── archive/              # Bản thiết kế cũ (v1–v4), không còn dùng
    ├── admin-v2.css
    ├── admin-layout-v1.js
    ├── customer-v4-static.css
    ├── customer-v4-static.js
    ├── customer-tabbar-v1.js
    └── icons-v1.js
```

## Kiểm tra đã thực hiện

- 20 trang render không lỗi JavaScript (headless Chromium).
- Không tràn ngang customer ở 320/360/390/430/768px; admin ở 360/768/1024/1440px.
- Chạy xuyên suốt POS → Bếp/Bar → Phục vụ → Thu tiền → Dọn bàn; các chặn: món chưa phục vụ, tiền khách đưa thiếu, hủy đơn chờ, món tạm hết, chủ quán cuối cùng, retry in mô phỏng, tải CSV.
- Chưa kiểm thử trên thiết bị thật, POS cảm ứng, máy in hoặc Zalo WebView.
