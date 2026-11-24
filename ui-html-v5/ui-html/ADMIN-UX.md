# InnoOrder Admin v5 — Thiết kế theo bộ phận

Mở admin/login.html để đăng nhập bằng email + mật khẩu demo (5 tài khoản, mật khẩu in sẵn trên màn hình, hoặc bấm thẳng vào tài khoản để vào nhanh).

| Bộ phận | Màn ưu tiên | Công việc chính |
|---|---|---|
| Thu ngân | POS / Bán hàng | Chọn bàn, gọi thêm món, xem hóa đơn, thu tiền |
| Bếp / Bar | Hàng chờ chế biến | Lọc khu, nhận món, đọc ghi chú, báo món xong |
| Phục vụ | Món chờ mang / bàn cần dọn | Mang đúng món tới đúng bàn, dọn bàn |
| Chủ quán | Tổng quan / Báo cáo | Việc tồn, doanh thu đã thu, món bán, cấu hình quán |
| Quản trị nền tảng | Quán trên nền tảng | Hồ sơ tenant và gói pilot mẫu |

## Nguyên tắc UX
- Sidebar đưa công việc chính lên trước; nhóm tham khảo được thu gọn ở không gian tác nghiệp.
- POS dùng bảng bàn và hóa đơn cạnh nhau. Mã bàn, trạng thái, tiền chưa thu luôn có nhãn chữ.
- Bếp hiển thị món theo giai đoạn, ưu tiên đơn cũ trước, làm nổi bật ghi chú; có chế độ tập trung ẩn sidebar.
- Phục vụ tách khỏi thu ngân để không phải tìm món xong trong hóa đơn.
- Tìm kiếm, bộ lọc, trạng thái rỗng và phản hồi thao tác có trên từng màn cần thiết.
- Báo cáo tính từ đơn đã nhận tiền; không gộp tiền đang mở vào doanh thu.
- Đơn cũ giữ giá tại thời điểm gọi món khi thực đơn đổi giá.
- Màn cấu hình bàn không cho đổi trạng thái thủ công khi đang có đơn mở.

## Luồng dùng thử đề xuất
1. Mở POS, chọn B01, Tạo đơn. Thêm bún bò và trà đào, nhập ghi chú.
2. Mở Bếp/Bar, chọn Bếp, nhận món và báo xong. Làm tương tự ở Bar.
3. Mở Phục vụ, xác nhận các món đã mang đến B01.
4. Về POS, chọn B01, thanh toán. Chọn tiền mặt hoặc chuyển khoản. Tiền mặt có tính tiền trả lại.
5. Xác nhận đã nhận tiền demo. Bàn đổi sang Cần dọn, doanh thu tăng.
6. Mở Phục vụ, xác nhận Đã dọn bàn. B01 trở lại Trống.
7. Mở Báo cáo để xem số liệu hoặc tải CSV.

## Chức năng tương tác trong bản demo
- Tạo đơn, ghi chú từng món, tăng/giảm số lượng; chọn đúng bàn, chặn món tạm hết.
- Chuyển trạng thái từng dòng món hoặc hàng loạt trong khu Bếp/Bar đang lọc.
- Phục vụ xác nhận mang món; thu tiền; dọn bàn; mở lại bàn tạm khóa.
- Thanh toán sau khi phục vụ đủ món; chặn tiền khách đưa thiếu. Chuyển khoản cần người dùng tự xác nhận.
- Hủy đơn chưa được bếp nhận. Đơn đã chế biến không có hủy đơn tự do trong demo.
- Tìm đơn, lọc trạng thái, xem chi tiết, xem bill và in qua hộp thoại trình duyệt.
- Thêm/sửa món, đánh dấu tạm hết; thêm/sửa bàn và khu vực; hồ sơ nhân viên; bảo vệ chủ quán hoạt động cuối cùng.
- Lưu cấu hình máy in mẫu, thử lại lỗi in mô phỏng; hồ sơ tenant mẫu.
- Xuất CSV đơn hàng và doanh thu. Có bảo vệ chuỗi người dùng nhập bắt đầu bằng ký tự công thức.
- Khôi phục dữ liệu admin trong Hướng dẫn hoặc màn chọn không gian, không xóa dữ liệu customer.

## Phạm vi và giới hạn
Đây là prototype HTML cục bộ, không phải phần mềm vận hành production. Không có backend, xác thực/phân quyền bảo mật, cơ chế đa tenant thật, thanh toán ngân hàng, realtime server, kết nối máy in LAN/USB hay tích hợp Zalo SDK. Chuyển vai trò chỉ đổi ưu tiên UI. Mọi số liệu và nhật ký in là demo; không gửi đơn, thu tiền hoặc in thiết bị tự động.

Admin và customer có kho dữ liệu demo riêng, chưa đồng bộ với nhau. Customer v4 được giữ nguyên toàn bộ mã và CSS. Dữ liệu admin lưu localStorage trên trình duyệt. Dùng HTTP khi cần chia sẻ ổn định giữa các trang/tab. Chuyển trạng thái ở tab khác có thể nhận qua sự kiện storage, không thay thế đồng bộ server hoặc khóa dữ liệu.

Quy tắc demo hiện tại yêu cầu các món Đã phục vụ trước khi thanh toán, không hỗ trợ thanh toán trước, tách/gộp bàn, chia bill, đặt bàn, giảm giá, hoàn tiền, ca tiền mặt hay phân quyền thật. Những phần này cần nghiệp vụ riêng trước khi triển khai.

## Kiểm tra
- Chromium: 12 trang admin render không có lỗi JavaScript; không tràn ngang các màn chính ở 360, 768, 1024, 1440 px.
- Chạy xuyên suốt POS → Bếp/Bar → Phục vụ → Thu tiền → Dọn bàn.
- Kiểm tra trạng thái chưa phục vụ, tiền khách đưa thiếu, tiền thừa, hủy đơn chờ, giá cũ trong hóa đơn, món hết, thêm bàn, chủ quán cuối cùng, retry in mô phỏng, tải CSV.
- Đã xem ảnh render POS và KDS, chỉnh lỗi bố cục hóa đơn và tăng độ rõ của tên món/ghi chú.
- Customer v4 đối chiếu byte với bản zip trước, không thay đổi.
- Chưa kiểm tra thiết bị POS, màn hình cảm ứng, máy in hoặc trình duyệt trên điện thoại thật.
