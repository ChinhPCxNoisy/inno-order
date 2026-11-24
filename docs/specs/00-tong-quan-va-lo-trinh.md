# Tổng quan và lộ trình triển khai 3 tính năng ưu tiên 1

Phiên bản: 1.0 (2026-11-12). Người viết: PM/PO. Gồm ba đặc tả:
- `docs/specs/01-vietqr-tu-xac-nhan.md`: VietQR động, tự đối soát, tự xác nhận thanh toán.
- `docs/specs/02-in-phieu-va-thanh-toan-gop-ban.md`: Print Agent thật; Hóa đơn bàn (thanh toán gộp, chia bill, giảm giá cấp bàn); đổi bàn, gộp bàn.
- `docs/specs/03-tich-diem-voucher-zalo.md`: tích điểm, hạng thành viên, voucher qua Zalo, tuân thủ bảo vệ dữ liệu cá nhân.

Ước lượng: S = tối đa 1 ngày công, M = 2-4 ngày, L = 5-10 ngày, tính cho một developer; số tuần dưới đây là tuần công của một developer, chưa tính thời gian chờ đối tác, thiết kế, pháp lý.

---

## 1. Vì sao các tính năng liên quan nhau

Hiện trạng khiến ba tính năng dùng chung một nền chưa tồn tại: hệ thống chưa có khái niệm "phiên bàn/hóa đơn bàn". Thanh toán đang theo từng đơn (`apps/api/src/orders/orders.service.ts:989-1145`, `apps/admin/src/pages/Pos.tsx:544-546`), giảm giá chỉ là một số tiền nhập tay không lưu lý do (`orders.service.ts:1019-1049`), `Payment.orderId` bắt buộc (`apps/api/prisma/schema.prisma:345-362`).

| Phụ thuộc | Lý do |
|---|---|
| Đặc tả 01 cần Bill của Đặc tả 02 | Mã QR phải gắn với số tiền còn phải thu của cả bàn, có thể thu nhiều lần (thiếu/thừa tiền), và bị vô hiệu khi hóa đơn đổi. Làm QR trên từng đơn rồi chuyển sang Bill là làm hai lần |
| Đặc tả 03 cần Bill của Đặc tả 02 | Voucher và điểm là khoản giảm trên hóa đơn (`BillDiscount`), tích điểm xảy ra khi hóa đơn `PAID`; khách gắn vào hóa đơn |
| Đặc tả 03 phần xem ưu đãi công khai và quản lý voucher KHÔNG cần Bill | Có thể giao sớm (Mốc A), thu ngân áp mã thủ công bằng ô giảm giá hiện có cho đến khi có Bill |
| Đặc tả 02 phần A (in phiếu) độc lập với Bill | Chỉ phiếu bill gộp, tạm tính, phiếu đổi bàn phụ thuộc Bill/phiên bàn |
| Đặc tả 02 phần C (đổi/gộp bàn) cần phiên bàn (phần B) | Đổi bàn = dời phiên; gộp bàn = gộp hai phiên thành một bill |
| Realtime chung | Cả ba cần mở rộng `EventsService` (`apps/api/src/realtime/events.service.ts`) thêm sự kiện thanh toán, in lỗi, voucher; nên làm một lần |

---

## 2. Thứ tự triển khai đề xuất

