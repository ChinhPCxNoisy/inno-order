# Đặc tả 02 - In phiếu thật (Print Agent) và Thanh toán gộp theo bàn, đổi bàn, gộp bàn

Phiên bản: 1.0 (2026-11-12). Người viết: PM/PO. Đối tượng đọc: Developer (dev-inno), Tester.
Ước lượng: S = tối đa 1 ngày công, M = 2-4 ngày, L = 5-10 ngày (một developer).
"GĐ-xx" = giả định cần xác minh (phụ thuộc phần cứng/đối tác/chuẩn ngoài mà PO không thể xác minh khi viết).

Tài liệu gồm ba phần độc lập về triển khai nhưng liên quan chặt:
- Phần A: Print Agent thật, phiếu bếp/bar theo khu, bill, in lại, phiếu hủy, két tiền, phương án chỉ dùng màn hình bếp (KDS-only).
- Phần B: Phiên bàn (TableSession) và Hóa đơn bàn (Bill): thanh toán gộp một lần, chia bill, giảm giá cấp bàn. Đây là nền cho Đặc tả 01 (QR tự xác nhận) và Đặc tả 03 (voucher/điểm).
- Phần C: Đổi bàn, gộp bàn, kể cả khi khách đang theo dõi đơn trong mini app.

Thứ tự đề xuất: B (nền) -> C -> A song song với B (A có phần cứng, nên bắt đầu sớm để tìm quán pilot). Chi tiết ở `00-tong-quan-va-lo-trinh.md`.

---

## 0. Hiện trạng code (bằng chứng)

### 0.1 In phiếu
| Phát hiện | Bằng chứng |
|---|---|
| `PrintService.enqueue` không gửi gì ra máy in. Nếu máy in "không OFFLINE/ERROR" thì job được ghi ngay `SENT` và `printedAt = now()`, tức là "in thành công" giả | `apps/api/src/printers/print.service.ts:203-217` |
| Máy in tạo mới luôn `OFFLINE` (default) và không có mã nào đặt `ONLINE`, DTO cập nhật cũng không có `status`; `lastSeenAt` không bao giờ được ghi. Nghĩa là mọi job của máy in tạo qua giao diện đều `FAILED` "đang offline" trừ khi sửa DB tay | `apps/api/prisma/schema.prisma:403-404`, `apps/api/src/printers/printers.service.ts:27-114`, `apps/api/src/printers/dto/printer.dto.ts` |
| Lỗi in bị nuốt: `printKitchenTicket(...).catch(() => undefined)`; không có sự kiện realtime hay cảnh báo cho nhân viên, trái BRD FR-NTF-04 (cảnh báo máy in lỗi, P0) | `apps/api/src/orders/orders.service.ts:253`, `:1105`; BRD `202609162104.md:956` |
| Chọn máy in chỉ theo `station` cố định, lấy máy đầu tiên (`find`); không chọn theo món/danh mục, không có Bar riêng cho món đồ uống, không dự phòng | `print.service.ts:39-44, 46-76` |
| `MenuCategory`/`MenuItem` không có trường khu in | `schema.prisma:209-247` |
| Nội dung phiếu là chuỗi văn bản KHÔNG DẤU ("Quan:", "Ban:", "Tam tinh:", "Cam on quy khach!"), độ rộng cứng 42 ký tự bất kể `paperSize`/`charsPerLine` | `print.service.ts:18-26, 51-73, 89-112` |
| Bill tính theo từng đơn; không có bill gộp bàn | `print.service.ts:79-115`, `orders.service.ts:1095-1106` |
| Có hàm phiếu hủy món nhưng chỉ in ra khu bếp, không theo khu của món | `print.service.ts:143-152`, gọi ở `orders.service.ts:867, 962` |
| `PrintJob.content` là chuỗi, không có hàng đợi/retry/khóa thuê (lease); `attemptCount` luôn 1 | `schema.prisma:414-435`, `print.service.ts:219` |
| Admin: màn "Máy in & hàng đợi" xem danh sách job, tạo/sửa máy in, test print | `apps/admin/src/pages/Printers.tsx:154-161`, `apps/api/src/printers/printers.controller.ts:28-70` |
| KDS (Bếp / Bar) hiện toàn bộ đơn, không lọc theo khu; trong menu gọi là "Bếp / Bar" | `apps/admin/src/pages/Kitchen.tsx`, `orders.service.ts:726-765`, `Layout.tsx:25` |
| BRD: máy in LAN/USB, "Không expose máy in ra internet trực tiếp", Option B Local Print Agent cho USB | `202609162104.md:1843, 1928-1953` |

### 0.2 Thanh toán, bàn, phiên bàn
| Phát hiện | Bằng chứng |
|---|---|
| Thanh toán theo từng đơn `POST pos/orders/:id/payment`; nút "Thanh toán" nằm ở từng đơn, "Tổng cần thu" của bàn chỉ để xem | `apps/api/src/pos/pos.controller.ts:45-54`, `apps/admin/src/pages/Pos.tsx:544-546, 571-574` |
| Không có khái niệm phiên bàn/hóa đơn; `Order.tableId` là liên kết duy nhất. Bàn "đang dùng" suy ra từ có đơn mở | `schema.prisma:269-302`, `orders.service.ts:167-182` |
| Đợt dev backend 03 đã sửa: bàn chỉ sang `NEED_CLEAN` khi hết đơn mở; thanh toán đồng thời an toàn; giảm giá không vượt tạm tính; VAT sau giảm giá | `docs/review/03-dev-backend-report.md` mục B4 |
| `Payment.orderId` bắt buộc; không có `billId`; giảm giá và VAT lưu trên `Order`, không có mô hình giảm giá riêng | `schema.prisma:345-362`, `orders.service.ts:1039-1066` |
| Không có API đổi bàn/gộp bàn; chuyển trạng thái bàn chỉ qua ma trận cho phép `TABLE_TRANSITIONS` | `apps/api/src/tables/tables.service.ts:23-29, 241-290`; PM report V-03 |
| Mini app: mỗi lần gửi đơn tạo một Order riêng (đúng khuyến nghị BRD 8.3), theo dõi theo `orderId`, lưu lịch sử trong `localStorage`; khách không có khái niệm "bàn của tôi" nào ngoài `?table=` trên URL | `apps/miniapp/src/pages/Cart.tsx:85-126`, `apps/miniapp/src/session.ts:1-68`, `apps/miniapp/src/useOrder.ts` |
| Màn giỏ hàng nói "nhờ nhân viên chuyển bàn" nhưng chưa có tính năng đó | `apps/miniapp/src/pages/Cart.tsx:128-132` |
| BRD 8.4 "Lấy tổng tiền của các order chưa thanh toán", 8.8 đổi/gộp bàn, FR-TBL-06/07 (P1), Scenario 4 "2 khách cùng bàn gọi 2 order, thanh toán gộp, tổng tiền đúng" | `202609162104.md:469-500, 587-606, 671-672, 2293-2300` |

---

# PHẦN A. IN PHIẾU THẬT (PRINT AGENT)

## A1. Mục tiêu và giá trị
Cho quán: phiếu bếp/bar ra đúng máy, đúng món, đúng tiếng Việt có dấu, không rớt phiếu im lặng; có cảnh báo khi hỏng; in lại được; mở két khi thu tiền mặt.
Cho khách: món ra đúng bàn, đúng yêu cầu (giảm sai món).
Số đo thành công (đề xuất):
- Tỷ lệ job in thành công trong 10 giây >= 98% (khớp KPI BRD "in thành công > 98%" mà PM report V-07 nói chưa đo được); đo bằng `PRINTED / tổng job` theo ngày.
- 100% job lỗi sinh cảnh báo hiển thị trên POS/KDS trong <= 5 giây (đo bằng test tự động).
- 0 phiếu bếp bị mất mà không có dấu vết (mọi job có trạng thái cuối `PRINTED`, `FAILED` hoặc `CANCELLED`).
- Phiếu có dấu tiếng Việt đúng 100% ký tự trong bộ mẫu kiểm thử (mẫu ở A8).
- Thời gian từ lúc gửi đơn đến lúc phiếu ra (p95) <= 8 giây trên mạng LAN quán bình thường (GĐ-A1: đo khi pilot, phụ thuộc máy in).

## A2. Phạm vi
Gồm:
1. Print Agent: chương trình nhỏ chạy trên máy tính tại quầy, chủ động gọi lên server lấy job (poll dài), gửi ESC/POS tới máy in qua LAN TCP cổng 9100 (hỗ trợ chính), báo kết quả ngược lại. Lý do chọn poll từ quán lên: server đám mây không thể kết nối máy in trong mạng nội bộ và BRD cấm mở máy in ra internet (`202609162104.md:1843`).
2. Mô hình job thật: `PENDING -> SENT -> PRINTED | FAILED`, retry có giới hạn, khóa thuê, chống in trùng, hủy job.
3. Định tuyến theo khu: Bếp / Bar / Không in, theo danh mục và ghi đè theo món; nhiều máy mỗi khu, có dự phòng.
4. Mẫu phiếu mới có dấu tiếng Việt: phiếu bếp/bar, phiếu hủy món, phiếu đổi bàn, tạm tính, bill, bill từng người (chia bill), phiếu thử.
5. Khổ 58/80 mm; cắt giấy; mở két tiền.
6. Cảnh báo realtime khi lỗi/máy in offline; in lại; màn quản trị job.
7. Chế độ KDS-only cho quán không có máy in.

Không gồm (ghi nhận để làm sau):
- Máy in USB trực tiếp từ agent trên Windows (phức tạp về trình điều khiển, xem GĐ-A3). Phương án v1 cho máy chỉ có USB: chia sẻ máy in qua Windows và gửi RAW qua hàng đợi in của Windows (làm ở giai đoạn 2 của phần A, M-L), hoặc đề nghị quán dùng máy in có LAN.
- Bluetooth từ Android (BRD P2), WiFi trực tiếp từ server.
- Hóa đơn điện tử, in logo ảnh (có thể thêm sau nhờ raster).
- Ứng dụng agent cho macOS/Linux/Android (Windows trước; Node chạy được nơi khác nhưng chưa kiểm thử).