```
Giai đoạn 0 (chuẩn bị, song song)    Quyết định PO + xác minh giả định + dọn dữ liệu demo
        |
Giai đoạn 1: Nền tảng hóa đơn bàn    [02-B] Phiên bàn + Bill + settle  ----+
        |                                                                  |
        +--- song song: [02-A] Print Agent LAN (độc lập)                   |
        +--- song song: [03] Mốc A (ưu đãi công khai, quản lý voucher)     |
        |                                                                  v
Giai đoạn 2: Giá trị lớn nhất        [01] QR động + thu ngân xác nhận (không cần đối tác)
        +--- [02-C] Đổi bàn, gộp bàn
        +--- [02-A] in bill gộp/tạm tính/két/KDS-only
        |
Giai đoạn 3: Tự động hóa             [01] Adaptor nhà cung cấp thật + đối soát + webhook
        +--- [03] Mốc B: thành viên Zalo, điểm, POS áp voucher/điểm
        |
Giai đoạn 4: Hoàn thiện + pilot      [03] Mốc C: chiến dịch tự động, báo cáo; pilot 1 quán, đo KPI
        |
Giai đoạn 5 (tùy chọn)               [03] ZNS; USB qua hàng đợi Windows; chia bill tự phục vụ
```
Lý do chọn: (1) Bill là đường găng, làm trước; (2) QR "bán" được nhờ chiều sâu khác biệt nhưng chỉ làm đúng khi có Bill, nên đứng thứ hai; có thể giao một bản "QR động + thu ngân xác nhận" mà chưa cần đối tác nào, tạo giá trị ngay (số tiền và nội dung điền sẵn, giảm gõ sai) và kiểm thử quét trên các app ngân hàng; (3) In phiếu có thời gian rủi ro phần cứng nên bắt đầu sớm và chạy song song; (4) Thành viên/điểm cần cả Bill lẫn xác minh Zalo (rủi ro bên ngoài) nên để sau; phần ưu đãi công khai làm sớm để tận dụng màn thiết kế đã có và chứng minh giá trị.

Nếu chỉ có một developer: A (in phiếu LAN, M-L) và B (Bill) tuần tự theo thứ tự B -> 01 giai đoạn 2 -> A -> C -> 01 giai đoạn 3 -> 03. Nếu hai developer: Dev 1 làm B, C, 01; Dev 2 làm A, 03 mốc A, sau đó 03 mốc B.

---

## 3. Mốc giao nghiệm thu

| Mốc | Nội dung giao | Điều kiện nghiệm thu (rút gọn) | Tuần công (1 dev) |
|---|---|---|---|
| M0 | Quyết định PO cho 10 câu hỏi (mục 6); xác minh GĐ cốt lõi: tài liệu Zalo xác minh token, nhà cung cấp biến động số dư, mẫu máy in pilot, kiểm thử quét VietQR 3 app; dọn đơn tồn đọng trước migration | Biên bản quyết định + biên bản kiểm thử xác minh | 1 |
| M1 | Phiên bàn, Hóa đơn bàn, thanh toán gộp, chia đều/chia món, giảm giá cấp bàn, phân quyền hạn mức | Tiêu chí nghiệm thu Đặc tả 02 B (12 mục), Scenario 4 của BRD đạt, báo cáo doanh thu không lệch | 4-5 |
| M2a | Print Agent LAN: phiếu bếp/bar có dấu, retry, cảnh báo, in lại, KDS-only | Đặc tả 02 A (12 mục); đo thực tế ở quán pilot | 4-5 |
| M2b | Ưu đãi công khai theo thiết kế (màn 12-13), quản lý voucher, thu ngân áp mã | Đặc tả 03 mục 8: 1-8, 17, 21 | 3-4 |
| M3 | QR động + thu ngân xác nhận; đổi bàn, gộp bàn; in bill gộp, két | Đặc tả 01 (mục 1-bis đến 5, 11-12, 17) và Đặc tả 02 C | 4 |
| M4 | QR tự xác nhận (adaptor thật), đối soát, hoàn tiền QR | Đặc tả 01 mục 8 đầy đủ trên môi trường thật; KPI tự xác nhận >= 95% khi pilot | 3-4 |
| M5 | Thành viên Zalo, điểm, đổi điểm, quyền dữ liệu, POS áp voucher/điểm, chiến dịch tự động, báo cáo | Đặc tả 03 mục 8 đầy đủ; rà soát pháp lý đạt | 4-5 |
| M6 | Pilot 1 quán 2-4 tuần, đo số đo từng đặc tả, quyết định Go/No-Go mở rộng | Báo cáo pilot so với số đo mục 1 của từng đặc tả | 2-4 (lịch) |

Tổng ước lượng: khoảng 21-26 tuần công của một developer cho M1-M5 (Đặc tả 01 khoảng 4-5, Đặc tả 02 khoảng 10-12, Đặc tả 03 khoảng 7-9; có phần chồng lấn dùng chung hạ tầng), cộng M0 và QA/pilot. Với hai developer chạy song song: khoảng 12-14 tuần lịch cho tới trước pilot. Đây là ước lượng thô theo cỡ S/M/L trong từng đặc tả, cần developer rà soát lại sau M0.

---

## 4. Việc dùng chung nên làm một lần (hạ tầng và kỹ thuật)

| Hạng mục | Chi tiết | Bằng chứng hiện trạng |
|---|---|---|
| Bộ lập lịch | Thêm `@nestjs/schedule` (hoặc cơ chế khóa tư vấn Postgres) cho: hết hạn QR, quét lease in, voucher quá hạn, sinh nhật, đối soát đêm | `apps/api/package.json` chưa có |
| Realtime tổng quát | Đổi `OrderEventPayload` thành sự kiện có `data` chung; thêm `payment.*`, `print.*`, `table.moved` | `events.service.ts:6-19, 60-91` nhồi trường rỗng cho `table.call` |
| Scale nhiều instance | `EventsService` và rate limiter đang trong bộ nhớ; khi chạy nhiều instance cần Redis pub/sub (đã có Redis trong `docker-compose.yml`) | `events.service.ts:28-31`, `docs/review/03-dev-backend-report.md` mục B3(c) |
| HTTPS, tên miền cố định, `trust proxy` | Webhook ngân hàng và Print Agent cần HTTPS ổn định; IP thật cho giới hạn tần suất | báo cáo 03 mục B3(c): "chưa bật trust proxy" |
| `rawBody` | Bật ở `main.ts:26` để kiểm chữ ký webhook | `apps/api/src/main.ts:26` |
| Mã hóa bí mật | `APP_ENCRYPTION_KEY` (AES-256-GCM) cho khóa API đối tác/bí mật webhook | chưa có |
| Tách quyền sửa cài đặt | `Store.settings` là JSON tự do mà quản lý sửa được; các cấu hình nhạy cảm (tài khoản nhận tiền, hạn mức giảm giá, chế độ in) phải có API/quyền riêng, không đi qua `PATCH` cài đặt chung | `apps/api/src/stores/stores.service.ts:180-182` |
| Module trả phí | Thêm khóa `qr_auto_confirm`, `loyalty` (và có thể `print_agent`) vào `MODULE_DEFS` để bán theo gói | `apps/api/src/common/modules.ts:5-23` |
| Thư viện QR dùng chung | Mini app chưa có bộ vẽ QR; admin có bộ tự viết `apps/admin/src/qr.ts`; quyết định đưa vào gói dùng chung hay thêm thư viện cho mini app | `apps/admin/src/qr.ts:1-20`, `apps/miniapp/package.json` |
| Quy trình migration | Viết tay SQL + `prisma migrate deploy` vì `migrate dev` không chạy được tự động; mọi migration chỉ thêm, nullable | `docs/review/03-dev-backend-report.md` mục 1 |
| Dữ liệu demo | Quán demo có 18 đơn PENDING cũ ở bàn B01 và đơn `#1028` (3 Payment), `#1029` (0đ) do lỗi cũ: dọn trước khi backfill phiên bàn | báo cáo 03 mục 4-5 |
| Kiểm thử đua | Bộ kiểm thử song song (đã có tiền lệ ở đợt B1-B10) cho thanh toán, voucher, điểm, đổi/gộp bàn | báo cáo 03 mục 2 |
| Thiết kế giao diện mới | Màn thanh toán QR, Hóa đơn của bàn, Điểm thành viên, Đồng ý/Quyền riêng tư, hàng "Ưu đãi" trong giỏ không có trong 16 màn v2 | `docs/specs/*` mục 6 |