## A3. Luồng người dùng
**Chủ quán/Quản lý (thiết lập, một lần)**
1. Admin > Máy in & hàng đợi > "Thêm Print Agent": đặt tên (ví dụ "PC quầy"), hệ thống hiển thị token một lần và hướng dẫn cài.
2. Cài agent trên PC quầy (giải nén, dán token và địa chỉ server vào tệp cấu hình, chạy như dịch vụ Windows). Agent hiện "Đã kết nối" trên màn Admin trong <= 30 giây.
3. Thêm máy in: tên, khu (Bếp/Bar/Quầy thu ngân), kết nối LAN (IP, cổng 9100), khổ giấy 58/80, kiểu in chữ (Ảnh raster - khuyến nghị / Bảng mã Windows-1258 / Không dấu), có két tiền hay không, gán vào agent. Bấm "In thử": phiếu thử có đủ chữ có dấu mẫu; chủ quán xác nhận "Chữ hiển thị đúng", ghi vào cấu hình.
4. Menu > Danh mục: chọn "In tại" (Bếp / Bar / Không in); ghi đè từng món khi cần (ví dụ nước đóng chai: Không in).

**Khách / Phục vụ / Thu ngân (vận hành)**
5. Khách gửi đơn: hệ thống tách món theo khu, tạo job mỗi khu. Agent in trong vài giây. Phiếu ghi "ĐỢT 2" nếu bàn đã có đơn trước (gọi thêm).
6. Phiếu lỗi: POS/KDS hiện cảnh báo đỏ "Chưa in được phiếu bếp - Bàn B05 - Máy in Bếp offline", có nút "In lại" và "Đã báo bếp bằng miệng" (xác nhận người xử lý).
7. Thu ngân bấm "Tạm tính": in bill tạm; bấm thanh toán: in bill, nếu có tiền mặt thì mở két.
8. Hủy món: phiếu hủy in tới đúng khu của món.
9. Đổi bàn: phiếu "ĐỔI BÀN" in tới các khu có món chưa ra (Phần C).

**Quán không có máy in (KDS-only)**
10. Chủ quán bật "Chỉ dùng màn hình bếp" (Admin > Máy in): hệ thống không tạo job in, không báo lỗi in; KDS hiện đơn có tiếng chuông, và có cảnh báo "Không có màn hình bếp nào đang mở" nếu đơn chờ quá 60 giây mà chưa có KDS nào kết nối (xem A6).

## A4. Thay đổi mô hình dữ liệu (Prisma đề xuất)

Nguyên tắc: chỉ thêm, nullable/có default. Viết SQL tay giống bản migration `20261112150000_...`.

```prisma
enum TicketStation { KITCHEN BAR NONE }          // khu in của món
enum PrinterEncoding { RASTER CP1258 ASCII }
enum PrintTransport { AGENT DIRECT_LAN }         // cách job tới máy in

// PrintJobType: thêm PRE_BILL, TABLE_MOVE, DRAWER
// PrintJobStatus: giữ PENDING, SENT, PRINTED, FAILED, CANCELLED (không đổi tên)

model PrintAgent {
  id         String   @id @default(uuid(7)) @db.Uuid
  storeId    String   @db.Uuid
  name       String
  tokenHash  String   @unique        // SHA-256 của token; token chỉ hiện 1 lần
  version    String?
  lastSeenAt DateTime?
  revokedAt  DateTime?
  createdAt  DateTime @default(now())
  store      Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  printers   Printer[]
  jobs       PrintJob[]
  @@index([storeId])
  @@map("print_agents")
}

// Printer: thêm cột
//   agentId String? @db.Uuid  (FK PrintAgent, onDelete SetNull)
//   encoding PrinterEncoding @default(RASTER)
//   codePage Int?            // số bảng mã ESC t cho CP1258, tùy model máy (GĐ-A2)
//   openDrawer Boolean @default(false)
//   enabled Boolean @default(true)
//   priority Int @default(0)            // nhỏ hơn = ưu tiên hơn trong cùng khu
//   statusDetail String?                // PAPER_OUT | COVER_OPEN | UNREACHABLE | ...
//   lastError String?
// PrintJob: thêm cột
//   payload Json?                       // tài liệu cấu trúc (A5.3); `content` cũ giữ làm bản văn bản xem trước
//   dedupeKey String?                   // chống tạo trùng job: @@unique([storeId, dedupeKey])
//   agentId String? @db.Uuid
//   maxAttempts Int @default(3)
//   nextAttemptAt DateTime?             // lịch thử lại
//   leaseUntil DateTime?                // hết hạn khóa thuê khi agent đã nhận
//   lastError String?
//   copies Int @default(1)
//   batchId String?                     // nhóm các job của cùng 1 lần gửi đơn
//   billId String? @db.Uuid             // Phần B
// MenuCategory: thêm station TicketStation @default(KITCHEN)
// MenuItem:     thêm printStation TicketStation?  // null = theo danh mục
```
Cài đặt quán `Store.settings.printing` (giá trị hợp lệ kiểm trong DTO):
`{ "mode": "AGENT" | "KDS_ONLY" | "DIRECT_LAN", "ticketCopies": 1, "autoPrintBill": true, "showPrice": false, "footerText": "..." }`.

Migration an toàn:
- Cột mới có default; `MenuCategory.station` mặc định `KITCHEN` (hành vi như hiện nay).
- Máy in hiện có giữ nguyên, `agentId = null`; trong chế độ `AGENT` máy in không có agent bị coi là "Chưa gán agent" (không tạo job thành công giả).
- Job cũ giữ nguyên. Không xóa dữ liệu.
- Thêm giá trị enum bằng `ALTER TYPE ... ADD VALUE` (không chạy được trong cùng transaction với việc dùng giá trị mới; tách migration nếu cần).

## A5. API và hành vi

### A5.1 Thay `PrintService.enqueue` bằng quy trình thật
`PrintService` giữ vai trò dựng tài liệu và đưa vào hàng đợi; không tự coi là xong.
1. `PrintRoutingService.planTicket(order)`: nhóm món chưa hủy theo `item.printStation ?? category.station`, bỏ `NONE`; mỗi khu tạo một job (`dedupeKey = ticket:{orderId}:{station}`); chọn máy in `enabled`, status khác `ERROR`, theo `priority`; không có máy phù hợp: tạo job `FAILED` với `lastError = "Chưa cấu hình máy in cho khu Bar"` và phát cảnh báo (không còn nuốt lỗi như `orders.service.ts:253`).
2. Chế độ `KDS_ONLY`: không tạo job.
3. Chế độ `DIRECT_LAN` (tùy chọn, chỉ khi server cùng mạng LAN với máy in, ví dụ triển khai tại chỗ): `DirectTcpTransport` mở socket tới `host:port`, ghi byte, timeout 3 giây. Bắt buộc bật bằng biến môi trường `PRINT_DIRECT_LAN=true` và chỉ chấp nhận địa chỉ IP riêng (10.x, 172.16-31.x, 192.168.x), để máy chủ đám mây không bị lợi dụng quét mạng nội bộ (SSRF). Mặc định tắt.
4. Mọi lỗi tạo job được ghi log và phát `print.failed`.

### A5.2 Trạng thái job
- `PENDING`: chờ agent (hoặc chờ `nextAttemptAt`).
- `SENT`: agent đã nhận (thuê, `leaseUntil = now + 60s`) và đang gửi tới máy in.
- `PRINTED`: agent báo đã ghi xong dữ liệu cho máy in và (nếu máy hỗ trợ truy vấn trạng thái thời gian thực) máy in không báo lỗi giấy/nắp. Nhãn UI: "Đã gửi tới máy in". Lưu ý trung thực: giao thức ESC/POS qua TCP không xác nhận phiếu đã ra giấy; chỉ nhận biết được qua lệnh truy vấn trạng thái ở máy hỗ trợ (GĐ-A4). Tài liệu số đo KPI cần nêu "đã gửi và máy in không báo lỗi".
- `FAILED`: hết số lần thử (mặc định 3, thử lại sau 5s, 15s, 45s) hoặc lỗi không thể thử lại (không cấu hình máy in).
- `CANCELLED`: quản lý hủy, hoặc đơn bị hủy trước khi in.
Quá hạn thuê (agent sập giữa chừng): bộ quét trả job về `PENDING`, tăng `attemptCount`. Cơ chế này là "ít nhất một lần"; để giảm phiếu in đôi, agent lưu cục bộ danh sách job đã in (vài trăm gần nhất) và bỏ qua job đã in rồi, gửi lại kết quả.

### A5.3 Tài liệu in (`payload`)
Server dựng nội dung có cấu trúc (có dấu đầy đủ), agent chịu trách nhiệm chuyển sang ESC/POS theo cấu hình máy in:
```json
{ "v": 1,
  "blocks": [
    {"t":"text","s":"BÀN B05","align":"center","size":"big","bold":true},
    {"t":"kv","l":"Đơn #1042 · ĐỢT 2","r":"19:42"},
    {"t":"sep","c":"-"},
    {"t":"text","s":"2 × Lẩu Thái hải sản","size":"tall","bold":true},
    {"t":"text","s":"   Cay: Vừa · [ít hành]"},
    {"t":"qr","d":"https://..."},
    {"t":"feed","n":3}, {"t":"cut"}, {"t":"drawer"}
  ] }
```
Độ rộng: server không cắt dòng; agent tự cắt theo `paperSize` (58 mm ~ 32 ký tự, 80 mm ~ 48 ký tự ở font mặc định; số dòng/độ rộng điểm ảnh khác nhau theo model, GĐ-A5, quy ước ban đầu raster 384 điểm cho 58 mm và 576 điểm cho 80 mm, kiểm tra bằng phiếu thử). Trường `Printer.charsPerLine` hiện mặc định 42 (`schema.prisma:400`) không khớp mặc định 32/48; đổi mặc định theo khổ giấy trong DTO.

Mẫu phiếu (theo BRD 15) cần có:
- Phiếu bếp/bar: dòng đầu cỡ lớn "BÀN B05" (khu vực nếu có), số đơn, giờ, nguồn (QR/POS), "ĐỢT n" (n = thứ tự đơn trong phiên bàn, Phần B), danh sách món cỡ lớn, tùy chọn/ghi chú từng món, ghi chú chung của đơn, tên nhân viên nếu đơn từ POS; không in giá mặc định (cờ `showPrice`).
- Phiếu hủy món: chữ "HỦY MÓN" lớn, món, số lượng, lý do, người hủy, đến đúng khu của món (khác `print.service.ts:143-152`).
- Phiếu đổi bàn: "ĐỔI BÀN B02 -> B05", các đơn, món chưa ra (Phần C).
- Tạm tính (`PRE_BILL`), bill (`BILL`), bill từng người, phiếu thử (`TEST`), in lại (`REPRINT`, nhãn "IN LẠI" và số lần in lại).
- Bill gộp bàn: tiêu đề quán, địa chỉ/điện thoại (từ `Store`), số hóa đơn, bàn (và bàn gộp), giờ vào/ra, danh sách món gộp theo (tên + tùy chọn + đơn giá), giảm giá từng dòng (loại, mã voucher nếu có), VAT, làm tròn, tổng, các lần thanh toán (phương thức, tiền khách đưa, tiền thối), dòng `footerText`, mã QR tra cứu (tùy chọn).