---

## 5. Rủi ro chung

1. Refactor đường tiền (thanh toán gộp, phân bổ làm tròn, hoàn tiền): rủi ro lệch doanh thu. Giảm bằng kiểm thử tính toán, đối soát đêm "tổng Payment = tổng bill = tổng đơn", triển khai theo hai bước (đường cũ còn song song), cờ tắt tính năng.
2. Phụ thuộc bên ngoài không kiểm soát: nhà cung cấp biến động số dư, tài liệu Zalo xác minh, phần cứng máy in nhiệt. Giảm bằng adaptor, chế độ suy giảm duyên dáng (QR chỉ thu ngân xác nhận; điểm mức tin cậy thấp; KDS-only) và quán pilot sớm.
3. Dữ liệu cá nhân và pháp lý: consent hiện tại ghi từ dữ liệu client chưa xác thực (`apps/api/src/orders/orders.service.ts:394-429`) cần dọn; phải có tư vấn pháp lý trước khi thu thập tại quán thật.
4. Gian lận nội bộ và bên ngoài: đổi tài khoản nhận tiền, webhook giả, voucher lạm dụng, điều chỉnh điểm. Giảm bằng quyền tối thiểu, nhập lại mật khẩu, duyệt quản lý, audit, báo cáo bất thường.
5. Vận hành tại quán: Print Agent trên PC quầy (tắt máy, cập nhật Windows), nhân viên không đổi bàn trên hệ thống, quán thiếu mạng ổn định. Cần tài liệu hướng dẫn và kế hoạch hỗ trợ từ xa; cập nhật `VIDEO-SCRIPT-HUONG-DAN.md` và hướng dẫn trong `apps/admin/src/help.ts` sau mỗi mốc.
6. Phạm vi phình to: ba đặc tả đều có nhiều biến thể (chia theo món, điểm hết hạn, tự động áp dụng voucher, ZNS). Đã chốt ranh giới "Không gồm"; mọi thêm bớt cần PO duyệt.
7. Xung đột với BRD MVP: BRD loại trừ voucher phức tạp, tích điểm, thanh toán online phức tạp ở MVP (`202609162104.md:185-186, 2406`) nhưng yêu cầu thanh toán gộp (Scenario 4) và máy in thật (FR-PRN-P0). PO cần xác nhận đây là giai đoạn sau MVP cho phần 01 và 03.
8. Năng lực đội: ba đặc tả tập trung vào một đường găng (Bill) nên một developer là điểm nghẽn; xem phương án hai developer ở mục 2.
9. Sai lệch giữa ước lượng và thực tế do chưa có xác minh GĐ: ước lượng mới ở mức thô, cần rà soát lại sau M0.

---

## 6. Mười câu hỏi quan trọng nhất cần chủ sản phẩm trả lời trước khi bắt đầu