Bảng mã tiếng Việt (ba lựa chọn, `Printer.encoding`):
- `RASTER` (khuyến nghị, mặc định): agent vẽ chữ thành ảnh đơn sắc rồi gửi lệnh in ảnh raster (`GS v 0`). Chữ có dấu đúng trên mọi máy hỗ trợ raster, không phụ thuộc bảng mã. Đổi lại chậm hơn và to hơn; phiếu bếp ngắn nên chấp nhận được (đo ở pilot). Cần phông có đủ dấu tiếng Việt, đóng gói kèm agent (phông giấy phép mở, ví dụ họ phông OFL; PO/dev chọn). Thư viện vẽ chữ: dùng `sharp` (SVG -> bitmap) hoặc canvas cho Node; GĐ-A6: kiểm tra hiệu năng/độ chính xác trên máy quầy cấu hình thấp.
- `CP1258`: gửi lệnh chọn bảng mã (`ESC t n`) với `n` do model quy định (`Printer.codePage`) rồi mã hóa Windows-1258. GĐ-A2: nhiều máy nhiệt rẻ không có bảng mã tiếng Việt hoặc đánh số khác nhau; dùng "In thử" để người dùng kiểm tra.
- `ASCII`: bỏ dấu (giống hiện tại), dự phòng cuối cùng.

### A5.4 API cho Agent (xác thực bằng token agent, không dùng JWT nhân viên)
Mọi endpoint ở `/api/v1/agent/*`; `@Public()` nhưng đi qua `PrintAgentGuard` kiểm `Authorization: Bearer <token>` so với `tokenHash`, chưa bị `revokedAt`; từ chối trả 401 "Token máy in không hợp lệ".
| Endpoint | Mô tả |
|---|---|
| `POST /agent/heartbeat` | Body `{version, printers:[{printerId, reachable, status?: 'OK'|'PAPER_OUT'|'COVER_OPEN'|'ERROR', detail?}]}`. Server cập nhật `PrintAgent.lastSeenAt`, `Printer.status`/`lastSeenAt`/`statusDetail`. Trả `{printers:[{id, host, port, paperSize, encoding, codePage, openDrawer, cutAtEnd}], serverTime}` để agent không cần sửa cấu hình cục bộ. Chu kỳ 15 giây |
| `GET /agent/jobs/next?wait=20&max=5` | Poll dài. Nhận tối đa `max` job `PENDING` đến hạn của các máy in thuộc agent, theo thứ tự `createdAt`, bằng `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING` đặt `SENT`, `leaseUntil`, `agentId`, tăng `attemptCount`. Không có job: giữ kết nối tối đa `wait` giây rồi trả mảng rỗng |
| `POST /agent/jobs/:id/result` | Body `{ok, error?, printerStatus?, durationMs?}`. `ok`: `PRINTED`, `printedAt`. Lỗi: nếu `attemptCount < maxAttempts` thì `PENDING` với `nextAttemptAt` theo lùi dần; ngược lại `FAILED` và phát `print.failed`. Idempotent theo job |
Job của agent bị thu hồi (`revokedAt`) trả về `PENDING` cho agent khác cùng khu nếu có.

### A5.5 API cho nhân viên/Admin
| Endpoint | Vai trò | Mô tả |
|---|---|---|
| `POST /stores/:storeId/print-agents` | OWNER, MANAGER | Tạo agent, trả token một lần |
| `GET /stores/:storeId/print-agents`, `DELETE .../:id` | OWNER, MANAGER | Danh sách (trạng thái trực tuyến = `lastSeenAt` < 45 giây), thu hồi |
| `PATCH /stores/:storeId/printers/:id` (đã có) | OWNER, MANAGER | Thêm `agentId, encoding, codePage, openDrawer, enabled, priority` |
| `GET /stores/:storeId/print-jobs?status=&printerId=&orderId=` (đã có, `printers.controller.ts:67-70`) | Mọi nhân viên của quán (chỉ đọc) | Thêm lọc, phân trang, hiển thị `attemptCount/maxAttempts`, `lastError` |
| `POST /stores/:storeId/print-jobs/:id/retry` | CASHIER, MANAGER, OWNER | Đặt lại `PENDING`, `attemptCount` không reset để dễ kiểm tra; ghi audit `in_lai` |
| `POST /stores/:storeId/print-jobs/:id/cancel` | MANAGER, OWNER | Hủy job chưa in |
| `POST /stores/:storeId/print-jobs/:id/acknowledge` | Mọi nhân viên | "Đã báo bếp bằng miệng": tắt cảnh báo, ghi người xác nhận |
| `POST /stores/:storeId/printers/:id/open-drawer` | CASHIER, MANAGER, OWNER | Tạo job `DRAWER`, ghi audit `mo_ket` (chống thất thoát) |
| `POST /stores/:storeId/orders/:id/reprint` (đã có `orders.controller.ts:145`) | CASHIER+ | Giữ; chuyển sang đường mới; thêm `kind: 'kitchen'|'bar'|'bill'` và lý do |
| `POST /stores/:storeId/pos/bills/:billId/print` | CASHIER+ | `{kind: 'PRE_BILL'|'BILL', paymentId?}` (Phần B) |
| `GET /stores/:storeId/printing/health` | Mọi nhân viên | `{mode, agents:[...], printers:[{id, name, station, status, detail}], pendingJobs, failedJobs}` cho banner |

Lỗi tiếng Việt: "Máy in Bếp đang offline", "Chưa gán Print Agent cho máy in này", "Không còn máy in nào cho khu Bar", "Job đã in, không thể hủy".

### A5.6 Realtime
Thêm sự kiện SSE (xem mở rộng `EventsService` ở Đặc tả 01 mục 5.7): `print.failed {jobId, jobType, station, printerName, orderNumber, tableCode, reason}`, `print.recovered`, `print.agent_offline {agentName, since}`. Bộ quét mỗi 15 giây: agent không heartbeat > 45 giây thì đánh dấu các máy in của agent `OFFLINE` và phát `print.agent_offline` một lần (không lặp lại mỗi chu kỳ); khi nhận lại heartbeat phát `print.recovered`.

## A6. Thay đổi giao diện (Phần A)
Admin:
- `apps/admin/src/pages/Printers.tsx` (283 dòng): thêm khối "Print Agent" (danh sách, trạng thái xanh/đỏ, thời điểm thấy gần nhất, tạo/thu hồi, hiển thị token một lần); trong `PrinterFormModal` (dòng 26-150) thêm chọn agent, kiểu in chữ, số bảng mã, khổ giấy gợi ý `charsPerLine`, "Có két tiền"; bảng job thêm cột lần thử `attemptCount/maxAttempts`, lỗi, nút "Thử lại"/"Hủy"/"Đã báo miệng"; nút "In thử" trả về kết quả thật; công tắc "Chỉ dùng màn hình bếp (không có máy in)".
- `apps/admin/src/pages/Menu.tsx`: ở danh mục và món thêm chọn "In tại: Bếp / Bar / Không in".
- `apps/admin/src/components/OrderNotifier.tsx` (dòng 45-87): xử lý `print.failed`/`print.agent_offline` bằng toast đỏ không tự tắt (hành động "Xem", "In lại"), âm cảnh báo riêng.
- `apps/admin/src/components/Layout.tsx`: banner cố định phía trên khi có `failedJobs` hoặc agent offline ("Máy in Bếp offline - 3 phiếu chờ"), liên kết tới `/printers`.
- `apps/admin/src/pages/Kitchen.tsx`: tab lọc "Bếp | Bar | Tất cả" theo khu của món (cần API `kitchenOrders` trả `station` của từng món, `orders.service.ts:726-765`); thẻ đơn có chấm "phiếu chưa in" kèm "In lại"; ở chế độ KDS-only hiện huy hiệu "KDS" và cảnh báo khi không có màn hình bếp nào kết nối.
- `apps/admin/src/pages/Pos.tsx`: nút "In tạm tính", "In bill", "Mở két"; sau thanh toán nếu job bill lỗi thì toast "Chưa in được bill - In lại" (dòng 406-413 hiện chỉ gọi `reprint`).
- `apps/admin/src/labels.ts`: thêm nhãn trạng thái job ("Chờ in", "Đang gửi", "Đã gửi tới máy in", "Lỗi", "Đã hủy") và loại job mới.
Mini app: không đổi.

Chương trình agent (hạng mục mới, thư mục `apps/print-agent`, workspace npm mới):
- Node.js >= 22 (cùng phiên bản của monorepo), TypeScript, không phụ thuộc nặng; mô-đun: `config` (tệp JSON: `serverUrl`, `token`), `poller` (poll dài + lùi dần khi lỗi mạng), `escpos` (bộ mã hóa lệnh: khởi tạo `ESC @`, căn lề `ESC a`, đậm `ESC E`, cỡ chữ `GS !`, cắt `GS V`, xung két `ESC p`, in ảnh `GS v 0`, truy vấn trạng thái `DLE EOT`), `render` (raster), `transport/lan` (TCP 9100, timeout 3 giây, đóng kết nối mỗi lần), `state` (danh sách job đã in cục bộ), `log` (xoay tệp), `service` (chạy nền).
- Đóng gói cho Windows như dịch vụ chạy nền, tự khởi động cùng máy, tự cập nhật hoặc ít nhất kiểm tra phiên bản từ heartbeat (cách đóng gói cụ thể do dev đề xuất, ví dụ đóng gói với trình bao dịch vụ Windows hoặc tệp thực thi đơn; PO duyệt phương án, xem câu hỏi A-Q3).
- Bảo mật: token chỉ lưu trong tệp cấu hình quyền hạn chế; chỉ gọi HTTPS tới server; không mở cổng lắng nghe nào; chỉ kết nối tới IP:cổng do server trả cho máy in của chính agent đó và chỉ nhận IP riêng.