1. Nhà cung cấp nhận biến động số dư cho QR tự xác nhận: chọn nhà cung cấp nào (hay kết nối trực tiếp ngân hàng), ai ký hợp đồng (InnoCom hay từng quán), và chấp nhận Giai đoạn 2 chỉ giao QR động + thu ngân xác nhận trong lúc chờ onboarding đối tác không? (Đặc tả 01 Q1)
2. Mô hình thương mại: có thu phí theo giao dịch QR không, ai chịu phí của nhà cung cấp (quán hay InnoCom), và các tính năng này thuộc gói nào (BRD tham khảo Basic/Standard/Pro: `202609162104.md:1975-1985`)? Giá gói và phí giao dịch do chủ sản phẩm quyết định; tài liệu này không có số liệu giá. Cân nhắc thêm: tiền thanh toán luôn về tài khoản của quán, InnoCom không thu hộ (khuyến nghị để tránh nghĩa vụ trung gian thanh toán, cần xác nhận pháp lý).
3. Quán pilot là ai: máy in nào (hãng, model, kết nối LAN hay USB), có PC Windows ở quầy không, mạng ổn định không? BRD FR-PRN-09 coi USB là P0: có chấp nhận LAN trước và USB giai đoạn sau không?
4. Chế độ thanh toán mặc định: trả sau khi ăn (hiện tại) hay có chế độ trả trước cho quán cà phê/trà sữa (bếp chỉ làm khi đã trả)? Khách tự thanh toán QR trong mini app bật mặc định hay chỉ thu ngân tạo QR?
5. Chính sách tiền: tiền chuyển thiếu (ghi nhận một phần hay từ chối), thừa (hoàn hay ghi nhận tip), hoàn tiền QR (chấp nhận hoàn thủ công bằng chuyển khoản của quản lý, hệ thống chỉ ghi nhận và nhắc)?
6. Quyền và hạn mức: hạn mức giảm giá của Thu ngân (phần trăm/đồng) và cách quản lý duyệt (mật khẩu hay PIN); ai được đổi bàn (Phục vụ có được không), ai được gộp bàn; Thu ngân có được gán giao dịch ngân hàng "mồ côi" không?
7. Danh tính khách: nếu không xác minh được token Zalo ở phía máy chủ, chấp nhận mức tin cậy thấp (không đổi điểm) hay đầu tư OTP SMS (tốn phí)? Cho phép Super Admin làm gì với dữ liệu cá nhân khách của quán?
8. Pháp lý dữ liệu cá nhân: chốt tư vấn pháp lý về Nghị định 13/2023/NĐ-CP trước pilot; đặt lại consent tiếp thị hiện có chưa xác thực về "chưa đồng ý" (khuyến nghị: có); thời hạn lưu dữ liệu giao dịch ngân hàng và `rawPayload`.
9. Chính sách chương trình khách hàng: điểm có hết hạn không; quán được tự đặt tỷ lệ tích điểm/quy đổi tự do hay trong khung InnoOrder đặt; hoàn tiền có hoàn lượt voucher; có bật tự động áp dụng voucher trong giỏ (thiết kế v2 đang nói "quán xác nhận")? ZNS tính phí có làm không, ai trả (không có giá trong tài liệu)?
10. Nguồn lực và thiết kế: bao nhiêu developer và thiết kế cho các màn mới (thanh toán QR, Hóa đơn của bàn, Điểm thành viên, Đồng ý/Quyền riêng tư, hàng ưu đãi trong giỏ) từ ai, vào thời điểm nào; chấp nhận thứ tự trong mục 2 (Bill trước, in phiếu song song, QR, thành viên sau) hay muốn thứ tự khác?

---

## 7. Hạng mục cần xác minh trước khi code (tổng hợp giả định)

Giả định ở từng đặc tả được đánh nhãn GĐ-xx; các mục có ảnh hưởng đường găng:
- Đặc tả 01: GĐ-01, GĐ-06, GĐ-07 (độ trễ, chuỗi VietQR, API/ký/giá/onboarding của đối tác), GĐ-03 (liên kết sâu mở app ngân hàng, lưu ảnh QR trong mini app).
- Đặc tả 02: GĐ-A2, GĐ-A3, GĐ-A4, GĐ-A5 (bảng mã tiếng Việt, in USB trên Windows, trạng thái máy in, độ rộng điểm ảnh theo từng model).
- Đặc tả 03: GĐ-01 (xác minh token Zalo phía máy chủ), GĐ-03 (ZNS), GĐ-04 (clipboard), GĐ-05 (pháp lý).
Mọi mục trên phải có biên bản xác minh ngắn (nguồn, ngày, kết quả) đính kèm vào đặc tả tương ứng trước khi viết mã liên quan; nếu không xác minh được thì kích hoạt chế độ suy giảm đã nêu trong đặc tả.