## A7. Trường hợp biên và bảo mật (Phần A)
- Mất mạng internet nhưng LAN còn: job nằm `PENDING`; khi có lại mạng agent in bù theo thứ tự. Để quán không "mù" lúc mất mạng, mini app/POS cũng không gửi được đơn vì phụ thuộc server; BRD FR-PRN-13 (hàng đợi in ngoại tuyến) vẫn là P2.
- Phiếu cũ in lúc có lại mạng: job quá cũ (ví dụ > 15 phút, cấu hình) không in tự động mà chuyển `FAILED` "Quá hạn" và cảnh báo (tránh in hàng loạt phiếu cũ làm bếp nhầm).
- Hai agent cùng khu: mỗi máy in thuộc đúng một agent; claim bằng `SKIP LOCKED`.
- Máy in hết giấy/nắp mở: nếu truy vấn trạng thái hỗ trợ thì `statusDetail` và cảnh báo; nếu không thì thất bại sẽ không phát hiện được (ghi trong GĐ-A4).
- In trùng do mất kết quả: giảm bằng `dedupeKey` ở phía server và danh sách job đã in ở agent, nhưng không loại trừ hoàn toàn; phiếu in đôi chấp nhận được hơn mất phiếu.
- Đơn bị hủy trước khi in: job `PENDING` của đơn chuyển `CANCELLED`.
- Lộ token agent: thu hồi trong Admin, tạo token mới; token băm SHA-256 trong DB.
- Không có dữ liệu cá nhân của khách trên phiếu bếp (chỉ ghi chú món).
- Chống in bừa: giới hạn số `retry`/`reprint` mỗi phút/nhân viên; mọi in lại và mở két đều audit (`apps/api/src/common/audit.service.ts`).
- Đồng bộ giờ: `Printer.lastSeenAt`/`PrintAgent.lastSeenAt` dùng giờ server, không dùng giờ máy quầy.

## A8. Tiêu chí nghiệm thu (Phần A)
1. Cho máy in LAN thật khổ 80 mm gán agent, khi bấm "In thử", thì phiếu ra trong <= 8 giây và dòng mẫu "Hồ sơ: Nguyễn Thị Hương, Cà phê sữa đá, Bánh mì thịt nướng, Lẩu thái hải sản, ĐỔI BÀN" hiển thị đúng 100% dấu ở chế độ `RASTER`; job `PRINTED`.
2. Cho khách gửi đơn có 1 món bếp và 1 món bar (danh mục Đồ uống đặt "In tại: Bar"), khi gửi, thì có 2 job riêng, mỗi phiếu chỉ chứa món của khu mình, ra đúng máy.
3. Cho máy in Bếp tắt nguồn, khi gửi đơn, thì sau 3 lần thử (5s, 15s, 45s) job `FAILED`, và trong <= 5 giây từ lần thất bại cuối POS/KDS hiện cảnh báo đỏ kèm bàn/đơn; bấm "In lại" sau khi bật máy thì phiếu ra.
4. Cho agent bị tắt, khi quá 45 giây, thì các máy in của agent chuyển `OFFLINE`, banner hiện trên Admin; khi bật lại thì tự `ONLINE` và job `PENDING` được in bù.
5. Cho cùng một job được agent nhận hai lần do lỗi mạng (mô phỏng), khi gửi kết quả hai lần, thì trạng thái job nhất quán và agent không in lần hai cùng job nếu đã có trong danh sách cục bộ.
6. Cho quán `KDS_ONLY`, khi gửi đơn, thì không có job in nào, không có cảnh báo lỗi in, KDS hiện đơn kèm chuông; nếu đơn chờ > 60 giây mà không có KDS nào mở thì hiện cảnh báo trên POS.
7. Cho thanh toán có phần tiền mặt và máy in quầy bật `openDrawer`, khi hoàn tất, thì bill in và két mở; thanh toán chỉ chuyển khoản thì không mở két; nút "Mở két" thủ công ghi audit.
8. Cho hủy một món bar, khi hủy, thì phiếu hủy in ở máy Bar, không in ở máy Bếp.
9. Cho khổ 58 mm, khi in bill dài tên món, thì không bị cắt chữ giữa dấu, xuống dòng đúng, đủ cột giá.
10. Cho nhân viên quán A, khi gọi retry/cancel job của quán B, thì 403; token agent quán A không lấy được job quán B.
11. Cho job quá 15 phút chưa in, khi agent kết nối lại, thì không in tự động mà chuyển `FAILED` "Quá hạn" kèm cảnh báo.
12. Cho `PRINT_DIRECT_LAN` tắt (mặc định), khi cấu hình `mode = DIRECT_LAN`, thì bị từ chối bằng thông báo rõ.

---

# PHẦN B. PHIÊN BÀN VÀ HÓA ĐƠN BÀN (THANH TOÁN GỘP, CHIA BILL, GIẢM GIÁ CẤP BÀN)

## B1. Mục tiêu và giá trị
Cho quán: một bàn ăn nhiều đợt gọi thêm chỉ thanh toán và in bill một lần; chia bill khi khách muốn; giảm giá một lần cho cả bàn; bàn trả đúng trạng thái; đối soát doanh thu đơn giản.
Cho khách: một hóa đơn rõ ràng cho cả bàn; không nhận 3 bill cho 3 đợt gọi.
Số đo thành công:
- 100% bàn nhiều đơn thanh toán bằng đúng một lượt thao tác "Thanh toán bàn" (đếm số bàn bị thanh toán bằng nhiều lần thanh toán đơn lẻ = 0 sau khi tắt luồng cũ).
- Thời gian thao tác thu ngân cho bàn 3 đơn giảm >= 60% so với hiện tại (đo 20 lượt).
- Scenario 4 của BRD (2 khách cùng bàn gọi 2 order, thanh toán gộp, tổng tiền đúng) đạt (BRD `202609162104.md:2293-2300`).
- Sai lệch tổng tiền bill so với tổng món - giảm giá + VAT = 0 đồng trên 100% bill kiểm tra tự động (bao gồm làm tròn).
- 0 bàn kẹt `OCCUPIED` sau khi bill đã đóng (kiểm bằng truy vấn đêm).

## B2. Phạm vi
Gồm: `TableSession`, `Bill`, `BillDiscount`, thanh toán nhiều lần cho một bill (đủ, chia đều, chia theo món), giảm giá cấp bàn kèm giới hạn theo vai trò, hoàn tiền ở mức bill, in bill gộp/tạm tính, đồng bộ trạng thái bàn, tương thích đơn cũ.
Không gồm (đề xuất sau): tách bàn (FR-TBL-08, P2), hoàn tiền từng món/từng phần theo đơn lẻ trong bill (v1 hoàn cả bill hoặc ghi nhận hoàn một phần theo số tiền có lý do), khách tự chia bill trong mini app (v1 do thu ngân thao tác), phí dịch vụ/tip (có thể thêm dòng phí vào bill sau), tích hợp hóa đơn điện tử.

## B3. Khái niệm
- Phiên bàn (`TableSession`): khoảng thời gian một nhóm khách sử dụng một hoặc nhiều bàn. Mở khi đơn đầu tiên được tạo (hoặc nhân viên "Mở bàn"), đóng khi bill thanh toán đủ hoặc khi hết đơn mở (hủy hết). Mọi đơn/đợt gọi thêm của nhóm này thuộc cùng phiên.
- Hóa đơn bàn (`Bill`): một-một với phiên; tổng hợp tất cả món chưa hủy của mọi đơn trong phiên, các khoản giảm giá, VAT, làm tròn, và các lần thanh toán.
- Đơn (`Order`) vẫn là đơn vị gửi bếp. `Order.tableId` giữ nghĩa "bàn vật lý cần mang món đến" (khác với bàn thanh toán).

## B4. Luồng người dùng (Phần B, theo vai trò)
**Thu ngân**
1. POS: chọn bàn thấy "Hóa đơn bàn": các đợt (đơn #1040 19:10, #1042 19:42 "Đợt 2"), món theo đợt, tạm tính, giảm giá, VAT, tổng cần thu. Một nút duy nhất "Thanh toán bàn" (thay các nút "Thanh toán" từng đơn).
2. "In tạm tính" để khách xem trước.
3. Giảm giá cấp bàn: "Thêm giảm giá": loại (số tiền/phần trăm), giá trị, lý do (bắt buộc). Vượt hạn mức vai trò: yêu cầu quản lý duyệt tại chỗ (nhập mật khẩu/PIN của quản lý, Q3).
4. "Thanh toán bàn": chọn Toàn bộ, Chia đều N người, hoặc Chia theo món (gán món/số lượng cho từng người). Mỗi lượt thanh toán: phương thức (tiền mặt, chuyển khoản, QR), số tiền, tiền khách đưa. Hệ thống hiển thị "Đã thu / Còn lại". Khi còn lại bằng 0: bill `PAID`, mọi đơn `COMPLETED`, bill in, bàn sang "Cần dọn".
5. Nếu bàn còn món chưa ra (PENDING/PREPARING), cảnh báo "Còn 2 món chưa ra, vẫn thanh toán?" và yêu cầu xác nhận.
**Phục vụ**: thấy bill ở chế độ chỉ xem, "In tạm tính" (cấu hình), không thanh toán, không giảm giá.
**Quản lý/Chủ quán**: duyệt giảm giá vượt hạn mức, hoàn tiền bill, xem lịch sử bill.
**Khách (mini app)**: xem "Hóa đơn của bàn" (tất cả đợt, tổng, giảm giá), gửi yêu cầu "Gọi thanh toán" (đã có `reason: BILL` ở `TableCallRequest`), thanh toán QR (Đặc tả 01).

## B5. Thay đổi mô hình dữ liệu (Prisma đề xuất)

```prisma
enum TableSessionStatus { OPEN CLOSED CANCELLED }
enum BillStatus { OPEN PARTIALLY_PAID PAID VOID REFUNDED }
enum DiscountKind { MANUAL VOUCHER POINTS }

model TableSession {
  id               String   @id @default(uuid(7)) @db.Uuid
  storeId          String   @db.Uuid
  primaryTableId   String   @db.Uuid         // bàn thanh toán/chủ phiên hiện tại
  status           TableSessionStatus @default(OPEN)
  publicToken      String   @unique           // 128 bit ngẫu nhiên (hex 32), khách dùng để nhận diện phiên
  openedAt         DateTime @default(now())
  closedAt         DateTime?
  openedByUserId   String?  @db.Uuid
  openedVia        String   @default("QR")    // QR | POS
  guestCount       Int?
  mergedIntoId     String?  @db.Uuid          // phiên đã bị gộp vào phiên khác
  note             String?

  store   Store              @relation(fields: [storeId], references: [id], onDelete: Restrict)
  tables  TableSessionTable[]
  orders  Order[]
  bill    Bill?

  @@index([storeId, status])
  @@index([primaryTableId, status])
  @@map("table_sessions")
}

model TableSessionTable {         // các bàn vật lý thuộc phiên (gộp bàn), và lịch sử đổi bàn
  id        String   @id @default(uuid(7)) @db.Uuid
  sessionId String   @db.Uuid
  tableId   String   @db.Uuid
  role      String   @default("PRIMARY")   // PRIMARY | MERGED | MOVED_FROM
  joinedAt  DateTime @default(now())
  leftAt    DateTime?
  session   TableSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@index([sessionId])
  @@index([tableId, leftAt])
  @@map("table_session_tables")
}

model Bill {
  id              String   @id @default(uuid(7)) @db.Uuid
  storeId         String   @db.Uuid
  sessionId       String   @unique @db.Uuid
  billNo          String                       // số hóa đơn hiển thị, cấp bằng Store.billSeq
  status          BillStatus @default(OPEN)
  subtotal        Decimal  @default(0) @db.Decimal(14, 2)
  discountAmount  Decimal  @default(0) @db.Decimal(14, 2)
  vatAmount       Decimal  @default(0) @db.Decimal(14, 2)
  totalAmount     Decimal  @default(0) @db.Decimal(14, 2)
  paidAmount      Decimal  @default(0) @db.Decimal(14, 2)
  version         Int      @default(1)          // tăng mỗi lần tổng đổi (để báo mã QR/đối chiếu cũ)
  customerId      String?  @db.Uuid             // khách gắn vào bill (Đặc tả 03)
  closedByUserId  String?  @db.Uuid
  paidAt          DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  session   TableSession  @relation(fields: [sessionId], references: [id], onDelete: Restrict)
  discounts BillDiscount[]
  payments  Payment[]
  @@unique([storeId, billNo])
  @@index([storeId, status])
  @@map("bills")
}

model BillDiscount {
  id             String   @id @default(uuid(7)) @db.Uuid
  billId         String   @db.Uuid
  kind           DiscountKind
  amount         Decimal  @db.Decimal(14, 2)     // số tiền đã quy đổi
  percent        Decimal? @db.Decimal(5, 2)
  reason         String?
  voucherRedemptionId String? @db.Uuid           // Đặc tả 03
  pointsUsed     Int?                            // Đặc tả 03
  createdByUserId String? @db.Uuid
  approvedByUserId String? @db.Uuid
  createdAt      DateTime @default(now())
  bill Bill @relation(fields: [billId], references: [id], onDelete: Cascade)
  @@index([billId])
  @@map("bill_discounts")
}
```
Thay đổi bảng hiện có (tất cả nullable hoặc có default):
- `Order`: thêm `sessionId String? @db.Uuid` (FK `TableSession`, onDelete Restrict), `billId String? @db.Uuid`; chỉ mục `@@index([sessionId])`.
- `Payment`: `orderId` đổi thành nullable (`String?`); thêm `billId String?`, `allocation Json?` (chi tiết chia bill), `payerLabel String?`, `idempotencyKey String?` với `@@unique([storeId, idempotencyKey])`; cùng các cột của Đặc tả 01 (`intentId`, `bankTransactionId`, `confirmedBy`, `refundOfPaymentId`, `refundStatus`, `refundNote`). Quan hệ `Order.payments` giữ cho đơn cũ.
- `Store`: thêm `billSeq Int @default(0)` (bộ đếm nguyên tử như `orderSeq`, xem `orders.service.ts:431-439`).
- `PrintJob`: `billId` (Phần A).
Cài đặt quán `Store.settings.pos`: `{ "discountLimits": { "cashierMaxPercent": 10, "cashierMaxAmount": 100000 }, "allowWaiterMoveTable": false, "warnUnservedOnPay": true }` (giá trị mặc định chỉ là đề xuất, PO chốt, Q3).

Làm tròn và phân bổ (quy tắc bắt buộc, vì báo cáo hiện cộng `Order.totalAmount` theo đơn COMPLETED, `apps/api/src/reports/reports.service.ts`):
- Tổng bill tính bằng đúng `calcTotals(subtotal, tổng giảm giá, settings)` (`orders.service.ts:84-91`): VAT trên (tạm tính - giảm giá), làm tròn theo cấu hình quán. Hàm này được chuyển ra module dùng chung `common/utils/totals.ts`.
- Khi bill chuyển `PAID`, hệ thống phân bổ `discountAmount`, `vatAmount`, `totalAmount` xuống từng `Order` của phiên theo tỷ lệ tạm tính từng đơn, dùng phương pháp phần dư lớn nhất theo đơn vị đồng để tổng các đơn đúng bằng tổng bill; ghi vào các cột đã có của `Order`. Nhờ đó báo cáo hiện hữu (doanh thu theo đơn, top món) không phải sửa.
- Báo cáo theo phương thức thanh toán dùng `Payment` (mỗi lượt thanh toán một dòng): không đổi cách cộng.

Migration và backfill an toàn (SQL viết tay trong cùng migration):
1. Tạo bảng/enum mới, thêm cột nullable. Đặt `payments.orderId` nullable (an toàn: bỏ ràng buộc NOT NULL).
2. Backfill chỉ cho đơn đang mở: với mỗi bàn có đơn trạng thái mở (PENDING/ACCEPTED/PREPARING/READY) tạo một `table_sessions` (`status OPEN`, `publicToken` sinh bằng `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')` cắt 32 ký tự, `openedAt` = giờ đơn mở sớm nhất), một dòng `table_session_tables (PRIMARY)`, và đặt `orders.sessionId`. Không tạo Bill sẵn (tạo khi cần).
3. Đơn đã đóng (COMPLETED/CANCELLED/REFUNDED): giữ `sessionId = null` (lịch sử). Mọi mã phải chịu được `sessionId = null` ("đơn cũ"): thanh toán/hoàn tiền đường cũ vẫn chạy cho đơn không có phiên.
4. Dữ liệu rác: quán đang có 18 đơn PENDING cũ ở bàn B01 của quán demo (`docs/review/03-dev-backend-report.md` mục 5) sẽ tạo phiên với hóa đơn lớn; trước khi migrate trên môi trường có dữ liệu thật, hủy hoặc đóng các đơn tồn đọng (làm thủ công bởi quản lý quán).
5. `Store.billSeq` khởi tạo 0; `billNo` = "HĐ" + số, hoặc `INV-yyyyMMdd-số` giữ định dạng `receiptNo` hiện nay (`orders.service.ts:1035`); PO chốt định dạng (Q6).
6. Triển khai theo hai bước để an toàn: bước 1 migration + mã tạo phiên khi có đơn mới (đồng thời giữ đường thanh toán cũ); bước 2 bật giao diện thanh toán bàn và dừng nút thanh toán từng đơn.

## B6. API (Phần B)

Tiền tố `/api/v1`, JWT, `assertStoreAccess`. Dịch vụ lõi `BillService` (mới) tái sử dụng `lockTable` và quy tắc `updateMany` có điều kiện của `payOrder` (`orders.service.ts:1037-1053`).

Thay đổi ở tạo đơn: `createOrderTx` (`orders.service.ts:283-468`), sau khi khóa bàn: nếu có phiên `OPEN` có `TableSessionTable` hoạt động tại bàn này thì dùng, nếu không tạo phiên mới; đặt `order.sessionId`; sau khi tạo đơn gọi `BillService.recalc` nếu bill đã tồn tại (tổng đổi, tăng `version`, hủy các `PaymentIntent` PENDING của bill, Đặc tả 01). Hủy món/hủy đơn (`cancelItem`/`cancelOrder`, dòng 828-985) cũng gọi `recalc`; hủy hết đơn của phiên thì `TableSession` thành `CANCELLED` và bàn được giải phóng (thay `releaseTableIfIdle`, dòng 167-182, bằng logic theo phiên).

| Endpoint | Vai trò | Mô tả |
|---|---|---|
| `GET /stores/:storeId/pos/tables/:tableId/session` | CASHIER, MANAGER, OWNER, WAITER (chỉ đọc) | Trả `{session, tables, orders[], bill|null, preview:{subtotal, discountAmount, vatAmount, totalAmount}, unservedItems}`; thay `GET pos/tables/:id/orders` (giữ để tương thích) |
| `POST /stores/:storeId/pos/sessions/:sessionId/bill` | CASHIER+ | Tạo hoặc lấy bill (idempotent). Trả bill |
| `POST /stores/:storeId/pos/bills/:billId/discounts` | CASHIER+ (hạn mức), MANAGER+ (không giới hạn) | Body `{kind:'MANUAL', type:'AMOUNT'|'PERCENT', value, reason, approver?: {userId, password}}`. Lỗi 400 nếu tổng giảm vượt tạm tính: "Giảm giá ({x}) không được vượt quá tạm tính ({y})" (giữ thông điệp hiện có, `orders.service.ts:1020-1024`); 403 "Giảm giá vượt hạn mức, cần quản lý duyệt" |
| `DELETE /stores/:storeId/pos/bills/:billId/discounts/:id` | Người tạo hoặc MANAGER+ | Gỡ giảm giá (chỉ khi bill chưa thanh toán đồng nào) |
| `POST /stores/:storeId/pos/bills/:billId/payments` | CASHIER+ | Body `{method:'CASH'|'TRANSFER'|'QR_BANK'|'CARD', amount?, cashReceived?, payerLabel?, allocation?, idempotencyKey}`. `amount` mặc định = còn lại. Trả `{bill, payment, remaining, change, tablesStatus}`; khi còn lại = 0 đóng bill. Lỗi: 409 "Hóa đơn đã thay đổi, vui lòng tải lại" khi `expectedVersion` (tùy chọn gửi kèm) lệch; 409 "Hóa đơn đã được thanh toán đủ"; 400 "Tiền khách đưa ({x}) chưa đủ" |
| `POST /stores/:storeId/pos/bills/:billId/split/preview` | CASHIER+ | Body `{mode:'EVEN', parts:n}` hoặc `{mode:'ITEMS', groups:[{label, lines:[{orderItemId, quantity}]}]}`. Trả số tiền từng phần (đã phân bổ giảm giá, VAT và làm tròn, phần cuối gánh số dư) để giao diện hiển thị |
| `POST /stores/:storeId/pos/bills/:billId/refund` | MANAGER, OWNER | Hoàn cả bill `{reason, note}`; thay thế `refundOrder` cho đơn có phiên; ghi Payment hoàn theo phương thức gốc (Đặc tả 01 mục 5.5) |
| `POST /stores/:storeId/pos/orders/:id/payment` (đã có) | CASHIER+ | Giữ để tương thích: nếu phiên chỉ có đúng 1 đơn mở thì chuyển thành thanh toán bill đủ; nếu có nhiều đơn: 409 "Bàn có nhiều đơn, vui lòng thanh toán theo bàn". Đơn cũ không có phiên: chạy đường cũ |
| `GET /public/sessions/:token` | Công khai | Phần C |

Hàm `BillService.applyPayment(tx, {billId, amount, method, actor, ...})` là điểm duy nhất tạo Payment cho bill, được dùng bởi POS, xác nhận tay QR và đối soát tự động (Đặc tả 01). Quy trình: khóa bàn của phiên, khóa dòng bill, kiểm `status` còn `OPEN/PARTIALLY_PAID`, kiểm `amount <= remaining`, tạo Payment, cập nhật `paidAmount` có điều kiện; khi `remaining = 0`: bill `PAID`, `updateMany` các đơn của phiên (`status in PAYABLE` sang `COMPLETED`, `paidAt`, phân bổ tiền), phiên `CLOSED`, mọi bàn của phiên `NEED_CLEAN`, tăng `Customer.totalSpent` (và gọi tích điểm, Đặc tả 03), sau commit: in bill (kèm mở két nếu có tiền mặt), audit, sự kiện realtime. Lỗi cuộc đua: `ConflictException` giống `orders.service.ts:1051-1053`.

Phân bổ chia theo món: máy chủ tính lại phần tiền của mỗi nhóm từ `orderItemId`/`quantity` (không tin số tiền client), kiểm tra số lượng đã phân bổ ở các Payment trước không vượt tổng số lượng của món; phần thanh toán cuối cùng thu đúng số còn lại để khử sai số làm tròn.

Hoàn tiền (v1): hoàn cả bill. Hoàn một phần theo số tiền: Payment hoàn có `refundOfPaymentId` và lý do, không đổi trạng thái đơn; ghi nhận trong báo cáo (bổ sung `payments()` trừ hoàn tiền, nội dung PM report V-09 còn dang dở theo `03-dev-backend-report.md` mục B10).

## B7. Thay đổi giao diện (Phần B)
Admin:
- `apps/admin/src/pages/Pos.tsx`: 
  - Panel bill (dòng 497-590): thay danh sách "mỗi đơn một nút Thanh toán" bằng bill gộp: nhóm theo đợt (#đơn, giờ, trạng thái từng đợt), tạm tính, các dòng giảm giá, VAT, tổng; nút "Thanh toán bàn" ở chân panel (hiện thay cho `tableTotal` thuần xem ở dòng 571-574); nút "In tạm tính"; "Giảm giá"; nút phụ "Đổi bàn", "Gộp bàn" ở `bill-head` (dòng 504-514).
  - Thay `PayModal` (dòng 34-137) bằng `CheckoutModal`: ba tab "Toàn bộ / Chia đều / Chia theo món"; danh sách các lượt thanh toán đã nhận; thanh "Đã thu/Còn lại"; chọn phương thức; khu vực QR (Đặc tả 01); khu vực voucher/điểm (Đặc tả 03); xác nhận khi còn món chưa ra.
  - `TableTile` (dòng 324-346): hiển thị huy hiệu "gộp với B02" và tổng bill theo phiên thay `openAmount`.
  - `CreateOrderModal` (dòng 139-322): không đổi cách tạo; đơn mới tự vào phiên của bàn.
- `apps/admin/src/pages/Tables.tsx`: hiển thị phiên đang mở ở chi tiết bàn.
- `apps/admin/src/pages/Orders.tsx`: cột "Hóa đơn" (số bill), liên kết nhóm các đơn cùng phiên; chi tiết đơn hiện các lượt thanh toán của bill (cần `serializeOrder` kèm `bill.payments`, vì `Order.payments` rỗng với đơn mới: `apps/admin/src/types.ts:138-145`, `apps/api/src/common/utils/serialize-order.ts`).
- `apps/admin/src/pages/Reports.tsx`: không đổi công thức doanh thu nhờ phân bổ xuống đơn; thêm thẻ "Số bàn / số đợt gọi thêm" tùy chọn.
Mini app:
- Màn mới `pages/Bill.tsx` ("Hóa đơn của bàn", route `/s/:storeSlug/bill` ở `apps/miniapp/src/components/layout.tsx:34-47`): các đợt gọi món, tổng, giảm giá, trạng thái thanh toán; nút "Gọi thanh toán" (dùng API `callStaff` với `reason: 'BILL'`, `apps/miniapp/src/api.ts:101-106`).
- `pages/Tracking.tsx` (màn hoàn tất dòng 113-180): khi bill đã `PAID`, các đơn cùng phiên cùng hiển thị "Đã thanh toán" (vì cùng lúc `COMPLETED`), tổng hiển thị là tổng đơn đã phân bổ, kèm liên kết "Xem hóa đơn cả bàn".
- `pages/Orders.tsx`: nhóm lịch sử theo phiên (tùy chọn P1).

## B8. Trường hợp biên và bảo mật (Phần B)
- Gọi thêm khi đang thanh toán (bill đã `PARTIALLY_PAID`): đơn mới vào phiên, bill tăng; `remaining` tăng; báo POS "Hóa đơn thay đổi, còn thu {x}". Không chặn khách gọi thêm. Quyết định chặn hay không: Q4.
- Bàn không còn đơn mở nhưng phiên `OPEN` (hủy hết đơn): phiên `CANCELLED`, bàn `AVAILABLE`.
- Khách đặt đơn ở bàn `NEED_CLEAN`/đã `CLOSED` qua QR cũ: tạo phiên mới; đây là rủi ro đơn ma đã nêu ở PM report V-02 (không xử lý trong đặc tả này, nhưng token phiên giảm rủi ro ở Phần C).
- Giảm giá: tổng giảm không vượt tạm tính; giảm giá hủy khi có đơn bị hủy làm tạm tính giảm xuống dưới tổng giảm (tự co lại phần phần trăm, thông báo cho thu ngân với số tiền mới).
- Đồng thời: hai thu ngân bấm thanh toán cùng lúc: khóa bàn + khóa bill, người sau 409; thanh toán trùng do nhấp đúp: `idempotencyKey` trả Payment cũ.
- Tiền mặt: `cashReceived` thiếu thì 400; thối tiền tính theo phần đang thu, không theo tổng bill.
- Làm tròn: phần cuối của chia đều gánh sai số; cấu hình làm tròn quán (`money.ts`) áp trên tổng bill, không áp trên từng phần (tránh lệch 1.000đ nhân số phần).
- Phân quyền: Phục vụ không giảm giá/thanh toán/hoàn tiền; hạn mức giảm giá theo vai trò; mọi giảm giá/hoàn tiền/gỡ giảm giá ghi `AuditLog` (có `beforeData`/`afterData`, `approvedByUserId`).
- Đa quán: mọi truy vấn lọc `storeId`; token phiên công khai chỉ trả dữ liệu cần thiết, không có thông tin nhân viên, không có thông tin khách khác.
- Đơn cũ không phiên: tồn tại song song; hạn chót loại bỏ đường cũ khi hết đơn mở cũ (kiểm bằng truy vấn).
- Hiệu năng: `GET .../session` gộp truy vấn (đơn + món + bill) trong một lần; giữ chỉ mục `(storeId, status)`.

## B9. Tiêu chí nghiệm thu (Phần B)
1. Cho bàn B05 có 2 đơn (#1040 gồm 2 món 100.000đ, #1042 gồm 1 món 50.000đ), khi thu ngân bấm "Thanh toán bàn" bằng tiền mặt đưa 200.000đ, thì có đúng 1 Payment 150.000đ, cả 2 đơn `COMPLETED`, tiền thối 50.000đ, một bill in, bàn `NEED_CLEAN`.
2. Cho cùng bàn, khi gọi API thanh toán đơn lẻ cũ `pos/orders/:id/payment`, thì 409 "Bàn có nhiều đơn, vui lòng thanh toán theo bàn".
3. Cho giảm giá 10% cấp bàn trên 150.000đ và VAT 10% bật, khi thanh toán, thì tổng = làm tròn(135.000 + 13.500) và tổng của các đơn sau phân bổ bằng đúng tổng bill (không lệch 1 đồng), báo cáo doanh thu ngày bằng tổng bill.
4. Cho chia đều 3 người trên bill 100.000đ, khi tính, thì ba phần 33.333 / 33.333 / 33.334 (hoặc theo làm tròn quán) và tổng đúng 100.000; thanh toán lần lượt, bill chỉ `PAID` sau lượt thứ ba, đơn `COMPLETED` chỉ khi đó.
5. Cho chia theo món, khi gán một món 60.000đ qty 1 cho hai người, thì API từ chối (món chỉ gán trọn số lượng; chia món thì dùng chia đều); tổng số lượng phân bổ không vượt số lượng món.
6. Cho thu ngân bấm "Thanh toán" hai lần liên tiếp với cùng `idempotencyKey`, khi gọi, thì chỉ một Payment được tạo.
7. Cho bill đã thu một phần, khi khách gọi thêm 1 món qua QR, thì bill tăng, `remaining` tăng đúng, POS hiện "Hóa đơn thay đổi", và mọi QR intent PENDING (Đặc tả 01) chuyển `SUPERSEDED`.
8. Cho WAITER, khi gọi tạo giảm giá hoặc thanh toán, thì 403; CASHIER giảm 20% (vượt hạn mức 10%) cần quản lý duyệt, nhập sai mật khẩu quản lý thì 403, đúng thì thành công và audit có `approvedByUserId`.
9. Cho tất cả đơn của phiên bị hủy, khi hủy món cuối, thì phiên `CANCELLED` và bàn `AVAILABLE`.
10. Cho dữ liệu trước migration có bàn mở với 3 đơn, khi chạy migration và mở POS, thì bàn hiển thị một phiên với 3 đợt, thanh toán gộp chạy đúng; đơn COMPLETED cũ vẫn xem được, hoàn tiền đường cũ vẫn chạy.
11. Cho hoàn tiền bill thanh toán QR, khi quản lý xác nhận, thì Payment hoàn mang `method` gốc, bill `REFUNDED`, mọi đơn `REFUNDED`, doanh thu ngày giảm đúng số tiền.
12. Cho quán A, khi gọi bill của quán B, thì 403/404 và không thấy dữ liệu.

---

# PHẦN C. ĐỔI BÀN VÀ GỘP BÀN

## C1. Mục tiêu và giá trị
Cho quán: xử lý nhanh khi khách chuyển chỗ hoặc ghép bàn mà không phải hủy/nhập lại đơn, không mất lịch sử, bếp biết món cần mang đến bàn mới, thanh toán một bill.
Cho khách: đơn đang theo dõi vẫn chạy, gọi thêm món sau khi đổi bàn vẫn vào đúng bàn.
Số đo: đổi/gộp bàn hoàn tất <= 3 thao tác và <= 10 giây trên POS; 0 đơn rơi vào bàn sai sau khi đổi trong các ca kiểm thử; 0 phiếu bếp "mồ côi bàn cũ" (có phiếu thông báo đổi bàn cho mọi món chưa ra).

## C2. Phạm vi
Gồm FR-TBL-06 (đổi bàn), FR-TBL-07 (gộp bàn), BRD 8.8: phiên bàn chuyển bàn; gộp hai phiên thành một bill; cập nhật trạng thái bàn; phiếu thông báo đổi bàn; ảnh hưởng mini app; audit.
Không gồm: tách bàn (P2), hoàn tác gộp (xem Q5), đổi bàn sang bàn đang có khách (đó là gộp bàn), đặt chỗ (RESERVED).

## C3. Luồng người dùng
**Đổi bàn (Thu ngân/Quản lý; Phục vụ nếu quán bật `allowWaiterMoveTable`)**
1. POS: chọn bàn B02 đang có khách > "Đổi bàn" > chọn bàn trống B05 (chỉ liệt kê bàn `AVAILABLE`/`CLEANED`) > xác nhận (lý do tùy chọn).
2. Hệ thống: đưa phiên sang B05, đơn của phiên cập nhật bàn vật lý B05, B02 chuyển `NEED_CLEAN`, B05 chuyển `OCCUPIED`, in phiếu "ĐỔI BÀN B02 -> B05" cho các khu có món chưa ra, KDS tự hiển thị bàn mới.
3. Mini app của khách đang mở nhận bàn mới ở lần poll kế (trong <= 3 giây), hiện thông báo.
**Gộp bàn (Thu ngân/Quản lý)**
1. Chọn bàn chính B02 > "Gộp bàn" > chọn bàn B05 (đang có khách) > xác nhận.
2. Hệ thống: các đơn của B05 chuyển vào phiên của B02, hai bàn vẫn `OCCUPIED` (khách vẫn ngồi hai bàn), POS hiện B05 "gộp với B02"; bill duy nhất; món đặt từ B05 vẫn được mang ra đúng bàn B05 (vì `Order.tableId` giữ bàn vật lý). Thanh toán xong cả hai bàn sang `NEED_CLEAN`.
**Khách**: tiếp tục như bình thường; xem Mục C6 về mini app.

## C4. Thay đổi mô hình dữ liệu
Dùng các bảng của Phần B (`TableSession`, `TableSessionTable`) và:
- `PrintJobType.TABLE_MOVE` (Phần A).
- `TableCallRequest` (`schema.prisma:493-510`): không đổi cấu trúc; khi đổi bàn chuyển các yêu cầu PENDING của bàn cũ sang bàn mới.
- Nhật ký: `AuditLog action = 'doi_ban'` và `'gop_ban'` (tên đã được dự kiến ở `schema.prisma:518`) với `beforeData`/`afterData` gồm bàn cũ/mới, phiên, các đơn.
Không thêm cột vào `Table`. Bất biến: mỗi bàn có tối đa một `TableSessionTable` hoạt động (`leftAt IS NULL`) cho phiên `OPEN`; bàn `OCCUPIED` ⇔ có phiên `OPEN` giữ bàn. Kiểm bằng truy vấn đêm và bài kiểm tra.

## C5. API (Phần C)
| Endpoint | Vai trò | Mô tả |
|---|---|---|
| `POST /stores/:storeId/pos/sessions/:sessionId/move-table` | CASHIER, MANAGER, OWNER (+ WAITER nếu bật) | Body `{toTableId, fromTableId?, reason?}`. `fromTableId` bắt buộc khi phiên đã gộp nhiều bàn (chọn bàn nào được chuyển). Trả `{session, fromTable, toTable}` |
| `POST /stores/:storeId/pos/sessions/:sessionId/merge` | CASHIER, MANAGER, OWNER | Body `{sourceSessionId, reason?}`: gộp phiên nguồn VÀO phiên đích (path). Trả `{session, bill|null}` |
| `GET /public/sessions/:token` | Công khai (không JWT), giới hạn tần suất | Trả `{status:'OPEN'|'CLOSED'|'CANCELLED', table:{code, name, areaName}, tables:[...], movedFrom?:{code, at}, billSummary?:{subtotal, discountAmount, totalAmount, paidAmount}, orders:[{id, orderNumber, status}]}`; token của phiên đã bị gộp trả về phiên đích |

Quy tắc đổi bàn (trong một transaction; khóa các bàn theo thứ tự `id` tăng dần để tránh khóa chéo):
- Phiên phải `OPEN`; bàn đích cùng quán, trạng thái `AVAILABLE` hoặc `CLEANED`, không có phiên mở; khác: 409 "Bàn {code} đang có khách hoặc không sẵn sàng".
- Cập nhật `TableSession.primaryTableId` (nếu chuyển bàn chính), đóng dòng `TableSessionTable` cũ (`leftAt`, role `MOVED_FROM`), thêm dòng mới; `UPDATE orders SET tableId = đích WHERE sessionId = ? AND tableId = nguồn`; bàn nguồn: `NEED_CLEAN` (đề xuất; PO chốt Q5 có để `AVAILABLE` hay không), bàn đích: `OCCUPIED`.
- Giữ nguyên trạng thái đơn/món (không làm lại món). Bill không đổi (không hủy QR intent; bill tổng không đổi).
- Sau commit: `TABLE_MOVE` in tới các khu có món chưa `SERVED`; sự kiện realtime `order.status`-kiểu cho từng đơn kèm `tableCode` mới (hoặc sự kiện mới `table.moved`) để POS/KDS làm mới; chuyển `TableCallRequest` PENDING; audit.
Quy tắc gộp bàn:
- Hai phiên cùng quán, đều `OPEN`, khác nhau; không bên nào có Payment (nếu bill nguồn đã thu một phần thì 409 "Bàn nguồn đã thanh toán một phần, không thể gộp"); bill nguồn chưa có Payment thì được hủy (`VOID`), mọi `PaymentIntent` PENDING chuyển `SUPERSEDED`.
- Cập nhật `orders.sessionId` của phiên nguồn sang phiên đích; thêm các bàn nguồn vào `TableSessionTable` của phiên đích (role `MERGED`); phiên nguồn `CLOSED` với `mergedIntoId`; `Order.tableId` KHÔNG đổi (bàn vật lý); tính lại bill (tăng `version`).
- Ràng buộc: gộp không hoàn tác ở v1; sai thì thu ngân dùng chức năng tách bàn (chưa có, FR-TBL-08, P2) hoặc xử lý thủ công (Q5).

## C6. Tác động lên mini app (QR/bàn của đơn đổi thế nào)
Nguyên tắc: QR in trên bàn là vĩnh viễn gắn mã bàn (`/s/{slug}/t/{table}`); không có QR động. Phiên bàn và token là cầu nối.
1. `POST /public/stores/:slug/orders` (`public.controller.ts:100-118`, DTO `apps/api/src/orders/dto/order.dto.ts`): thêm trường tùy chọn `sessionToken`; phản hồi thêm `sessionToken` (token của phiên chứa đơn).
2. Mini app lưu token trong `localStorage` theo quán: thêm `storeSessions[slug] = {token, tableCode, savedAt}` vào `apps/miniapp/src/session.ts` (cạnh `SessionOrder`, dòng 20-31, 54-57). `Cart.tsx` (dòng 91-105) gửi kèm `sessionToken` nếu có.
3. Quy tắc server khi nhận đơn có `sessionToken` hợp lệ và phiên `OPEN`:
   - `tableCode` thuộc các bàn đang hoạt động của phiên: đặt đơn ở bàn đó.
   - `tableCode` thuộc các bàn đã rời phiên (`MOVED_FROM`): đặt đơn ở bàn chính hiện tại và trả `tableCode` mới (khách quét lại QR cũ hoặc giỏ cũ vẫn đúng bàn).
   - `tableCode` khác (khách đứng bàn khác): bỏ qua token, xử lý như đơn thường tại bàn quét (phiên của bàn đó), vì ràng buộc vật lý của mã QR được ưu tiên.
   - Token hết hiệu lực (phiên `CLOSED`/`CANCELLED`): bỏ qua token, tạo phiên mới như bình thường.
4. `GET /public/orders/:id` (`orders.service.ts:552-581`) KHÔNG trả `sessionToken` (token là bí mật, chỉ trả cho thiết bị đã gửi đơn ở bước 1); `table` hiện tại đã có; thêm `tableMovedFrom: {code, at}` nếu đổi bàn trong 6 giờ gần nhất để màn Tracking hiện dải thông báo "Quán đã chuyển bạn sang bàn B05. Món sẽ được mang tới bàn mới."
5. `Cart.tsx` (dòng 128-132, "Sai bàn?") đổi lời hướng dẫn thành hiểu đúng tính năng; `Menu.tsx`/`Shell.tsx` (`useTable`, `apps/miniapp/src/components/Shell.tsx`) khi mở có token lưu thì gọi `GET /public/sessions/:token` để đồng bộ mã bàn hiển thị ("Bạn đang gọi món tại Bàn B05") và cập nhật tham số bàn.
6. Nhận biết lúc theo dõi: `useOrder` poll 3 giây (`apps/miniapp/src/useOrder.ts:20-47`) đã đủ để thấy bàn mới trong <= 3 giây; không cần SSE cho khách.
7. Gộp bàn: khách ở B05 vẫn gọi món bằng QR B05, đơn đi vào phiên đích (do bàn B05 giờ thuộc phiên đích), thông báo "Bàn của bạn đã được gộp với B02"; trang "Hóa đơn của bàn" cho cả hai khách cùng một bill.
8. Riêng tư: token phiên (128 bit ngẫu nhiên, khác với `id` UUID v7) cho phép xem tên món và tổng của cả bàn; không trả thông tin nhân viên hay khách khác; hết hiệu lực khi phiên đóng (sau 24 giờ chỉ đọc tóm tắt, sau đó 404 "Phiên đã kết thúc").

## C7. Trường hợp biên và bảo mật (Phần C)
- Đổi bàn khi bàn đích bị khách khác quét QR đúng lúc: khóa bàn trong transaction; một bên thắng, bên kia 409; đơn QR đến sau vào phiên đúng.
- Khách quét QR bàn cũ (đã giải phóng) và gọi: tạo phiên mới tại bàn cũ nếu không có token (đơn ma, xử lý bằng chế độ "đơn chờ xác nhận" ở PM report V-02 Lớp 2, ngoài phạm vi này); có token thì được chuyển đúng.
- Đổi bàn khi bill có QR intent PENDING (Đặc tả 01): intent vẫn hợp lệ (bill không đổi).
- Gộp bàn khi cả hai bàn đã có tiền một phần: bị chặn.
- Phân quyền: Phục vụ chỉ đổi bàn khi quán bật; gộp bàn cần thu ngân trở lên; mọi thao tác audit.
- Đồng thời: hai nhân viên đổi cùng một bàn: khóa bàn theo thứ tự `id`, người sau nhận 409 "Phiên bàn đã thay đổi, vui lòng tải lại".
- Bàn có yêu cầu gọi bàn PENDING: chuyển sang bàn mới; thông báo trên màn Phục vụ (`apps/admin/src/pages/Service.tsx`) dùng bàn mới.
- Phiếu đổi bàn không in được (máy hỏng): cảnh báo như phần A; không chặn đổi bàn.
- Đa quán: bàn nguồn/đích/phiên phải cùng `storeId` của người dùng (`assertStoreAccess` và kiểm `storeId` từng bản ghi).

## C8. Tiêu chí nghiệm thu (Phần C)
1. Cho bàn B02 có 2 đơn đang chế biến và bàn B05 trống, khi thu ngân đổi bàn B02 sang B05, thì mọi đơn có `table.code = B05`, B02 `NEED_CLEAN`, B05 `OCCUPIED`, phiếu "ĐỔI BÀN" in cho khu có món chưa ra, KDS hiển thị B05, trạng thái từng món không đổi, audit `doi_ban` có bàn cũ/mới.
2. Cho bàn đích đang `OCCUPIED`, khi đổi bàn, thì 409 và không có thay đổi nào.
3. Cho khách đang mở màn Theo dõi đơn của đơn #1042 ở B02, khi nhân viên đổi sang B05, thì trong <= 3 giây màn hiển thị Bàn B05 và dải thông báo đổi bàn.
4. Cho khách có `sessionToken` của phiên đã đổi từ B02 sang B05, khi gửi đơn từ giỏ cũ với `tableCode = B02`, thì đơn vào phiên đúng, `table = B05`, và bill thêm đợt mới; mini app cập nhật hiển thị "Bàn B05".
5. Cho khách khác quét QR B02 sau khi nhóm đầu đã đổi sang B05 và B02 đã `AVAILABLE`, khi gửi đơn (không token), thì tạo phiên mới tại B02; không dính bill của nhóm B05.
6. Cho bàn B02 (2 đơn) và B05 (1 đơn), khi gộp B05 vào B02, thì có một phiên, một bill gồm đủ 3 đơn, hai bàn vẫn `OCCUPIED`, `Order.tableId` của đơn B05 giữ B05, thanh toán xong cả hai bàn `NEED_CLEAN`.
7. Cho bàn nguồn đã thu một phần, khi gộp, thì 409 "Bàn nguồn đã thanh toán một phần".
8. Cho `sessionToken` của phiên nguồn đã gộp, khi gọi `GET /public/sessions/:token`, thì nhận dữ liệu phiên đích.
9. Cho WAITER khi quán tắt `allowWaiterMoveTable`, khi đổi bàn, thì 403; bật thì thành công.
10. Cho đổi bàn khi có `PaymentIntent` PENDING, khi tiền về, thì vẫn ghi nhận đúng bill (bill không đổi).
11. Cho hai nhân viên cùng đổi một bàn sang hai bàn đích khác nhau cùng lúc, thì đúng một thành công, bàn không bao giờ thuộc hai phiên.

---

## 9. Phân rã công việc (toàn đặc tả)

Thứ tự đề xuất: B1-B7 (nền) -> C -> hoàn tất A. A1-A4 có thể làm song song ngay vì độc lập với B (trừ in bill gộp, A9).

| # | Công việc | Loại | Cỡ | Phụ thuộc |
|---|---|---|---|---|
| B1 | Migration + Prisma: TableSession, TableSessionTable, Bill, BillDiscount, cột mới Order/Payment/Store, backfill đơn mở | BE | M | không |
| B2 | Hàm `calcTotals` ra `common/utils`, `BillService` (ensure, recalc, discounts, applyPayment, phân bổ xuống đơn) + test làm tròn | BE | L | B1 |
| B3 | Sửa `createOrderTx`, `cancelItem`, `cancelOrder`, `refund` để dùng phiên/bill (giữ đường cũ cho đơn không phiên) | BE | L | B2 |
| B4 | API POS: session, bill, discounts, payments, split preview, refund bill; wrapper đường cũ; hạn mức/duyệt giảm giá | BE | L | B2, B3 |
| B5 | Admin POS: panel bill, `CheckoutModal` (toàn bộ/chia đều/chia món), giảm giá, cảnh báo món chưa ra | FE | L | B4 |
| B6 | Tương thích báo cáo/Orders (serializeOrder kèm bill.payments, test báo cáo doanh thu) | BE+FE | M | B4 |
| B7 | Test e2e: Scenario 4 của BRD, làm tròn, đồng thời, migration trên bản sao dữ liệu | QA/BE | M | B4 |
| C1 | `move-table`, `merge`, quy tắc khóa, audit, chuyển yêu cầu gọi bàn | BE | M | B2 |
| C2 | Công khai: `sessionToken` trong tạo đơn, `GET /public/sessions/:token`, `tableMovedFrom` | BE | M | B3, C1 |
| C3 | Admin: modal Đổi bàn, Gộp bàn, huy hiệu gộp trên `TableTile` | FE | M | C1 |
| C4 | Mini app: lưu/gửi token, đồng bộ bàn, dải thông báo, màn `Bill.tsx` | FE | L | C2, B4 |
| A1 | Migration Prisma phần in + `PrintAgentGuard` + API agent (heartbeat/next/result) + bộ quét lease/offline | BE | L | không |
| A2 | Mô hình tài liệu in + mẫu phiếu có dấu (bếp, bar, hủy, bill, tạm tính, đổi bàn, thử) + `PrintRoutingService` theo khu | BE | L | A1 |
| A3 | Agent: poller, ESC/POS, raster có dấu, TCP, trạng thái cục bộ, nhật ký, đóng gói Windows | Agent/hạ tầng | L | A1 |
| A4 | Admin: Printers (agent, trạng thái job, retry), Menu (khu in), banner, OrderNotifier | FE | M | A1, A2 |
| A5 | KDS lọc theo khu + KDS-only + cảnh báo không có KDS kết nối | FE+BE | M | A2 |
| A6 | Mở két, in tạm tính, in lại có lý do, audit | BE+FE | M | A2 |
| A7 | Kiểm thử phần cứng: ít nhất 2 model máy in nhiệt phổ biến ở quán pilot (58 và 80 mm), kiểm bảng mã/raster, đo KPI | Vận hành | M | A3 |
| A8 | USB qua hàng đợi in của Windows (giai đoạn 2) | Agent | M-L | A3, A7 |
| A9 | In bill gộp/chia bill/phiếu đổi bàn dùng `Bill` | BE | M | A2, B4, C1 |

Ước lượng tổng: Phần B khoảng 4-5 tuần, Phần C khoảng 2 tuần, Phần A khoảng 4-5 tuần (một developer, chưa tính chờ phần cứng/pilot). Hai developer làm song song A và B+C: khoảng 6-7 tuần lịch.

---

## 10. Rủi ro, giả định cần xác minh, câu hỏi cho PO

Rủi ro:
- Refactor thanh toán chạm đường tiền: sai làm tròn/phân bổ gây lệch doanh thu. Giảm bằng bài kiểm thử tính toán và chạy song song kiểm đêm (tổng Payment = tổng bill = tổng đơn).
- Migration chạm đơn đang mở: chạy trên bản sao dữ liệu thật trước; có kế hoạch quay lui (cột nullable nên có thể tắt tính năng bằng cờ).
- Phần cứng đa dạng (máy in nhái, bảng mã, độ rộng, két): cần quán pilot với máy thật sớm; phương án raster giảm rủi ro nhưng tăng tải.
- Agent chạy trên máy Windows của quán: tắt máy, cập nhật Windows, mất mạng; cần dịch vụ tự khởi động và giám sát; hỗ trợ từ xa là chi phí vận hành thật.
- Phụ thuộc người dùng đúng quy trình (mở bàn, đổi bàn): nếu nhân viên không đổi bàn trên hệ thống, phiếu/bill sai bàn.
- Phạm vi phình: "chia theo món" và "gộp bàn" dễ phát sinh biến thể; giữ v1 hẹp.

Giả định cần xác minh:
- GĐ-A1 độ trễ in thực tế; GĐ-A2 bảng mã tiếng Việt và số `ESC t` theo từng model; GĐ-A3 cách in USB từ Node trên Windows (đề xuất qua hàng đợi in Windows, chưa kiểm chứng); GĐ-A4 khả năng truy vấn trạng thái `DLE EOT` của từng model; GĐ-A5 độ rộng điểm ảnh in thực tế 58/80 mm theo model; GĐ-A6 hiệu năng dựng ảnh chữ trên máy quầy cấu hình thấp; GĐ-A7 lệnh xung mở két (cổng RJ11 phụ thuộc máy in, chân/xung theo model).

Câu hỏi cho PO:
- A-Q1: Có bắt buộc hỗ trợ USB ngay MVP in (BRD FR-PRN-09 là P0) hay chấp nhận LAN trước, USB giai đoạn 2? Quán pilot dùng máy gì (hãng/model, kết nối)?
- A-Q2: Phiếu bếp có in giá không (mặc định không)? In "ĐỢT n" cho gọi thêm? Bao nhiêu bản?
- A-Q3: Cách phân phối agent: đóng gói cài đặt có kèm tự cập nhật (tốn công hơn nhưng ít hỗ trợ) hay tệp cài thủ công do InnoCom hỗ trợ từ xa?
- Q3: Hạn mức giảm giá theo vai trò (Cashier bao nhiêu %/đồng), cách duyệt (nhập mật khẩu quản lý hay PIN), có cần lý do bắt buộc từ danh sách?
- Q4: Khi bill đang thanh toán dở, khách gọi thêm món: cho phép (mặc định) hay chặn bằng thông báo?
- Q5: Đổi bàn: bàn cũ sang "Cần dọn" hay "Trống"? Gộp bàn có cần tách ngược (FR-TBL-08) trong đợt này? Phục vụ có được đổi bàn?
- Q6: Định dạng số hóa đơn (`HĐ-000123` hay `INV-yyyyMMdd-số`); có in tên/MST quán trên bill?
- Q7: Có cần phí dịch vụ/tip trên bill trong đợt này?
- Q8: Có cho khách tự chia bill trong mini app (hiện đặc tả chỉ cho thu ngân chia)?
